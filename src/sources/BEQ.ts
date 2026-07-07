import { proxiedFetch } from '../lib/proxiedFetch';
import { ScrapedPuzzle, PublicationId } from 'cruzi-models';
import { parse } from 'node-html-parser';
import { PuzzleSource } from '../scraper/PuzzleSource';
import { processPuzData } from "../lib/puzFiles";
import { isoDatetimeToPuzzleCalendarDate } from '../lib/utils';

const BEQ_HOMEPAGE_URL = 'https://brendanemmettquigley.com/';

interface BeqPostInfo {
  postedDate: string;
  acrossLiteUrl: string | null;
  postUrl: string;
  title: string;
}

function parseLatestBeqPost(html: string): BeqPostInfo | null {
  const root = parse(html);
  const article = root.querySelector('article');
  if (!article) {
    return null;
  }

  const titleEl = article.querySelector('.entry-title a');
  const timeEl = article.querySelector('time.entry-date.published');
  const entryContent = article.querySelector('.entry-content');

  let acrossLiteUrl: string | null = null;
  if (entryContent) {
    for (const link of entryContent.querySelectorAll('a')) {
      const href = link.getAttribute('href');
      if (href && /\.puz$/i.test(href)) {
        acrossLiteUrl = href;
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
    acrossLiteUrl,
    postUrl: titleEl?.getAttribute('href') ?? '',
    title: titleEl?.textContent?.trim() ?? '',
  };
}

async function scrapeLatestBeqPost(): Promise<{ postInfo: BeqPostInfo; blob: Blob } | null> {
  const response = await proxiedFetch(BEQ_HOMEPAGE_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch BEQ homepage (${response.status}).`);
  }

  const postInfo = parseLatestBeqPost(await response.text());
  if (!postInfo) {
    console.log('BEQ: No featured crossword found on homepage.');
    return null;
  }

  if (!postInfo.acrossLiteUrl) {
    console.log(`BEQ: No .puz link found for "${postInfo.title}".`);
    return null;
  }

  const absoluteUrl = postInfo.acrossLiteUrl.startsWith('http')
    ? postInfo.acrossLiteUrl
    : new URL(postInfo.acrossLiteUrl, BEQ_HOMEPAGE_URL).href;

  const puzResponse = await proxiedFetch(absoluteUrl);
  if (!puzResponse.ok) {
    throw new Error(`Failed to download BEQ puzzle (${puzResponse.status}).`);
  }

  return {
    postInfo,
    blob: await puzResponse.blob(),
  };
}

export class BEQSource implements PuzzleSource {
    public id = "BEQ";
    public name = "Brendan Emmett Quigley";

    public async getPuzzle(_date: Date): Promise<ScrapedPuzzle | null> {
      const result = await scrapeLatestBeqPost();
      if (!result) {
        return null;
      }

      const puzzle = await processPuzData(result.blob);
      if (!puzzle) {
        throw new Error("Failed to parse BEQ puzzle data.");
      }

      const postedDate = isoDatetimeToPuzzleCalendarDate(result.postInfo.postedDate);

      puzzle.lang = "en";
      puzzle.publicationId = this.id as PublicationId;
      puzzle.date = postedDate;
      puzzle.sourceLink = result.postInfo.postUrl || BEQ_HOMEPAGE_URL;

      return puzzle;
    }
}
