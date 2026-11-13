import { PublicationId } from 'cruzi-models';
import { fetchAmuseLabsFromPickerByOfficialDate } from '../lib/amuseLabs';
import { parseLooseDate } from '../lib/xdFormat';
import { toCalendarDate } from '../lib/utils';
import { PuzzleSource } from '../scraper/PuzzleSource';

const AMUSE_LABS_CONFIG = {
  pickerUrl: 'https://cdn3.amuselabs.com/tdb/date-picker?set=tdb',
  urlFromId: 'https://cdn3.amuselabs.com/tdb/crossword?id={puzzle_id}&set=tdb',
  setName: 'tdb',
};

export class DailyBeastSource implements PuzzleSource {
  public id = 'DailyBeast';
  public name = 'Daily Beast';
  public publishDays = [0, 1, 2, 3, 4];

  public async getPuzzle(date: Date) {
    if (date.getDay() === 5 || date.getDay() === 6) {
      return null;
    }

    const puzzle = await fetchAmuseLabsFromPickerByOfficialDate(
      AMUSE_LABS_CONFIG,
      date,
      {
        publicationId: this.id as PublicationId,
        sourceLink: 'https://www.thedailybeast.com/crossword-puzzles/',
      },
    );
    if (!puzzle) {
      return null;
    }

    const titleWithoutPeriods = puzzle.title.replace(/\./g, '');
    const parsedDate = parseLooseDate(titleWithoutPeriods);
    if (parsedDate) {
      puzzle.date = toCalendarDate(parsedDate);
    }

    return puzzle;
  }
}
