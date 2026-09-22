import { PublicationId, PuzzleEntry, ScrapedPuzzle } from 'cruzi-models';
import { proxiedFetch } from './proxiedFetch';
import { newPuzzle, numberizeGrid } from './puzzle';
import { formatDateKey, toCalendarDate } from './utils';

const PUZZLR_API_BASE = 'https://api.puzzlr.net/trpc/crossword.getLevel';
const WSJ_GAMES_URL = 'https://www.wsj.com/games/crosswords';

interface PuzzlrCell {
  answer?: string;
  clueNumber?: number;
  isBlack?: boolean;
}

interface PuzzlrClue {
  number: number;
  text: string;
  answer: string;
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

interface PuzzlrPuzzleData {
  title?: string;
  author?: string;
  description?: string;
  subtitle?: string;
  width: number;
  height: number;
  grid: PuzzlrCell[][];
  clues?: {
    across?: PuzzlrClue[];
    down?: PuzzlrClue[];
  };
}

interface PuzzlrLevel {
  date?: string;
  scheduledDate?: string;
  shortId?: string;
  data?: PuzzlrPuzzleData;
}

interface PuzzlrTrpcResponse {
  result?: {
    data?: PuzzlrLevel;
  };
}

function buildPuzzlrApiUrl(date: Date): string {
  const input = encodeURIComponent(JSON.stringify({
    0: {
      tenant: 'wsj',
      date: formatDateKey(date),
    },
  }));
  return `${PUZZLR_API_BASE}?batch=1&input=${input}`;
}

function normalizeWsjByline(byline: string): string {
  let author = byline.trim();
  if (author.startsWith('By ')) {
    author = author.slice(3);
  }
  author = author.replace('/Edited by Mike Shenk', '');
  return author.trim();
}

function parsePuzzlrDate(dateString: string | undefined): Date | null {
  if (!dateString) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) {
    return null;
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addCalendarDays(date: Date, days: number): Date {
  const calendarDate = toCalendarDate(date);
  calendarDate.setDate(calendarDate.getDate() + days);
  return calendarDate;
}

function weekdayName(date: Date): string {
  return WEEKDAY_NAMES[toCalendarDate(date).getDay()];
}

function getPuzzlrMarkedWeekday(level: PuzzlrLevel): string | null {
  const subtitle = level.data?.subtitle?.trim();
  return subtitle || null;
}

function puzzlrLevelMatchesMarkedDay(level: PuzzlrLevel, targetDate: Date): boolean {
  const targetWeekday = weekdayName(targetDate);
  const markedWeekday = getPuzzlrMarkedWeekday(level);
  if (markedWeekday) {
    return markedWeekday.toLowerCase() === targetWeekday.toLowerCase();
  }

  const publishDate = parsePuzzlrDate(level.scheduledDate ?? level.date);
  return !!publishDate && formatDateKey(publishDate) === formatDateKey(targetDate);
}

function addClueEntries(
  entries: Map<string, PuzzleEntry>,
  clues: PuzzlrClue[] | undefined,
  direction: 'A' | 'D',
): void {
  for (const clue of clues ?? []) {
    const key = `${clue.number}${direction}`;
    entries.set(key, {
      index: key,
      clue: clue.text,
      entry: clue.answer.toUpperCase(),
    });
  }
}

function buildScrapedPuzzleFromPuzzlr(
  level: PuzzlrLevel,
  options: {
    publicationId: PublicationId;
    date: Date;
    sourceLink: string;
  },
): ScrapedPuzzle {
  const puzzleData = level.data;
  if (!puzzleData?.grid) {
    throw new Error('WSJ Puzzlr response is missing puzzle grid data.');
  }

  const width = puzzleData.width;
  const height = puzzleData.height;
  const puzzle = newPuzzle(width, height);

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const cell = puzzleData.grid[row]?.[col];
      const square = puzzle.grid[row][col];

      if (!cell || cell.isBlack) {
        square.isBlack = true;
        continue;
      }

      square.content = (cell.answer ?? '').trim().toUpperCase();
    }
  }

  numberizeGrid(puzzle.grid);
  addClueEntries(puzzle.entries, puzzleData.clues?.across, 'A');
  addClueEntries(puzzle.entries, puzzleData.clues?.down, 'D');

  const byline = puzzleData.author?.trim();

  puzzle.publicationId = options.publicationId;
  puzzle.title = (puzzleData.title ?? '').trim();
  puzzle.authors = byline ? [normalizeWsjByline(byline)] : undefined;
  puzzle.copyright = puzzleData.description?.trim();
  puzzle.date = toCalendarDate(options.date);
  puzzle.sourceLink = options.sourceLink;
  puzzle.lang = 'en';

  return puzzle;
}

async function fetchPuzzlrLevel(date: Date): Promise<PuzzlrLevel | null> {
  const response = await proxiedFetch(buildPuzzlrApiUrl(date), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as PuzzlrTrpcResponse[];
  return payload[0]?.result?.data ?? null;
}

export async function fetchWsjPuzzleFromPuzzlr(
  date: Date,
  publicationId: PublicationId,
): Promise<ScrapedPuzzle | null> {
  const targetDate = toCalendarDate(date);
  // Puzzlr often posts a puzzle the calendar day before the weekday in `subtitle`
  // (e.g. the Saturday 21x21 is served on Friday). Prefer the previous day, then
  // the requested day in case they ever publish same-day.
  const candidateDates = [addCalendarDays(targetDate, -1), targetDate];

  for (const candidateDate of candidateDates) {
    const level = await fetchPuzzlrLevel(candidateDate);
    if (!level?.data || !puzzlrLevelMatchesMarkedDay(level, targetDate)) {
      continue;
    }

    return buildScrapedPuzzleFromPuzzlr(level, {
      publicationId,
      date: targetDate,
      sourceLink: WSJ_GAMES_URL,
    });
  }

  return null;
}
