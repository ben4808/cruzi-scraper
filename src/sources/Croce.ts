import { proxiedFetch } from '../lib/proxiedFetch';
import { ScrapedPuzzle, PublicationId } from 'cruzi-models';
import { parse } from 'node-html-parser';
import { PuzzleSource } from '../scraper/PuzzleSource';
import { processPuzData } from "../lib/puzFiles";
import { isoDatetimeToPuzzleCalendarDate } from '../lib/utils';

const CROCE_HOMEPAGE_URL = 'https://club72.wordpress.com/';
const CROCE_POSTS_API_URL =
  'https://public-api.wordpress.com/rest/v1.1/sites/club72.wordpress.com/posts?number=1&fields=title,URL,date,content';

interface CrocePostInfo {
  postedDate: string;
  puzUrl: string | null;
  postUrl: string;
  title: string;
}

interface WordPressPost {
  date?: string;
  title?: string;
  URL?: string;
  content?: string;
}

interface WordPressPostsResponse {
  posts?: WordPressPost[];
}

function findPuzUrl(html: string): string | null {
  const root = parse(html);
  let puzUrl: string | null = null;

  for (const link of root.querySelectorAll('a')) {
    const href = link.getAttribute('href');
    const text = link.textContent?.trim().toUpperCase() ?? '';
    if (!href) {
      continue;
    }
    if (text.includes('PUZ') || /\.puz(\?|$)/i.test(href)) {
      puzUrl = href;
      break;
    }
  }

  return puzUrl;
}

function parseLatestCrocePost(apiJson: WordPressPostsResponse): CrocePostInfo | null {
  const post = apiJson.posts?.[0];
  if (!post?.date || !post.content) {
    return null;
  }

  return {
    postedDate: post.date,
    puzUrl: findPuzUrl(post.content),
    postUrl: post.URL ?? '',
    title: post.title?.trim() ?? '',
  };
}

async function scrapeLatestCrocePost(): Promise<{ postInfo: CrocePostInfo; blob: Blob } | null> {
  const response = await proxiedFetch(CROCE_POSTS_API_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Croce posts (${response.status}).`);
  }

  const postInfo = parseLatestCrocePost(await response.json() as WordPressPostsResponse);
  if (!postInfo) {
    console.log('Croce: No featured crossword found.');
    return null;
  }

  if (!postInfo.puzUrl) {
    console.log(`Croce: No PUZ link found for "${postInfo.title}".`);
    return null;
  }

  const absoluteUrl = postInfo.puzUrl.startsWith('http')
    ? postInfo.puzUrl
    : new URL(postInfo.puzUrl, CROCE_HOMEPAGE_URL).href;

  const puzResponse = await proxiedFetch(absoluteUrl);
  if (!puzResponse.ok) {
    throw new Error(`Failed to download Croce puzzle (${puzResponse.status}).`);
  }

  return {
    postInfo,
    blob: await puzResponse.blob(),
  };
}

export class CroceSource implements PuzzleSource {
    public id = "Croce";
    public name = "Club 72 (Croce)";

    public async getPuzzle(_date: Date): Promise<ScrapedPuzzle | null> {
      const result = await scrapeLatestCrocePost();
      if (!result) {
        return null;
      }

      const puzzle = await processPuzData(result.blob);
      if (!puzzle) {
        throw new Error("Failed to parse Croce puzzle data.");
      }

      const postedDate = isoDatetimeToPuzzleCalendarDate(result.postInfo.postedDate);

      puzzle.lang = "en";
      puzzle.publicationId = this.id as PublicationId;
      puzzle.date = postedDate;
      puzzle.sourceLink = result.postInfo.postUrl || CROCE_HOMEPAGE_URL;

      return puzzle;
    }
}
