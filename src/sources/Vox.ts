import { PublicationId } from 'cruzi-models';
import {
  fetchAmuseLabsFromPickerByOfficialDate,
  fetchAmuseLabsLatestFromPicker,
} from '../lib/amuseLabs';
import { parseLooseDate } from '../lib/xdFormat';
import { formatDateKey, formatPuzzleTitleDate, getPuzzleDate, toCalendarDate } from '../lib/utils';
import { PuzzleSource } from '../scraper/PuzzleSource';

const AMUSE_LABS_CONFIG = {
  pickerUrl: 'https://cdn3.amuselabs.com/vox/date-picker?set=vox',
  urlFromId: 'https://cdn3.amuselabs.com/vox/crossword?id={puzzle_id}&set=vox',
  setName: 'vox',
};

export class VoxSource implements PuzzleSource {
  public id = 'Vox';
  public name = 'Vox';
  public publishDays = [1, 2, 3, 4, 5, 6];

  public async getPuzzle(date: Date) {
    if (date.getDay() === 0) {
      return null;
    }

    const puzzle = await fetchAmuseLabsFromPickerByOfficialDate(
      AMUSE_LABS_CONFIG,
      date,
      {
        publicationId: this.id as PublicationId,
        sourceLink: 'https://www.vox.com/culture',
      },
    ) ?? (
      formatDateKey(date) === formatDateKey(getPuzzleDate())
        ? await fetchAmuseLabsLatestFromPicker(
          AMUSE_LABS_CONFIG,
          {
            publicationId: this.id as PublicationId,
            date,
            sourceLink: 'https://www.vox.com/culture',
          },
        )
        : null
    );

    if (!puzzle) {
      return null;
    }

    const parsedDate = parseLooseDate(puzzle.title.replace(/\./g, ''));
    if (parsedDate) {
      puzzle.date = toCalendarDate(parsedDate);
    } else {
      puzzle.date = toCalendarDate(date);
    }

    if (!puzzle.title) {
      puzzle.title = formatPuzzleTitleDate(puzzle.date);
    }

    return puzzle;
  }
}
