/**
 * This file contains the code for the crossword scraper lambda function.
 * It is responsible for scraping crossword puzzles from the web and saving them to a storage drive.
 * It also creates a new crossword and clue collection in the database for the crossword.
 * It then enqueues all answers into the entry info queue to have its senses (definitions) populated.
 */

import { generatePuzFile } from './lib/puzFiles';
import { stripNonWindows1252OrIso8859_1 } from './lib/textEncoding';
import {
  ClueCollection,
  CollectionClue,
  Puzzle,
  ScrapedPuzzle,
} from 'cruzi-models';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getCrosswordCollectionId, ILoaderDao, insertEntries, LoaderDao } from 'cruzi-db';
import { normalizeScrapedPuzzleAuthors } from './lib/authorNormalization';
import { formatDateKey, generateId, getPuzzleDate, mapValues, mapWithConcurrency } from './lib/utils';
import { PuzzleSource, PuzzleSources } from './scraper/PuzzleSource';
import { configureWebshareProxy } from './lib/webshareProxy';
import fs from 'fs';
import path from 'path';

const puzzleSources = [
  PuzzleSources.NYT,
  PuzzleSources.WSJ,
  PuzzleSources.Newsday,
  PuzzleSources.LAT,
  PuzzleSources.Universal,
  PuzzleSources.UniversalSunday,
  PuzzleSources.WashingtonPost,
  PuzzleSources.USAToday,
  PuzzleSources.NewYorker,
  PuzzleSources.BEQ,
  PuzzleSources.Croce,
  PuzzleSources.Premier,
  PuzzleSources.Jonesin,
  PuzzleSources.PennyDell,
  PuzzleSources.PennyDellSunday,
  PuzzleSources.Joseph,
  PuzzleSources.Sheffer,
  PuzzleSources.DailyCommuter,
  PuzzleSources.BestCrosswords,
  PuzzleSources.DailyPop,
  PuzzleSources.Atlantic,
  PuzzleSources.CrosswordClub,
  PuzzleSources.DailyBeast,
  PuzzleSources.Puzzmo,
  PuzzleSources.PuzzmoBig,
  PuzzleSources.SimplyDaily,
  PuzzleSources.Vox,
  PuzzleSources.Vulture,
  PuzzleSources.TheWalrus,
  PuzzleSources.Slate,
  PuzzleSources.Telegraph,
  PuzzleSources.YourPuzzleSource,
  PuzzleSources.MerriamWebster,
  PuzzleSources.Sporcle,
] as PuzzleSource[];

const SCRAPE_CONCURRENCY = 3;

const PUZ_FILE_SOURCE_IDS = new Set([
  'BEQ',
  'BestCrosswords',
  'Croce',
  'Jonesin',
  'Universal',
  'UniversalSunday',
  'WashingtonPost',
  'WSJ',
]);
function normalizePuzzleForPuzEncoding(puzzle: ScrapedPuzzle): void {
  if (puzzle.title) {
    puzzle.title = stripNonWindows1252OrIso8859_1(puzzle.title);
  }
  if (puzzle.copyright) {
    puzzle.copyright = stripNonWindows1252OrIso8859_1(puzzle.copyright);
  }
  if (puzzle.notes) {
    puzzle.notes = stripNonWindows1252OrIso8859_1(puzzle.notes);
  }
  if (puzzle.authors) {
    puzzle.authors = puzzle.authors.map(stripNonWindows1252OrIso8859_1);
  }
  for (const entry of puzzle.entries.values()) {
    entry.clue = stripNonWindows1252OrIso8859_1(entry.clue);
    entry.entry = stripNonWindows1252OrIso8859_1(entry.entry);
  }
  for (const row of puzzle.grid) {
    for (const square of row) {
      if (square.content) {
        square.content = stripNonWindows1252OrIso8859_1(square.content);
      }
    }
  }
}

const S3_BUCKET = 'scraped-crosswords';
const s3Client = new S3Client({});
const LOCAL_PUZ_PATH = 'C:\\Users\\ben_z\\Desktop\\puzzles';

function getPuzzleStorageKey(puzzle: ScrapedPuzzle): string {
  const publicationId = puzzle.publicationId || 'unknown';
  const date = puzzle.date;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const dateString = formatDateKey(date);
  return `${publicationId}/${year}/${month}/${publicationId}-${dateString}.puz`;
}

async function puzzleToBuffer(puzzle: ScrapedPuzzle): Promise<Buffer> {
  const blob = generatePuzFile(puzzle);
  return Buffer.from(await blob.arrayBuffer());
}

async function uploadPuzzleToS3(puzzle: ScrapedPuzzle, key: string): Promise<void> {
  const buffer = await puzzleToBuffer(puzzle);
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'application/octet-stream',
  }));
  console.log(`Uploaded ${key} to s3://${S3_BUCKET}/`);
}

async function savePuzzleToLocal(puzzle: ScrapedPuzzle, key: string): Promise<void> {
  const buffer = await puzzleToBuffer(puzzle);
  const localFilePath = path.join(LOCAL_PUZ_PATH, key);
  await fs.promises.mkdir(path.dirname(localFilePath), { recursive: true });
  await fs.promises.writeFile(localFilePath, buffer);
  console.log(`Saved ${key} to ${localFilePath}`);
}

async function puzzleAlreadyExists(puzzle: ScrapedPuzzle): Promise<boolean> {
  const publicationId = puzzle.publicationId || 'unknown';
  const collectionId = await getCrosswordCollectionId(publicationId, puzzle.date);
  return collectionId !== null;
}

