import { proxiedFetch } from '../lib/proxiedFetch';
import { fetchWsjPuzzleFromPuzzlr } from '../lib/wsj';
import { ScrapedPuzzle, PublicationId } from 'cruzi-models';
import { PuzzleSource } from '../scraper/PuzzleSource';
import { processPuzData } from '../lib/puzFiles';
import { formatDateKey2 } from '../lib/utils';

function normalizeHerbachAuthors(puzzle: ScrapedPuzzle): void {
  if (!puzzle.authors?.[0]) {
    return;
  }

  let author = puzzle.authors[0];
  if (author.startsWith('By ')) {
    author = author.slice(3);
  }
  author = author.replace('/Edited by Mike Shenk', '');
  puzzle.authors[0] = author.trim();
}

async function fetchHerbachPuzzle(date: Date, publicationId: PublicationId): Promise<ScrapedPuzzle | null> {
  const dateString = formatDateKey2(date);
  const url = `https://herbach.dnsalias.com/wsj/wsj${dateString}.puz`;
  const response = await proxiedFetch(url);
  if (!response.ok) {
    return null;
  }

  const blobResponse = await response.blob();
  const puzzle = await processPuzData(blobResponse);
  if (!puzzle) {
    throw new Error('Failed to parse WSJ puzzle data from Herbach.');
  }

  puzzle.lang = 'en';
  puzzle.publicationId = publicationId;
  puzzle.date = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  puzzle.sourceLink = url;
  normalizeHerbachAuthors(puzzle);
  return puzzle;
}

export class WSJSource implements PuzzleSource {
  public id = 'WSJ';
  public name = 'Wall Street Journal';

  public async getPuzzle(date: Date): Promise<ScrapedPuzzle | null> {
    // Return null if the date is a Friday or Sunday. WSJ doesn't include solutions for Friday contest puzzles.
    // It doesn't publish puzzles on Sundays.
    if (date.getDay() === 5 || date.getDay() === 0) {
      return null;
    }

    const publicationId = this.id as PublicationId;
    const herbachPuzzle = await fetchHerbachPuzzle(date, publicationId);
    if (herbachPuzzle) {
      return herbachPuzzle;
    }

    return fetchWsjPuzzleFromPuzzlr(date, publicationId);
  }
}
