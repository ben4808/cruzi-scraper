import { PublicationId, ScrapedPuzzle } from 'cruzi-models';

export function normalizeAuthorString(author: string, publicationId?: PublicationId): string {
  let result = author.trim();

  result = result.replace(/^(?:by)\s*[:\-]?\s+/i, '');

  if (publicationId === 'Atlantic') {
    result = result.replace(/;\s*edited by\s+.+$/i, '');
  } else if (publicationId === 'Croce') {
    result = result.replace(/,\s*club72\.wordpress\.com$/i, '');
  } else if (publicationId === 'LAT') {
    result = result.replace(/\s*\/\s*Ed\.\s+.+$/i, '');
  }

  return result.trim();
}

export function normalizeScrapedPuzzleAuthors(puzzle: ScrapedPuzzle): void {
  if (!puzzle.authors?.length) {
    return;
  }

  const authors = puzzle.authors
    .map((author) => normalizeAuthorString(author, puzzle.publicationId))
    .filter((author) => author.length > 0);

  puzzle.authors = authors.length > 0 ? authors : undefined;
}
