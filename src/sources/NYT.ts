import { proxiedFetch } from '../lib/proxiedFetch';
import { ScrapedPuzzle, PuzzleEntry, Square, PublicationId } from 'cruzi-models';
import { parse, HTMLElement, Node } from 'node-html-parser';
import { PuzzleSource } from '../scraper/PuzzleSource';
import { decode } from 'html-entities';
import { newPuzzle, numberizeGrid } from "../lib/puzzle";

const MAX_FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 10_000;

interface ParsedClue {
  number: number;
  clue: string;
  answers: string[];
}

interface PlacedCell {
  row: number;
  col: number;
  isBlack: boolean;
  isCircled: boolean;
  content: string;
  htmlNumber?: number;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isElement(node: Node): node is HTMLElement {
  return (node as HTMLElement).tagName !== undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cellText(td: HTMLElement, selector: string): string {
  return td.querySelector(selector)?.textContent?.trim() || '';
}

function extractCellContent(td: HTMLElement): string {
  return (
    cellText(td, '.letter') ||
    cellText(td, '.subst3') ||
    cellText(td, '.subst2') ||
    cellText(td, '.subst')
  );
}

function extractCellNumber(td: HTMLElement): number | undefined {
  const raw = cellText(td, '.num');
  if (!raw) {
    return undefined;
  }
  const number = parseInt(raw, 10);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function isCutoutCell(td: HTMLElement, content: string, htmlNumber?: number): boolean {
  const cls = td.getAttribute('class') || '';
  if (cls.includes('shape') || cls.includes('plot')) {
    return true;
  }

  const style = td.getAttribute('style') || '';
  if (/background-color\s*:\s*transparent/i.test(style) && /border\s*:\s*none/i.test(style)) {
    return true;
  }

  // Decorative colored squares with no crossword content (e.g. Valentine heart).
  if (!content && htmlNumber === undefined && /background-color\s*:\s*#/i.test(style)) {
    return true;
  }

  return false;
}

function parseClueText(text: string): { clue: string; answers: string[] } {
  const normalized = text.replace(/\u00a0/g, ' ').trim();
  const separator = ' : ';
  const idx = normalized.lastIndexOf(separator);
  if (idx === -1) {
    return { clue: decode(normalized), answers: [''] };
  }

  const clue = decode(normalized.slice(0, idx).trim());
  const answers = normalized
    .slice(idx + separator.length)
    .split(' / ')
    .map((answer) => answer.trim());
  return { clue, answers: answers.length > 0 ? answers : [''] };
}

function parseCluePanel(root: HTMLElement | null): ParsedClue[] {
  if (!root) {
    return [];
  }

  const elements = root.childNodes.filter(isElement);
  const clues: ParsedClue[] = [];
  for (let i = 0; i + 1 < elements.length; i += 2) {
    const number = parseInt(elements[i].innerText.trim(), 10);
    if (!Number.isFinite(number)) {
      continue;
    }
    const parsed = parseClueText(elements[i + 1].innerText);
    clues.push({ number, ...parsed });
  }
  return clues;
}

function layoutPuzzleTable(puzTable: HTMLElement): Square[][] {
  const occupied = new Set<string>();
  const placed: PlacedCell[] = [];
  let maxRow = -1;
  let maxCol = -1;
  const posKey = (row: number, col: number) => `${row},${col}`;

  puzTable.querySelectorAll('tr').forEach((rowEl, rowIndex) => {
    let colIndex = 0;
    rowEl.querySelectorAll('td').forEach((td) => {
      while (occupied.has(posKey(rowIndex, colIndex))) {
        colIndex += 1;
      }

      const colspan = parsePositiveInt(td.getAttribute('colspan') || undefined, 1);
      const rowspan = parsePositiveInt(td.getAttribute('rowspan') || undefined, 1);
      const content = extractCellContent(td);
      const htmlNumber = extractCellNumber(td);
      const cls = td.getAttribute('class') || '';
      const cutout = isCutoutCell(td, content, htmlNumber);
      const isBlack = cutout || cls.includes('black');
      const isCircled = cls.includes('shade') || cls.includes('bigcircle');

      for (let rowOffset = 0; rowOffset < rowspan; rowOffset++) {
        for (let colOffset = 0; colOffset < colspan; colOffset++) {
          const row = rowIndex + rowOffset;
          const col = colIndex + colOffset;
          occupied.add(posKey(row, col));
          placed.push({
            row,
            col,
            isBlack,
            isCircled: isBlack ? false : isCircled,
            // Letters that span multiple squares become the same letter in each square.
            content: isBlack ? '' : content,
            htmlNumber: rowOffset === 0 && colOffset === 0 ? htmlNumber : undefined,
          });
          maxRow = Math.max(maxRow, row);
          maxCol = Math.max(maxCol, col);
        }
      }

      colIndex += colspan;
    });
  });

  const height = maxRow + 1;
  const width = maxCol + 1;
  const grid: Square[][] = [];
  for (let row = 0; row < height; row++) {
    const gridRow: Square[] = [];
    for (let col = 0; col < width; col++) {
      gridRow.push({
        row,
        col,
        directions: [],
        isBlack: true,
        content: '',
        isCircled: false,
      });
    }
    grid.push(gridRow);
  }

  for (const cell of placed) {
    const square = grid[cell.row][cell.col];
    square.isBlack = cell.isBlack;
    square.content = cell.content;
    square.isCircled = cell.isCircled;
    square.number = cell.htmlNumber;
  }

  return trimFullyBlackBorders(grid);
}

function rowIsAllBlack(row: Square[]): boolean {
  return row.length > 0 && row.every((square) => square.isBlack);
}

function trimFullyBlackBorders(grid: Square[][]): Square[][] {
  let trimmed = grid;
  while (trimmed.length > 1 && rowIsAllBlack(trimmed[0])) {
    trimmed = trimmed.slice(1);
  }
  while (trimmed.length > 1 && rowIsAllBlack(trimmed[trimmed.length - 1])) {
    trimmed = trimmed.slice(0, -1);
  }
  while (trimmed.length > 0 && trimmed[0].length > 1 && trimmed.every((row) => row[0].isBlack)) {
    trimmed = trimmed.map((row) => row.slice(1));
  }
  while (
    trimmed.length > 0 &&
    trimmed[0].length > 1 &&
    trimmed.every((row) => row[row.length - 1].isBlack)
  ) {
    trimmed = trimmed.map((row) => row.slice(0, -1));
  }

  trimmed.forEach((row, rowIndex) => {
    row.forEach((square, colIndex) => {
      square.row = rowIndex;
      square.col = colIndex;
    });
  });
  return trimmed;
}

function htmlNumbersByPosition(grid: Square[][]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const row of grid) {
    for (const square of row) {
      if (square.number) {
        numbers.set(`${square.row},${square.col}`, square.number);
      }
    }
  }
  return numbers;
}

function clueLookup(clues: ParsedClue[]): Map<number, ParsedClue> {
  const byNumber = new Map<number, ParsedClue>();
  for (const clue of clues) {
    byNumber.set(clue.number, clue);
  }
  return byNumber;
}

function buildEntries(
  grid: Square[][],
  htmlNumbers: Map<string, number>,
  acrossClues: ParsedClue[],
  downClues: ParsedClue[],
  uniclue: boolean,
): Map<string, PuzzleEntry> {
  const acrossByNumber = clueLookup(acrossClues);
  const downByNumber = clueLookup(downClues);
  const entries = new Map<string, PuzzleEntry>();

  for (const row of grid) {
    for (const square of row) {
      if (!square.number) {
        continue;
      }

      const htmlNumber = htmlNumbers.get(`${square.row},${square.col}`) ?? square.number;
      const across = acrossByNumber.get(htmlNumber);
      const down = downByNumber.get(htmlNumber);
      const shared = uniclue ? across : undefined;

      if (square.directions.includes('A')) {
        const parsed = uniclue ? shared : across;
        const answer = parsed
          ? parsed.answers.length > 1
            ? parsed.answers[0]
            : parsed.answers[0] || ''
          : '';
        const key = `${square.number}A`;
        entries.set(key, {
          index: key,
          entry: answer,
          clue: parsed?.clue || '',
        });
      }

      if (square.directions.includes('D')) {
        const parsed = uniclue ? shared : down;
        const answer = parsed
          ? parsed.answers.length > 1
            ? parsed.answers[1] || parsed.answers[0]
            : parsed.answers[0] || ''
          : '';
        const key = `${square.number}D`;
        entries.set(key, {
          index: key,
          entry: answer,
          clue: parsed?.clue || '',
        });
      }
    }
  }

  return entries;
}

/** Clue-panel entries only — numbers and answers come from the page lists, not the grid.
 * Uniclue puzzles (https://www.xwordinfo.com/Uniclue) put Across and Down in one list.
 * A shared number may have one combined answer (DRAGANDDROP) or two answers split by " / ".
 */
function buildEntriesFromCluePanels(
  acrossClues: ParsedClue[],
  downClues: ParsedClue[],
  uniclue: boolean,
): Map<string, PuzzleEntry> {
  const entries = new Map<string, PuzzleEntry>();

  const add = (index: string, entry: string, clue: string): void => {
    const answer = entry.replace(/\s+/g, '');
    if (!answer) {
      return;
    }
    entries.set(index, { index, entry: answer, clue });
  };

  if (uniclue) {
    for (const parsed of acrossClues) {
      const number = String(parsed.number);
      if (parsed.answers.length > 1) {
        add(`${number}A`, parsed.answers[0], parsed.clue);
        add(`${number}D`, parsed.answers[1], parsed.clue);
      } else {
        add(number, parsed.answers[0] || '', parsed.clue);
      }
    }
    return entries;
  }

  for (const parsed of acrossClues) {
    add(`${parsed.number}A`, parsed.answers[0] || '', parsed.clue);
  }
  for (const parsed of downClues) {
    add(`${parsed.number}D`, parsed.answers[0] || '', parsed.clue);
  }
  return entries;
}

export class NYTSource implements PuzzleSource {
    public id = "NYT";
    public name = "New York Times";

    public async getPuzzle(
        date: Date,
        options?: { useCluePanelEntries?: boolean },
    ): Promise<ScrapedPuzzle | null> {
        let url = `https://www.xwordinfo.com/Crossword?date=${date.getMonth()+1}/${date.getDate()}/${date.getFullYear()}`;
        //url = `https://www.xwordinfo.com/Crossword?date=05/31/2026`;

        let parsedHtml: HTMLElement | undefined;
        let lastError: unknown;

        for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
          try {
            const response = await proxiedFetch(url, undefined, this.id);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            parsedHtml = parse(await response.text());
            break;
          } catch (error) {
            lastError = error;
            console.log(
              `Failed to fetch or parse NYT puzzle (attempt ${attempt}/${MAX_FETCH_ATTEMPTS}):`,
              error,
            );
            if (attempt < MAX_FETCH_ATTEMPTS) {
              await sleep(RETRY_DELAY_MS);
            }
          }
        }

        if (!parsedHtml) {
            throw new Error(
              `Failed to parse NYT puzzle HTML after ${MAX_FETCH_ATTEMPTS} attempts: ${lastError}`,
            );
        }

        const puzTable = parsedHtml.querySelector("#PuzTable");
        if (!puzTable) {
            throw new Error(`NYT puzzle table not found for ${url}`);
        }

        let title = parsedHtml.querySelector("#PuzTitle")?.textContent || '';
        let authors = parsedHtml.querySelectorAll(".bbName > a").map(x => x.textContent);
        if (authors.length === 0) authors = parsedHtml.querySelectorAll(".bbName2 > a").map(x => x.textContent);
        let copyright = `© ${date.getFullYear()}, The New York Times`;
        let notes = parsedHtml.querySelector(".notepad")?.textContent.replace("<b>Notepad:</b>", "") || undefined;
        let puzDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        const grid = layoutPuzzleTable(puzTable);
        const height = grid.length;
        const width = grid[0]?.length || 0;

        const acrossRoot = parsedHtml.querySelector('[id$="ACluesPan"] .numclue');
        const downRoot = parsedHtml.querySelector('[id$="DCluesPan"] .numclue');
        const acrossClues = parseCluePanel(acrossRoot);
        const downClues = parseCluePanel(downRoot);
        const uniclue = downClues.length === 0 && acrossClues.length > 0;

        // Fallback loads the HTML grid as-is and takes every clue/answer from the
        // panels. Daily/historical scrapes still numberize the grid and pair
        // entries to slots.
        const useCluePanelEntries = options?.useCluePanelEntries === true;
        let puzEntries: Map<string, PuzzleEntry>;
        if (useCluePanelEntries) {
            puzEntries = buildEntriesFromCluePanels(acrossClues, downClues, uniclue);
        } else {
            numberizeGrid(grid);
            puzEntries = buildEntries(
                grid,
                htmlNumbersByPosition(grid),
                acrossClues,
                downClues,
                uniclue,
            );
        }

        let puzzle = newPuzzle(width, height);
        puzzle.publicationId = this.id as PublicationId;
        puzzle.title = title;
        puzzle.authors = authors;
        puzzle.copyright = copyright;
        puzzle.notes = notes;
        puzzle.date = puzDate;
        puzzle.grid = grid;
        puzzle.entries = puzEntries;
        puzzle.lang = "en"; // NYT puzzles are always in English
        puzzle.sourceLink = url; // Link to the source of the puzzle

        return puzzle;
    }
}
