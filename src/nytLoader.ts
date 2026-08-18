/*
Loads New York Times crossword puzzles from the NYT archive.
The general strategy will be the same as crosswordScraper.ts, but puzzles won't be scraped from
the web but rather loaded from files on disk.

For puzzles 2018 and earlier, use the files in C:\Users\ben_z\Desktop\Crossword Puzzles Archive 1940-2018\nyt
Note that before September 11, 1950, the NYT only published weekly crosswords.
On and after November 21, 1993, Will Shortz took over as crossword editor. Before this will be considered
the pre-Shortz era and after will be considered the Shortz era.
Examine the file and directory structure. We want to load the canonical puzzle from each day in the archive
from its respective .puz file and that's it. Ignore any variety puzzles, mini puzzles, .txt formats, etc.
Archive naming: through ~1993 files are nytYYMMDD.puz; from 1994–2018 canonical dailies are usually
MonDDYY.puz (e.g. Apr0194.puz), with occasional YYYYMMDD.puz and leftover nytYYMMDD.puz files.
After 1950, every calendar day should have a puzzle; log any missing days under that year's count.

For puzzles 2019 and later, use the files in C:\Users\ben_z\Desktop\puzzles\NYT.
Examine the file and directory structure. There is a subdirectory for each year indicating the month and
inside that are the .puz files for each day that month.
Load puzzles up to July 31, 2026 and then stop.

Like crosswordScraper.ts, we want to create a puzzle record in the database for each puzzle as well as a 
clue collection and clues.
Create any entries in the entry table as needed. Don't insert into the familiarity queue.

Upon examining each .puz file, verify that the number of clues matches the number of slots in the
puzzle grid. If not (or if the file cannot be parsed), ignore the .puz file and load the puzzle from
xwordinfo via sources/NYT.ts. That web request goes through the Webshare proxy, the same way
historicalScraper.ts does. Do not re-save a .puz file.
When falling back to xwordinfo, delete any existing puzzle and clue collection for that date and
re-create them from the xwordinfo data. Do not delete entry records.
Clues and answers come from the clue/answer section of the xwordinfo page, not from matching
grid slots. Clue numbers also come from that section (Across list → 1A, Down list → 1D;
uniclue lists use the printed number, or N-A/N-D when one clue has two answers).
The grid is stored as-is. Set puzzle.notes to "bad .puz".
Either way, a puzzle and clue collection must exist in the DB when processing finishes.

For each entry, whether or not it already existed, add/update entry_tags rows:
- "nyt-ps" if the puzzle is pre-Shortz (before Nov 21, 1993)
- "nyt-s" if the puzzle is Shortz-era (Nov 21, 1993 or later)
- "nyt" in any case
If the entry_tags row already exists, the value is incremented.

loadNytPuzzles takes a fromDate and only loads puzzles on or after that calendar date.

The DB schema is in the cruzi-db/sql/schema.sql file for reference.
Keep these requirements in the comments.
*/

import fs from 'fs';
import path from 'path';

import {
  addEntryTags,
  deleteCrosswordPuzzleAndCollection,
  getCrosswordCollectionId,
  ILoaderDao,
  insertEntries,
  LoaderDao,
} from 'cruzi-db';
import {
  CollectionClue,
  PublicationId,
  ScrapedPuzzle,
} from 'cruzi-models';

import { puzzleToClueCollection } from './crosswordScraper';
import { normalizeScrapedPuzzleAuthors } from './lib/authorNormalization';
import { processPuzData, puzCluesMatchGridSlots } from './lib/puzFiles';
import { countGridSlots } from './lib/puzzle';
import { formatDateKey, toCalendarDate } from './lib/utils';
import { configureWebshareProxy } from './lib/webshareProxy';
import { PuzzleSources } from './scraper/PuzzleSource';

const ARCHIVE_ROOT =
  'C:\\Users\\ben_z\\Desktop\\Crossword Puzzles Archive 1940-2018\\nyt';
const MODERN_ROOT = 'C:\\Users\\ben_z\\Desktop\\puzzles\\NYT';