function requirePuzLocation(): 'S3' | 'local' {
  const puzLocation = process.env.PUZ_LOCATION;
  if (puzLocation === 'S3' || puzLocation === 'local') {
    return puzLocation;
  }
  throw new Error("PUZ_LOCATION must be set to 'S3' or 'local'; scraper will not run without it.");
}

async function savePuzzle(puzzle: ScrapedPuzzle, key: string, puzLocation: 'S3' | 'local'): Promise<void> {
  if (puzLocation === 'S3') {
    await uploadPuzzleToS3(puzzle, key);
    return;
  }

  await savePuzzleToLocal(puzzle, key);
}

export const scrapePuzzles = async (puzLocation: 'S3' | 'local'): Promise<ScrapedPuzzle[]> => {
  await configureWebshareProxy();

  const date = getPuzzleDate();
  const dateString = formatDateKey(date);

  const results = await mapWithConcurrency(
    puzzleSources,
    SCRAPE_CONCURRENCY,
    async (source): Promise<ScrapedPuzzle | undefined> => {
      try {
        const puzzle = await source.getPuzzle(date);
        if (!puzzle) {
          console.log(`No puzzle found for ${source.name} on ${dateString}`);
          return undefined;
        }
        normalizeScrapedPuzzleAuthors(puzzle);
        if (!PUZ_FILE_SOURCE_IDS.has(source.id)) {
          normalizePuzzleForPuzEncoding(puzzle);
        }
        if (await puzzleAlreadyExists(puzzle)) {
          console.log(`Puzzle already exists for ${source.name} on ${formatDateKey(puzzle.date)}, skipping.`);
          return undefined;
        }

        const key = getPuzzleStorageKey(puzzle);
        await savePuzzle(puzzle, key, puzLocation);

        console.log(`Scraped puzzle from ${source.name} for date ${dateString}`);
        return puzzle;
      } catch (error) {
        console.error(`Error scraping puzzle from ${source.name} for date ${dateString}: `, error);
        return undefined;
      }
    },
  );

  return results.filter((puzzle): puzzle is ScrapedPuzzle => puzzle !== undefined);
}

// Postgres runs on the same host as this Lambda (not RDS), so no VPC configuration is required.
let dao: ILoaderDao = new LoaderDao();

let runCrosswordLoadingTasks = async () => {
  const puzLocation = requirePuzLocation();

  console.log("Starting crossword loading tasks...");
  try {
    const scrapedPuzzles = await scrapePuzzles(puzLocation);

    // Process puzzles sequentially so DB work does not run in parallel. Overlapping
    // transactions on shared rows (e.g. entries, queues) can deadlock when lock
    // order differs between workers.
    //
    // It is OK if the Lambda hits its 15-minute timeout before finishing every
    // source. The next scheduled run (2 AM / 2 PM Eastern) will skip puzzles
    // already in the database and pick up anything we missed.
    for (const puzzle of scrapedPuzzles) {
      await processPuzzle(puzzle);
    }

  } catch (error) {
    console.error("Error in crossword loading tasks: ", error);
    throw error;
  }
};

let processPuzzle = async (puzzle: ScrapedPuzzle): Promise<void> => {
  try {
      console.log(`Processing puzzle for ${puzzle.publicationId}`);
      await dao.savePuzzle(puzzle);
      puzzle.id = puzzle.id;
      let clueCollection = puzzleToClueCollection(puzzle);

      console.log(`${puzzle.publicationId} clues extracted: ${clueCollection.clues!.length}`);

      let entries = (clueCollection.clues as CollectionClue[]).map(c => c.clue.entry);
      let uniqueEntries = Array.from(new Set(entries.map(entry => entry.entry))).sort(
        (a, b) => (a === b ? 0 : a < b ? -1 : 1),
      );
      let familiarityQueueItems = uniqueEntries.map(entry => ({
        entry,
        lang: puzzle.lang || 'en',
      }));

      await dao.saveClueCollection(clueCollection); // Adds id to collection
      await dao.addCluesToCollection(clueCollection.id!, clueCollection.clues as CollectionClue[]);
      await insertEntries(
        familiarityQueueItems.map(({ entry, lang }) => ({
          entry,
          lang,
          length: entry.length,
          display_text: entry,
        })),
      );
      await dao.addCrosswordFamiliarityQueueEntries(familiarityQueueItems);

      console.log(`${puzzle.publicationId} entry info queued.`);
  } catch (error) {
    console.error(`Error processing puzzle ${puzzle.publicationId}`, error);
  }
}

let puzzleToClueCollection = (puzzle: ScrapedPuzzle): ClueCollection => {
  let lang = puzzle.lang || 'en';

  let clues: CollectionClue[] = mapValues(puzzle.entries).map((puzEntry, index) => ({
    clue: {
      id: generateId(),
      lang,
      entry: {
        entry: puzEntry.entry,
        lang: lang,
      },
      customClue: puzEntry.clue,
      source: puzzle.publicationId || "unknown",
    },
    order: index,
    metadata1: puzEntry.index,
  }));

  let clueCollection: ClueCollection = {
    puzzle: puzzle as Puzzle,
    title: puzzle.title,
    lang: lang,
    author: puzzle.authors?.join(", "),
    createdDate: new Date(),
    modifiedDate: new Date(),
    source: puzzle.publicationId || "unknown",
    isPrivate: false,
    clueCount: clues.length,
    clueCount6Plus: clues.filter(c => c.clue.entry.entry.length >= 6).length,
    clues: clues,
    metadata1: formatDateKey(puzzle.date),
  };

  return clueCollection;
}

export const crosswordScraper = runCrosswordLoadingTasks;
