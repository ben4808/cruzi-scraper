import { PublicationId } from 'cruzi-models';
import { fetchSporcleSundayPuzzle } from '../lib/sporcle';
import { PuzzleSource } from '../scraper/PuzzleSource';

export class SporcleSource implements PuzzleSource {
  public id = 'Sporcle';
  public name = 'Sporcle';
  public publishDays = [0];
  public fetchMode = 'latest' as const;

  public async getPuzzle(_date: Date) {
    return fetchSporcleSundayPuzzle({
      publicationId: this.id as PublicationId,
    });
  }
}
