import './loadLocalEnv';
import { crosswordScraper } from './crosswordScraper';
import { historicalScraper } from './historicalScraper';
import { runHistoricalScraper } from './historicalScraperScript';
import { nytLoader } from './nytLoader';

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
