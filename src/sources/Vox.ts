import { PublicationId } from 'cruzi-models';
import { fetchAmuseLabsLatestFromPicker } from '../lib/amuseLabs';
import { formatDateKey, formatPuzzleTitleDate, getPuzzleDate } from '../lib/utils';
import { PuzzleSource } from '../scraper/PuzzleSource';

export class VoxSource implements PuzzleSource {
  public id = 'Vox';
  public name = 'Vox';

  public async getPuzzle(date: Date) {
    const today = getPuzzleDate();
    if (formatDateKey(date) !== formatDateKey(today)) {
      return null;
    }

    const puzzle = await fetchAmuseLabsLatestFromPicker(
      {
        pickerUrl: 'https://cdn3.amuselabs.com/vox/date-picker?set=vox',
        urlFromId: 'https://cdn3.amuselabs.com/vox/crossword?id={puzzle_id}&set=vox',
        setName: 'vox',
      },
      {
        publicationId: this.id as PublicationId,
        date,
        sourceLink: 'https://www.vox.com/culture',
      },
    );

    if (puzzle && !puzzle.title) {
      puzzle.title = formatPuzzleTitleDate(date);
    }

    return puzzle;
  }
}
