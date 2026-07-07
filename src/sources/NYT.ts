import { proxiedFetch } from '../lib/proxiedFetch';
import { ScrapedPuzzle, PuzzleEntry, Square, PublicationId } from 'cruzi-models';
import { parse, HTMLElement } from 'node-html-parser';
import { PuzzleSource } from '../scraper/PuzzleSource';
import { decode } from 'html-entities';
import { newPuzzle } from "../lib/puzzle";

const MAX_FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 10_000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class NYTSource implements PuzzleSource {
    public id = "NYT";
    public name = "New York Times";

    public async getPuzzle(date: Date): Promise<ScrapedPuzzle | null> {
        let url = `https://www.xwordinfo.com/Crossword?date=${date.getMonth()+1}/${date.getDate()}/${date.getFullYear()}`;
        //url = `https://www.xwordinfo.com/Crossword?date=05/31/2026`;

        let parsedHtml: HTMLElement | undefined;
        let lastError: unknown;

        for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
          try {
            const response = await proxiedFetch(url);
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

        let title = parsedHtml.querySelector("#PuzTitle")!.textContent;
        let authors = parsedHtml.querySelectorAll(".bbName > a").map(x => x.textContent);
        if (authors.length === 0) authors = parsedHtml.querySelectorAll(".bbName2 > a").map(x => x.textContent);
        let copyright = `© ${date.getFullYear()}, The New York Times`;
        let notes = parsedHtml.querySelector(".notepad")?.textContent.replace("<b>Notepad:</b>", "") || undefined;
        let puzDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        let source = this.id;

        let grid = [] as Square[][];
        let puzTable = parsedHtml.querySelector("#PuzTable")!;
        let rows = puzTable.querySelectorAll("tr");
        let height = rows.length;
        let width = 0;
        rows.forEach((row, ri) => {
            let gridRow = [] as Square[];

            let cols = row.querySelectorAll("td");
            if (width === 0) width = cols.length;
            cols.forEach((col, ci) => {
                let square = {
                    row: ri,
                    col: ci,
                    directions: [],
                    isBlack: false,
                    content: "",
                    isCircled: false,
                } as Square;

                if (col.getAttribute("class")?.includes("black")) {
                    square.isBlack = true;
                    gridRow.push(square);
                    return;
                }

                square.number = +col.querySelector(".num")!.textContent || undefined;
                square.content = col.querySelector(".letter")?.textContent || 
                    col.querySelector(".subst")?.textContent ||
                    col.querySelector(".subst2")?.textContent ||
                    "";

                if (col.getAttribute("class")?.includes("shade") || col.getAttribute("class")?.includes("bigcircle")) {
                    square.isCircled = true;
                }

                gridRow.push(square);
            });

            grid.push(gridRow);
        });

        let puzEntries = new Map<string, PuzzleEntry>();

        let acrossClues = parsedHtml.querySelector("#ACluesPan .numclue")!.childNodes;
        for (let i = 0; i < acrossClues.length; i += 2) {
            let number = +acrossClues[i].innerText;
            let clueText = acrossClues[i+1].innerText;
            let clueMatches = clueText.match(/(?<clue>.*) : (?<entry>[A-Z0-9]+)/)!;
            
            let key = number.toString() + "A";
            puzEntries.set(key, {
                index: key,
                entry: clueMatches.groups ? clueMatches.groups["entry"]: "",
                clue: decode(clueMatches.groups ? clueMatches.groups["clue"] : ""),
            } as PuzzleEntry);
        }

        let downClues = parsedHtml.querySelector("#DCluesPan .numclue")!.childNodes;
        for (let i = 0; i < downClues.length; i += 2) {
            let number = +downClues[i].innerText;
            let clueText = downClues[i+1].innerText;
            let clueMatches = clueText.match(/(?<clue>.*) : (?<entry>[A-Z0-9]+)/)!;
            
            let key = number.toString() + "D";
            puzEntries.set(key, {
                index: key,
                entry: clueMatches.groups ? clueMatches.groups["entry"]: "",
                clue: decode(clueMatches.groups ? clueMatches.groups["clue"] : ""),
            } as PuzzleEntry);
        }

        let puzzle = newPuzzle(width, height);
        puzzle.publicationId = this.id as PublicationId;
        puzzle.title = title;
        puzzle.authors = authors;
        puzzle.copyright = copyright;
        puzzle.notes = notes;
        puzzle.date = puzDate;
        puzzle.sourceLink = source;
        puzzle.grid = grid;
        puzzle.entries = puzEntries;
        puzzle.lang = "en"; // NYT puzzles are always in English
        puzzle.sourceLink = url; // Link to the source of the puzzle

        return puzzle;
    }
}
