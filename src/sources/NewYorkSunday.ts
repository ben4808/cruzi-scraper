import { proxiedFetch } from '../lib/proxiedFetch';
import { PublicationId, ScrapedPuzzle } from 'cruzi-models';
import { parse } from 'node-html-parser';
import { fetchAmuseLabsPuzzle, findAmuseLabsEmbedUrl } from '../lib/amuseLabs';
import { formatDateKey, getNearestSunday, getPuzzleDate, isoDatetimeToPuzzleCalendarDate } from '../lib/utils';
import { PuzzleSource } from '../scraper/PuzzleSource';

const USER_AGENT = 'cruzi-aws-crossword-scraper';
const GAMES_URL = 'https://nymag.com/games';
const WEEKLY_ARTICLE_PATH = '/article/weekly-crossword-puzzle-';

function findLatestWeeklyArticleUrl(html: string): string | null {
  const root = parse(html);
  for (const link of root.querySelectorAll('a')) {
    const href = link.getAttribute('href');
    if (!href) {
      continue;
    }

    try {
      const url = new URL(href, GAMES_URL);
      if (url.pathname.includes(WEEKLY_ARTICLE_PATH)) {
        return url.toString();
      }
    } catch {
      continue;
    }
  }

  return null;
}

function parseArticleDate(html: string): Date | null {
  const root = parse(html);
  const datetime = root.querySelector('time.article-timestamp')?.getAttribute('datetime');
  if (!datetime) {
    return null;
  }

  return isoDatetimeToPuzzleCalendarDate(datetime);
}

async function fetchNewYorkSundayPuzzle(
  date: Date,
  publicationId: PublicationId,
): Promise<ScrapedPuzzle | null> {
  const gamesResponse = await proxiedFetch(GAMES_URL, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!gamesResponse.ok) {
    throw new Error(`Unable to load ${GAMES_URL}`);
  }

  const articleUrl = findLatestWeeklyArticleUrl(await gamesResponse.text());
  if (!articleUrl) {
    throw new Error(`Can't find weekly crossword article on ${GAMES_URL}`);
  }

  const articleResponse = await proxiedFetch(articleUrl, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (articleResponse.status === 404) {
    return null;
  }
  if (!articleResponse.ok) {
    throw new Error(`Unable to load ${articleUrl}`);
  }

  const articleHtml = await articleResponse.text();
  const articleDate = parseArticleDate(articleHtml);
  const puzzleDate = getNearestSunday(articleDate ?? date);
  const today = getPuzzleDate();
  if (
    articleDate
    && formatDateKey(date) !== formatDateKey(articleDate)
    && formatDateKey(date) !== formatDateKey(puzzleDate)
    && formatDateKey(date) !== formatDateKey(today)
  ) {
    return null;
  }

  const solverUrl = findAmuseLabsEmbedUrl(articleHtml, articleUrl);
  if (!solverUrl) {
    throw new Error(`Can't find AmuseLabs embed on ${articleUrl}`);
  }

  const puzzle = await fetchAmuseLabsPuzzle(solverUrl, {
    publicationId,
    date: puzzleDate,
    sourceLink: articleUrl,
  });

  if (!puzzle.authors?.length) {
    puzzle.authors = ['Matt Gaffney'];
  }

  return puzzle;
}

export class NewYorkSundaySource implements PuzzleSource {
  public id = 'NewYorkSunday';
  public name = 'New York Magazine';

  public getPuzzle(date: Date) {
    return fetchNewYorkSundayPuzzle(date, this.id as PublicationId);
  }
}
