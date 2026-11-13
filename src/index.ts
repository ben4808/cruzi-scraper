import './loadLocalEnv';
import { crosswordScraper } from './crosswordScraper';
import { historicalScraper } from './historicalScraper';
import { runHistoricalScraper } from './historicalScraperScript';
import { nytLoader } from './nytLoader';
import { nytLoaderDb } from './nytLoader_db';
import { cruziLoaderFromProd } from './cruziLoaderFromProd';

crosswordScraper()
  .then(() => console.log('Crossword loading tasks completed successfully.'))
  .catch((error) => console.error('Error in crossword loading tasks: ', error));

// historicalScraper(2020, 2)
//   .then(() => console.log('Historical scraping tasks completed successfully.'))
//   .catch((error) => console.error('Error in historical scraping tasks: ', error));

// runHistoricalScraper()
//   .then(() => console.log('Historical scraping script completed successfully.'))
//   .catch((error) => console.error('Error in historical scraping script: ', error));

// nytLoader(new Date(1940, 11, 27))
//   .then(() => console.log('NYT archive loading completed successfully.'))
//   .catch((error) => console.error('Error in NYT archive loading: ', error));

// nytLoaderDb(new Date(2026, 7, 1), new Date(2026, 9, 31))
//   .then(() => console.log('NYT entry-tag loading completed successfully.'))
//   .catch((error) => console.error('Error in NYT entry-tag loading: ', error));

// cruziLoaderFromProd()
//   .then(() => console.log('Prod crossword load completed successfully.'))
//   .catch((error) => console.error('Error in prod crossword load: ', error));

// cruziLoaderFromProd(new Date(2026, 9, 1), new Date(2027, 9, 1))
//   .then(() => console.log('Prod crossword load completed successfully.'))
//   .catch((error) => console.error('Error in prod crossword load: ', error));