/** Early archive dailies: nytYYMMDD.puz (ignore -bh, orig, variety, etc.). */
const ARCHIVE_NYT_YYMMDD_PUZ = /^nyt(\d{2})(\d{2})(\d{2})\.puz$/i;
/** 1994–2018 archive dailies: MonDDYY.puz (e.g. Apr0194.puz). */
const ARCHIVE_MON_DD_YY_PUZ =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{2})(\d{2})\.puz$/i;
/** Occasional archive dailies: YYYYMMDD.puz */
const ARCHIVE_YYYYMMDD_PUZ = /^(\d{4})(\d{2})(\d{2})\.puz$/;
/** Modern scraped files: NYT-YYYY-MM-DD.puz */
const MODERN_CANONICAL_PUZ = /^NYT-(\d{4})-(\d{2})-(\d{2})\.puz$/i;

const MONTH_NAME_TO_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const SHORTZ_ERA_START = new Date(1993, 10, 21); // Nov 21, 1993
const LOAD_THROUGH = new Date(2026, 6, 31); // July 31, 2026
/** Years after this are expected to have one puzzle per calendar day. */
const DAILY_ERA_START_YEAR = 1951;

interface NytPuzFile {
  filePath: string;
  date: Date;
}

let dao: ILoaderDao = new LoaderDao();

function isPreShortz(date: Date): boolean {
  return toCalendarDate(date) < SHORTZ_ERA_START;
}

function eraTag(date: Date): 'nyt-ps' | 'nyt-s' {
  return isPreShortz(date) ? 'nyt-ps' : 'nyt-s';
}

/** Archive filenames use YY; YY>=40 => 19xx, else 20xx (covers 1942–2018). */
function archiveYearFromYy(yy: number): number {
  return yy >= 40 ? 1900 + yy : 2000 + yy;
}

function dateFromYmd(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseArchivePuzDate(fileName: string): Date | null {
  const nytMatch = fileName.match(ARCHIVE_NYT_YYMMDD_PUZ);
  if (nytMatch) {
    return dateFromYmd(
      archiveYearFromYy(Number(nytMatch[1])),
      Number(nytMatch[2]),
      Number(nytMatch[3]),
    );
  }

  const monMatch = fileName.match(ARCHIVE_MON_DD_YY_PUZ);
  if (monMatch) {
    const monthIndex = MONTH_NAME_TO_INDEX[monMatch[1].toLowerCase()];
    if (monthIndex === undefined) {
      return null;
    }
    return dateFromYmd(
      archiveYearFromYy(Number(monMatch[3])),
      monthIndex + 1,
      Number(monMatch[2]),
    );
  }

  const ymdMatch = fileName.match(ARCHIVE_YYYYMMDD_PUZ);
  if (ymdMatch) {
    return dateFromYmd(Number(ymdMatch[1]), Number(ymdMatch[2]), Number(ymdMatch[3]));
  }

  return null;
}

function parseModernPuzDate(fileName: string): Date | null {
  const match = fileName.match(MODERN_CANONICAL_PUZ);
  if (!match) {
    return null;
  }

  return dateFromYmd(Number(match[1]), Number(match[2]), Number(match[3]));
}

function collectArchivePuzFiles(root: string): NytPuzFile[] {
  const results: NytPuzFile[] = [];

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      console.error(`Unable to read archive directory ${dir}:`, error);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const date = parseArchivePuzDate(entry.name);
      if (!date) {
        continue;
      }
      results.push({ filePath: fullPath, date });
    }
  };

  walk(root);
  return results;
}

function collectModernPuzFiles(root: string, through: Date): NytPuzFile[] {
  const results: NytPuzFile[] = [];
  const throughKey = formatDateKey(through);

  let years: string[];
  try {
    years = fs.readdirSync(root);
  } catch (error) {
    console.error(`Unable to read modern NYT root ${root}:`, error);
    return results;
  }

  for (const yearName of years.sort()) {
    const yearPath = path.join(root, yearName);
    if (!fs.statSync(yearPath).isDirectory()) {
      continue;
    }

    let months: string[];
    try {
      months = fs.readdirSync(yearPath);
    } catch (error) {
      console.error(`Unable to read year directory ${yearPath}:`, error);
      continue;
    }

    for (const monthName of months.sort()) {
      const monthPath = path.join(yearPath, monthName);
      if (!fs.statSync(monthPath).isDirectory()) {
        continue;
      }

      let files: string[];
      try {
        files = fs.readdirSync(monthPath);
      } catch (error) {
        console.error(`Unable to read month directory ${monthPath}:`, error);
        continue;
      }

      for (const fileName of files) {
        const date = parseModernPuzDate(fileName);
        if (!date) {
          continue;
        }
        if (formatDateKey(date) > throughKey) {
          continue;
        }
        results.push({ filePath: path.join(monthPath, fileName), date });
      }
    }
  }

  return results;
}

