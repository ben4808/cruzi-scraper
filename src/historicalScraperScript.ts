/*
This script is a standalone script that can be run to scrape historical crossword puzzles.
It starts at January 2019 and goes through each month until the current month.
It runs one month every 10 minutes.
*/

import './loadLocalEnv';
import { historicalScraper } from './historicalScraper';

const START_YEAR = 2019;
const START_MONTH = 1; // January
const DELAY_BETWEEN_MONTHS_MS = 10 * 60 * 1000; // 10 minutes

function getCurrentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function* iterateMonths(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
): Generator<{ year: number; month: number }> {
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    yield { year, month };
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runHistoricalScraper(): Promise<void> {
  const { year: endYear, month: endMonth } = getCurrentYearMonth();
  console.log(
    `Starting historical scraper script from ${START_YEAR}-${String(START_MONTH).padStart(2, '0')} through ${endYear}-${String(endMonth).padStart(2, '0')}.`,
  );

  for (const { year, month } of iterateMonths(START_YEAR, START_MONTH, endYear, endMonth)) {
    const monthLabel = `${year}-${String(month).padStart(2, '0')}`;
    console.log(`\n=== Scraping ${monthLabel} ===`);
    try {
      await historicalScraper(year, month);
    } catch (error) {
      console.error(`Error scraping ${monthLabel}: `, error);
    }

    console.log(`Waiting ${DELAY_BETWEEN_MONTHS_MS / 60000} minutes before next month...`);
    await delay(DELAY_BETWEEN_MONTHS_MS);
  }

  console.log('Historical scraper script completed.');
}
