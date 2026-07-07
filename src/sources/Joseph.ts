import { PublicationId, ScrapedPuzzle } from 'cruzi-models';
import { fetchKingFeaturesPuzzle } from '../lib/kingFeaturesPuzzle';
import { PuzzleSource } from '../scraper/PuzzleSource';

export class JosephSource implements PuzzleSource {
  public id = 'Joseph';
  public name = 'Joseph';

  public async getPuzzle(date: Date): Promise<ScrapedPuzzle | null> {
    if (date.getDay() === 0) {
      return null;
    }

    const puzzle = await fetchKingFeaturesPuzzle('joseph', date, {
      publicationId: this.id as PublicationId,
      defaultTitle: 'Joseph',
      parseErrorMessage: 'Failed to parse Joseph puzzle data.',
    });

    if (puzzle) {
      puzzle.authors = ['Joseph'];
    }
    return puzzle;
  }
}