function dedupeByDate(files: NytPuzFile[]): NytPuzFile[] {
  const byDate = new Map<string, NytPuzFile>();
  for (const file of files) {
    const key = formatDateKey(file.date);
    if (!byDate.has(key)) {
      byDate.set(key, file);
    }
  }

  return Array.from(byDate.values()).sort((a, b) =>
    formatDateKey(a.date).localeCompare(formatDateKey(b.date)),
  );
}

function collectAllNytPuzFiles(): NytPuzFile[] {
  return dedupeByDate([
    ...collectArchivePuzFiles(ARCHIVE_ROOT),
    ...collectModernPuzFiles(MODERN_ROOT, LOAD_THROUGH),
  ]);
}

/** Expected puzzle dates for a year, capped by fromDate and LOAD_THROUGH. */
function expectedDateKeysForYear(year: number, from: Date, through: Date): string[] {
  if (year > through.getFullYear() || year < from.getFullYear()) {
    return [];
  }

  const start =
    year === from.getFullYear() ? toCalendarDate(from) : new Date(year, 0, 1);
  const end =
    year === through.getFullYear() ? toCalendarDate(through) : new Date(year, 11, 31);

  const keys: string[] = [];
  for (
    let cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor.setDate(cursor.getDate() + 1)
  ) {
    keys.push(formatDateKey(cursor));
  }
  return keys;
}

function logFilesPerYear(files: NytPuzFile[], from: Date): void {
  const datesByYear = new Map<number, Set<string>>();
  for (const file of files) {
    const year = file.date.getFullYear();
    const key = formatDateKey(file.date);
    let dates = datesByYear.get(year);
    if (!dates) {
      dates = new Set<string>();
      datesByYear.set(year, dates);
    }
    dates.add(key);
  }

  const years = Array.from(datesByYear.keys()).sort((a, b) => a - b);
  console.log('NYT .puz files collected per year:');
  for (const year of years) {
    const present = datesByYear.get(year)!;
    console.log(`  ${year}: ${present.size}`);

    if (year < DAILY_ERA_START_YEAR) {
      continue;
    }

    const missing = expectedDateKeysForYear(year, from, LOAD_THROUGH).filter(
      (key) => !present.has(key),
    );
    if (missing.length > 0) {
      console.log(`    missing (${missing.length}): ${missing.join(', ')}`);
    }
  }
}

async function loadPuzzleFromPuzFile(file: NytPuzFile): Promise<ScrapedPuzzle | undefined> {
  const buffer = await fs.promises.readFile(file.filePath);
  const puzzle = await processPuzData(new Blob([buffer]));
  if (!puzzle) {
    console.error(`Failed to parse .puz file: ${file.filePath}`);
    return undefined;
  }

  puzzle.publicationId = 'NYT' as PublicationId;
  puzzle.date = toCalendarDate(file.date);
  puzzle.lang = 'en';
  puzzle.sourceLink = file.filePath;
  normalizeScrapedPuzzleAuthors(puzzle);
  return puzzle;
}

async function loadPuzzleFromXwordinfo(date: Date): Promise<ScrapedPuzzle | undefined> {
  const puzzle = await PuzzleSources.NYT.getPuzzle(date, { useCluePanelEntries: true });
  if (!puzzle) {
    return undefined;
  }

  puzzle.publicationId = 'NYT' as PublicationId;
  puzzle.date = toCalendarDate(date);
  puzzle.lang = 'en';
  puzzle.notes = 'bad .puz';
  normalizeScrapedPuzzleAuthors(puzzle);
  return puzzle;
}

function uniquePuzzleEntries(puzzle: ScrapedPuzzle): string[] {
  const entries = Array.from(puzzle.entries.values()).map((puzEntry) => puzEntry.entry);
  return Array.from(new Set(entries)).sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
}

async function puzzleAlreadyExists(puzzle: ScrapedPuzzle): Promise<boolean> {
  const publicationId = puzzle.publicationId || 'unknown';
  const collectionId = await getCrosswordCollectionId(publicationId, puzzle.date);
  return collectionId !== null;
}

