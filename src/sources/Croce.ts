import { proxiedFetch } from '../lib/proxiedFetch';
import { ScrapedPuzzle, PublicationId } from 'cruzi-models';
import { parse } from 'node-html-parser';
import { PuzzleSource } from '../scraper/PuzzleSource';
import { processPuzData } from "../lib/puzFiles";
import { isoDatetimeToPuzzleCalendarDate } from '../lib/utils';

const CROCE_HOMEPAGE_URL = 'https://club72.wordpress.com/';

interface CrocePostInfo {
  postedDate: string;
  puzUrl: string | null;
  postUrl: string;
  title: string;
}

function parseLatestCrocePost(html: string): CrocePostInfo | null {
  const root = parse(html);
  const article = root.querySelector('article');
  if (!article) {
    return null;
  }

  const titleEl = article.querySelector('.entry-title a');
  const timeEl = article.querySelector('time.entry-date');
  const entryContent = article.querySelector('.entry-content');

  let puzUrl: string | null = null;
  if (entryContent) {
    for (const link of entryContent.querySelectorAll('a')) {
      const href = link.getAttribute('href');
      const text = link.textContent?.trim().toUpperCase() ?? '';
      if (href && text.includes('PUZ')) {
        puzUrl = href;
        break;
      }
    }
  }

  const postedDate = timeEl?.getAttribute('datetime');
  if (!postedDate) {
    return null;
  }

  return {
    postedDate,
    puzUrl,
    postUrl: titleEl?.getAttribute('href') ?? '',
    title: titleEl?.textContent?.trim() ?? '',
  };
}

async function scrapeLatestCrocePost(): Promise<{ postInfo: CrocePostInfo; blob: Blob } | null> {
  const response = await proxiedFetch(CROCE_HOMEPAGE_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Croce homepage (${response.status}).`);
  }

  const postInfo = parseLatestCrocePost(await response.text());
  if (!postInfo) {
    console.log('Croce: No featured crossword found on homepage.');
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
