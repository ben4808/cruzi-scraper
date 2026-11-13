import { PublicationId } from 'cruzi-models';
import { fetchAmuseLabsLatestFromPicker } from '../lib/amuseLabs';
import { calendarDateOnWeekday } from '../lib/utils';
import { PuzzleSource } from '../scraper/PuzzleSource';

export class TheWalrusSource implements PuzzleSource {
  public id = 'TheWalrus';
  public name = 'The Walrus';
  public publishDays = [5];
  public fetchMode = 'latest' as const;

  public async getPuzzle(date: Date) {
    const puzzle = await fetchAmuseLabsLatestFromPicker(
      {
        pickerUrl: 'https://cdn2.amuselabs.com/pmm/date-picker?set=walrus-weekly-crossword',
        urlFromId: 'https://cdn2.amuselabs.com/pmm/crossword?id={puzzle_id}&set=walrus-weekly-crossword',
        setName: 'walrus-weekly-crossword',
      },
      {
        publicationId: this.id as PublicationId,
        date,
        sourceLink: 'https://thewalrus.ca/weekly-crossword/',
      },
    );

    puzzle.date = calendarDateOnWeekday(puzzle.date, 5);
    return puzzle;
  }
}