async function tagNytPuzzleEntries(puzzle: ScrapedPuzzle): Promise<string[]> {
  const uniqueEntries = uniquePuzzleEntries(puzzle);
  const lang = puzzle.lang || 'en';
  const tag = eraTag(puzzle.date);

  await insertEntries(
    uniqueEntries.map((entry) => ({
      entry,
      lang,
      length: entry.length,
      display_text: entry,
    })),
  );
  await addEntryTags([
    ...uniqueEntries.map((entry) => ({
      entry,
      lang,
      tag,
      value: '1',
    })),
    ...uniqueEntries.map((entry) => ({
      entry,
      lang,
      tag: 'nyt',
      value: '1',
    })),
  ]);

  return uniqueEntries;
}

async function processNytPuzzle(puzzle: ScrapedPuzzle): Promise<void> {
  console.log(`Processing NYT puzzle for ${formatDateKey(puzzle.date)}`);
  await dao.savePuzzle(puzzle);

  const clueCollection = puzzleToClueCollection(puzzle);
  console.log(`NYT clues extracted: ${clueCollection.clues!.length}`);

  await dao.saveClueCollection(clueCollection);
  await dao.addCluesToCollection(clueCollection.id!, clueCollection.clues as CollectionClue[]);
  const uniqueEntries = await tagNytPuzzleEntries(puzzle);

  console.log(
    `NYT ${formatDateKey(puzzle.date)} saved (${uniqueEntries.length} entries tagged ${eraTag(puzzle.date)} and nyt).`,
  );
}

/** Local runs only proxy sources listed in WEBSHARE_PROXY_SOURCES; NYT web fallback must be included. */
function ensureNytIsProxied(): void {
  const raw = process.env.WEBSHARE_PROXY_SOURCES?.trim() ?? '';
  const ids = new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
  ids.add('NYT');
  process.env.WEBSHARE_PROXY_SOURCES = Array.from(ids).join(',');
}

export const loadNytPuzzles = async (fromDate: Date): Promise<void> => {
  ensureNytIsProxied();
  await configureWebshareProxy();

  const from = toCalendarDate(fromDate);
  const fromKey = formatDateKey(from);
  console.log(`Starting NYT archive loader (on or after ${fromKey})...`);
  const files = collectAllNytPuzFiles().filter(
    (file) => formatDateKey(file.date) >= fromKey,
  );
  console.log(`Found ${files.length} canonical NYT .puz files to consider.`);
  logFilesPerYear(files, from);

  let loaded = 0;
  let replaced = 0;
  let taggedExisting = 0;
  let failed = 0;

  for (const file of files) {
    const dateKey = formatDateKey(file.date);
    try {
      let puzzle: ScrapedPuzzle | undefined;
      let fromWeb = false;

      try {
        puzzle = await loadPuzzleFromPuzFile(file);
      } catch (error) {
        console.error(`Failed to parse .puz file ${file.filePath}:`, error);
      }

      if (!puzzle || !puzCluesMatchGridSlots(puzzle)) {
        const slots = puzzle ? countGridSlots(puzzle.grid) : 0;
        const clues = puzzle?.entries.size ?? 0;
        console.log(
          `Clue/slot mismatch for NYT on ${dateKey} (clues=${clues}, slots=${slots}); loading from xwordinfo.`,
        );
        puzzle = await loadPuzzleFromXwordinfo(file.date);
        fromWeb = true;
      }

      if (!puzzle) {
        failed += 1;
        console.error(`No NYT puzzle available for ${dateKey}`);
        continue;
      }

      const exists = await puzzleAlreadyExists(puzzle);

      if (fromWeb) {
        if (exists) {
          console.log(`Replacing existing NYT puzzle for ${dateKey} from xwordinfo.`);
          await deleteCrosswordPuzzleAndCollection('NYT', puzzle.date);
          replaced += 1;
        }
        await processNytPuzzle(puzzle);
        if (!exists) {
          loaded += 1;
        }
      } else if (exists) {
        const uniqueEntries = await tagNytPuzzleEntries(puzzle);
        console.log(
          `Puzzle already exists for NYT on ${dateKey}, tagging ${uniqueEntries.length} entries.`,
        );
        taggedExisting += 1;
      } else {
        await processNytPuzzle(puzzle);
        loaded += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(`Error loading NYT puzzle from ${file.filePath}:`, error);
    }
  }

  console.log(
    `NYT archive loader finished. loaded=${loaded} replaced=${replaced} taggedExisting=${taggedExisting} failed=${failed}`,
  );
};

export const nytLoader = loadNytPuzzles;

