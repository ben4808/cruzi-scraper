import { Context, APIGatewayProxyResult } from 'aws-lambda';
import { crosswordScraper } from './crosswordScraper';

/**
 * AWS Lambda handler for crossword scraping
 * Scrapes crossword puzzles from various sources
 */
export const handler = async (event: any, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('Crossword scraper Lambda started at:', new Date().toISOString());

  try {
    await crosswordScraper();

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Crossword scraping completed successfully',
        timestamp: new Date().toISOString()
      }),
    };
  } catch (error) {
    console.error('Error in crossword scraper Lambda:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Crossword scraping failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }),
    };
  }
};
