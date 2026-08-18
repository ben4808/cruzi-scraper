/**
 * Historical crossword scraper.
 *
 * Like crosswordScraper.ts, but scrapes every crossword published in a given
 * calendar month instead of just the current day. Only .puz files are saved
 * (locally or in S3); nothing is parsed or loaded into the database.
 *
 * Sources scraped for each day in the month (where available):
 * - New York Times
 * - LA Times
 * - Newsday
 * - Washington Post
 * - Wall Street Journal
 * - USA Today
 * - The New Yorker
 * - BEQ
 * - Universal
 * - Universal Sunday
 */

import { HeadObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

import {
  LOCAL_PUZ_PATH,
  getPuzzleStorageKey,
  normalizePuzzleForPuzEncoding,
  PUZ_FILE_SOURCE_IDS,
  requirePuzLocation,
  S3_BUCKET,
  savePuzzle,
  s3Client,
} from './crosswordScraper';
import { normalizeScrapedPuzzleAuthors } from './lib/authorNormalization';
import { formatDateKey, mapWithConcurrency } from './lib/utils';
import { PuzzleSource, PuzzleSources } from './scraper/PuzzleSource';
import { configureWebshareProxy } from './lib/webshareProxy';

const historicalSources: PuzzleSource[] = [
  PuzzleSources.NYT,
  //PuzzleSources.LAT,
  PuzzleSources.Newsday,
  PuzzleSources.WashingtonPost,
  PuzzleSources.WSJ,
  PuzzleSources.USAToday,
  PuzzleSources.NewYorker,
  //PuzzleSources.BEQ,
  PuzzleSources.Universal,
  PuzzleSources.UniversalSunday,
];

const SCRAPE_CONCURRENCY = 3;

/** All calendar days (local midnight) in the given year/month. month is 1-12. */
function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  // day 0 of the next month yields the last day of the target month.
  const dayCount = new Date(year, month, 0).getDate();
  for (let day = 1; day <= dayCount; day++) {
    days.push(new Date(year, month - 1, day));
  }
  return days;
}

async function puzzleAlreadyExistsInStorage(
  key: string,
  puzLocation: 'S3' | 'local',
): Promise<boolean> {
  if (puzLocation === 'S3') {
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  return fs.existsSync(path.join(LOCAL_PUZ_PATH, key));
}

export const scrapeHistoricalPuzzles = async (
  year: number,
  month: number,
  puzLocation: 'S3' | 'local',
): Promise<void> => {
  await configureWebshareProxy();

  const days = getDaysInMonth(year, month);
  const monthLabel = `${year}-${String(month).padStart(2, '0')}`;
  console.log(
    `Scraping ${days.length} days for ${monthLabel} across ${historicalSources.length} sources.`,
  );

  for (const date of days) {
    const dateString = formatDateKey(date);
    console.log(`Scraping puzzles for ${dateString}...`);

    await mapWithConcurrency(
      historicalSources,
      SCRAPE_CONCURRENCY,
      async (source): Promise<void> => {
        if (source.id === 'Newsday' && date.getFullYear() < 2024) {
          console.log(
            `Skipping Newsday for ${dateString} (only 2024+ supported).`,
          );
          return;
        }

        try {
          const puzzle = await source.getPuzzle(date);
          if (!puzzle) {
            console.log(`No puzzle found for ${source.name} on ${dateString}`);
            return;
          }

          normalizeScrapedPuzzleAuthors(puzzle);
          if (!PUZ_FILE_SOURCE_IDS.has(source.id)) {
            normalizePuzzleForPuzEncoding(puzzle);
          }

          const key = getPuzzleStorageKey(puzzle);
          if (await puzzleAlreadyExistsInStorage(key, puzLocation)) {
            console.log(
              `Puzzle already exists for ${source.name} on ${formatDateKey(puzzle.date)}, skipping.`,
            );
            return;
          }

          await savePuzzle(puzzle, key, puzLocation);
          console.log(`Scraped puzzle from ${source.name} for ${dateString}`);
        } catch (error) {
          console.error(
            `Error scraping puzzle from ${source.name} for ${dateString}: `,
            error,
          );
        }
      },
    );
  }
};

export const historicalScraper = async (
  year: number,
  month: number,
): Promise<void> => {
  const puzLocation = requirePuzLocation();
  const monthLabel = `${year}-${String(month).padStart(2, '0')}`;
  console.log(
    `Starting historical crossword scraping for ${monthLabel} (saving to ${puzLocation})...`,
  );

  try {
    await scrapeHistoricalPuzzles(year, month, puzLocation);
    console.log('Historical crossword scraping completed successfully.');
  } catch (error) {
    console.error('Error in historical crossword scraping: ', error);
    throw error;
  }
};
