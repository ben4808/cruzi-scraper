import { crosswordScraper } from './crosswordScraper';

crosswordScraper()
  .then(() => console.log('Crossword loading tasks completed successfully.'))
  .catch((error) => console.error('Error in crossword loading tasks: ', error));
