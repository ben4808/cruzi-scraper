import { ScrapedPuzzle } from 'cruzi-models';
import { NewsdaySource } from '../sources/Newsday';
import { NYTSource } from '../sources/NYT';
import { WSJSource } from '../sources/WSJ';
import { LATSource } from '../sources/LAT';
import { UniversalSource } from '../sources/Universal';
import { WashingtonPostSource } from '../sources/WashingtonPost';
import { UniversalSundaySource } from '../sources/UniversalSunday';
import { USATodaySource } from '../sources/USAToday';
import { NewYorkerSource } from '../sources/NewYorker';
import { NewYorkSundaySource } from '../sources/NewYorkSunday';
import { BEQSource } from '../sources/BEQ';
import { CroceSource } from '../sources/Croce';
import { DailyCommuterSource } from '../sources/DailyCommuter';
import { BestCrosswordsSource } from '../sources/BestCrosswords';
import { PennyDellSource } from '../sources/PennyDell';
import { PennyDellSundaySource } from '../sources/PennyDellSunday';
import { JosephSource } from '../sources/Joseph';
import { ShefferSource } from '../sources/Sheffer';
import { PremierSource } from '../sources/Premier';
import { JonesinSource } from '../sources/Jonesin';
import { DailyPopSource } from '../sources/DailyPop';
import { AtlanticSource } from '../sources/Atlantic';
import { CrosswordClubSource } from '../sources/CrosswordClub';
import { DailyBeastSource } from '../sources/DailyBeast';
import { PuzzmoSource } from '../sources/Puzzmo';
import { PuzzmoBigSource } from '../sources/PuzzmoBig';
import { SimplyDailySource } from '../sources/SimplyDaily';
import { VoxSource } from '../sources/Vox';
import { VultureSource } from '../sources/Vulture';
import { TheWalrusSource } from '../sources/TheWalrus';
import { SlateSource } from '../sources/Slate';
import { TelegraphSource } from '../sources/Telegraph';
import { YourPuzzleSource } from '../sources/YourPuzzleSource';
import { MerriamWebsterSource } from '../sources/MerriamWebster';
import { SporcleSource } from '../sources/Sporcle';

export type PuzzleFetchMode = 'byDate' | 'latest';

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export interface PuzzleSource {
  id: string;
  name: string;
  getPuzzle: (date: Date) => Promise<ScrapedPuzzle | null>;
  /**
   * Days this source typically publishes, 0=Sunday .. 6=Saturday.
   * Defaults to every day. Ignored when `isPublishDate` is set.
   */
  publishDays?: readonly number[];
  /**
   * `byDate`: getPuzzle(date) fetches that publication date (can backfill).
   * `latest`: getPuzzle returns the current puzzle; call once per run.
   * Defaults to `byDate`.
   */
  fetchMode?: PuzzleFetchMode;
  /** If set, takes precedence over `publishDays`. */
  isPublishDate?: (date: Date) => boolean;
}

export function sourcePublishesOn(source: PuzzleSource, date: Date): boolean {
  if (source.isPublishDate) {
    return source.isPublishDate(date);
  }
  const days = source.publishDays ?? ALL_WEEKDAYS;
  return days.includes(date.getDay());
}

export function sourceFetchMode(source: PuzzleSource): PuzzleFetchMode {
  return source.fetchMode ?? 'byDate';
}

export const PuzzleSources = {
  NYT: new NYTSource(),
  Newsday: new NewsdaySource(),
  WSJ: new WSJSource(),
  LAT: new LATSource(),
  Universal: new UniversalSource(),
  UniversalSunday: new UniversalSundaySource(),
  USAToday: new USATodaySource(),
  NewYorker: new NewYorkerSource(),
  NewYorkSunday: new NewYorkSundaySource(),
  WashingtonPost: new WashingtonPostSource(),
  Joseph: new JosephSource(),
  Sheffer: new ShefferSource(),
  DailyCommuter: new DailyCommuterSource(),
  BestCrosswords: new BestCrosswordsSource(),
  Premier: new PremierSource(),
  Jonesin: new JonesinSource(),
  PennyDell: new PennyDellSource(),
  PennyDellSunday: new PennyDellSundaySource(),
  BEQ: new BEQSource(),
  Croce: new CroceSource(),
  DailyPop: new DailyPopSource(),
  Atlantic: new AtlanticSource(),
  CrosswordClub: new CrosswordClubSource(),
  DailyBeast: new DailyBeastSource(),
  Puzzmo: new PuzzmoSource(),
  PuzzmoBig: new PuzzmoBigSource(),
  SimplyDaily: new SimplyDailySource(),
  Vox: new VoxSource(),
  Vulture: new VultureSource(),
  TheWalrus: new TheWalrusSource(),
  Slate: new SlateSource(),
  Telegraph: new TelegraphSource(),
  YourPuzzleSource: new YourPuzzleSource(),
  MerriamWebster: new MerriamWebsterSource(),
  Sporcle: new SporcleSource(),
} as const;
