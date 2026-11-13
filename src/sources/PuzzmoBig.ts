import { PublicationId } from 'cruzi-models';
import { fetchPuzzmoBigPuzzle, isPuzzmoBigPublishDate } from '../lib/puzzmo';
import { PuzzleSource } from '../scraper/PuzzleSource';

export class PuzzmoBigSource implements PuzzleSource {
  public id = 'PuzzmoBig';
  public name = 'Puzzmo Big';
  public fetchMode = 'latest' as const;
  public isPublishDate = isPuzzmoBigPublishDate;

  public getPuzzle(date: Date) {
    return fetchPuzzmoBigPuzzle(date, {
      publicationId: this.id as PublicationId,
    });
  }
}
