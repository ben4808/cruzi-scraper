/**
 * Copies crossword puzzles from the AWS database (.env.dev) into the local
 * database (.env.local).
 *
 * cruziLoaderFromProd(fromDate, toDate) loads every puzzle whose calendar date
 * is inside that inclusive range and whose publication_id + date pair is not
 * already in the local puzzle table (one puzzle per publication per day).
 * With no arguments, the range is seven days ago through today. If only
 * fromDate is passed, the range runs through today.
 *
 * Puzzle rows are queried first. Each puzzle then gets its own AWS query for
 * clue collections and clues.
 *
 * AWS and local schemas are not identical. Puzzle, collection__clue, and
 * entry_tags match. AWS clue has no source or match_attempted columns, and
 * AWS clue_collection has no magic_puzzle_id. Those local columns keep their
 * defaults. Clue sense_id and collection creator_id are not copied: both are
 * foreign keys to rows that may not exist locally. AWS entry has entry_type
 * and root_entry instead of the local classification / scoring columns, so
 * entry text is not copied onto existing rows. Missing entries are inserted
 * through insert_entries (display_text left null). Each of those new entries
 * gets an entry_tags row: tag "scraped-crossword", value
 * "<publication_id> MM-DD-YYYY" (for example "NYT 09-09-2026").
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';

import dotenv from 'dotenv';

import './loadLocalEnv';
import { formatDateKey, toCalendarDate } from './lib/utils';

const ID_CHAR_POOL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';

interface PgQueryResult {
  rows: Record<string, unknown>[];
}

interface PgClient {
  query: (text: string, values?: unknown[]) => Promise<PgQueryResult>;
  release: () => void;
}

interface PgPool {
  query: (text: string, values?: unknown[]) => Promise<PgQueryResult>;
  connect: () => Promise<PgClient>;
  end: () => Promise<void>;
}

interface PgModule {
  Pool: new (config: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    connectionTimeoutMillis?: number;
  }) => PgPool;
}

interface DbEnv {
  DB_HOST: string;
  DB_PORT: string;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
}

interface AwsPuzzleRow {
  id: string;
  publication_id: string;
  date: string;
  lang: string;
  author: string | null;
  title: string;
  copyright: string | null;
  notes: string | null;
  width: number;
  height: number;
  source_link: string | null;
}

interface CopiedClue {
  entry: string;
  lang: string;
  customClue: string | null;
  customDisplayText: string | null;
  order: number;
  metadata1: string | null;
  metadata2: string | null;
}

interface CopiedCollection {
  title: string;
  lang: string;
  author: string | null;
  description: string | null;
  isPrivate: boolean;
  createdDate: string;
  modifiedDate: string;
  metadata1: string | null;
  metadata2: string | null;
  source: string | null;
  clues: CopiedClue[];
}

const requireFromDb = createRequire(require.resolve('cruzi-db'));
const { Pool } = requireFromDb('pg') as PgModule;

function generateId(): string {
  let id = '';
  for (let i = 0; i < 11; i++) {
    id += ID_CHAR_POOL[Math.floor(Math.random() * ID_CHAR_POOL.length)];
  }
  return id;
}

function puzzleKey(publicationId: string, isoDate: string): string {
  return `${publicationId}|${isoDate}`;
}

/** "NYT 09-09-2026" from publication id and YYYY-MM-DD. */
function scrapedCrosswordTagValue(publicationId: string, isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${publicationId} ${month}-${day}-${year}`;
}

function textOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function readEnvFile(envPath: string): DbEnv {
  const env = dotenv.parse(fs.readFileSync(envPath));
  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'] as const;
  for (const key of required) {
    if (!env[key]) {
      throw new Error(`Missing ${key} in ${envPath}`);
    }
  }
  return env as unknown as DbEnv;
}

function createPool(env: DbEnv): PgPool {
  return new Pool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    connectionTimeoutMillis: 20000,
  });
}

function createAwsPool(): PgPool {
  return createPool(readEnvFile(path.resolve(__dirname, '../.env.dev')));
}

function createLocalPool(): PgPool {
  const host = process.env.DB_HOST;
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  if (!host || !database || !user || password == null) {
    throw new Error('Local database env is missing. Expected DB_* from .env.local.');
  }
  return createPool({
    DB_HOST: host,
    DB_PORT: process.env.DB_PORT || '5432',
    DB_NAME: database,
    DB_USER: user,
    DB_PASSWORD: password,
  });
}

async function loadLocalPuzzleKeys(local: PgPool): Promise<Set<string>> {
  const result = await local.query(
    `SELECT publication_id, to_char("date", 'YYYY-MM-DD') AS date FROM puzzle`,
  );
  const keys = new Set<string>();
  for (const row of result.rows) {
    const publicationId = textOrNull(row.publication_id);
    const date = textOrNull(row.date);
    if (!publicationId || !date) {
      continue;
    }
    keys.add(puzzleKey(publicationId, date));
  }
  return keys;
}

async function loadAwsPuzzles(
  aws: PgPool,
  fromIso: string,
  toIso: string,
): Promise<AwsPuzzleRow[]> {
  const result = await aws.query(
    `SELECT id,
            publication_id,
            to_char("date", 'YYYY-MM-DD') AS date,
            lang,
            author,
            title,
            copyright,
            notes,
            width,
            height,
            source_link
     FROM puzzle
     WHERE "date" >= $1::date
       AND "date" <= $2::date
     ORDER BY "date", publication_id, id`,
    [fromIso, toIso],
  );
  const puzzles: AwsPuzzleRow[] = [];
  for (const row of result.rows) {
    const publicationId = textOrNull(row.publication_id);
    const date = textOrNull(row.date);
    if (!publicationId || !date) {
      console.log(`Skipping AWS puzzle ${row.id} with no publication or date.`);
      continue;
    }
    puzzles.push({
      id: String(row.id),
      publication_id: publicationId,
      date,
      lang: String(row.lang ?? 'en'),
      author: textOrNull(row.author),
      title: String(row.title),
      copyright: textOrNull(row.copyright),
      notes: textOrNull(row.notes),
      width: Number(row.width),
      height: Number(row.height),
      source_link: textOrNull(row.source_link),
    });
  }
  return puzzles;
}

async function loadAwsCollections(aws: PgPool, puzzleId: string): Promise<CopiedCollection[]> {
  const result = await aws.query(
    `SELECT cc.id AS collection_id,
            cc.title,
            cc.lang,
            cc.author,
            cc.description,
            cc.is_private,
            to_char(cc.created_date, 'YYYY-MM-DD HH24:MI:SS.MS') AS created_date,
            to_char(cc.modified_date, 'YYYY-MM-DD HH24:MI:SS.MS') AS modified_date,
            cc.metadata1,
            cc.metadata2,
            cc.source,
            c.entry AS clue_entry,
            c.lang AS clue_lang,
            c.custom_clue,
            c.custom_display_text,
            link."order" AS clue_order,
            link.metadata1 AS clue_metadata1,
            link.metadata2 AS clue_metadata2
     FROM clue_collection cc
     LEFT JOIN collection__clue link ON link.collection_id = cc.id
     LEFT JOIN clue c ON c.id = link.clue_id
     WHERE cc.puzzle_id = $1
     ORDER BY cc.id, link."order"`,
    [puzzleId],
  );

  const collections = new Map<string, CopiedCollection>();
  for (const row of result.rows) {
    const collectionId = String(row.collection_id);
    let collection = collections.get(collectionId);
    if (!collection) {
      collection = {
        title: String(row.title),
        lang: String(row.lang ?? 'en'),
        author: textOrNull(row.author),
        description: textOrNull(row.description),
        isPrivate: Boolean(row.is_private),
        createdDate: String(row.created_date),
        modifiedDate: String(row.modified_date),
        metadata1: textOrNull(row.metadata1),
        metadata2: textOrNull(row.metadata2),
        source: textOrNull(row.source),
        clues: [],
      };
      collections.set(collectionId, collection);
    }

    const entry = textOrNull(row.clue_entry);
    if (!entry) {
      continue;
    }

    collection.clues.push({
      entry,
      lang: String(row.clue_lang ?? collection.lang ?? 'en'),
      customClue: textOrNull(row.custom_clue),
      customDisplayText: textOrNull(row.custom_display_text),
      order: row.clue_order == null ? collection.clues.length : Number(row.clue_order),
      metadata1: textOrNull(row.clue_metadata1),
      metadata2: textOrNull(row.clue_metadata2),
    });
  }

  return Array.from(collections.values());
}

async function findExistingEntries(
  client: PgClient,
  entries: string[],
  lang: string,
): Promise<Set<string>> {
  if (entries.length === 0) {
    return new Set();
  }

  const result = await client.query(
    `SELECT e."entry"
     FROM "entry" e
     INNER JOIN jsonb_array_elements_text($1::jsonb) AS wanted("entry")
       ON e."entry" = wanted."entry"
     WHERE e.lang = $2`,
    [JSON.stringify(entries), lang],
  );
  return new Set(result.rows.map((row) => String(row.entry)));
}

async function insertMissingEntries(
  client: PgClient,
  entries: string[],
  lang: string,
  publicationId: string,
  isoDate: string,
): Promise<number> {
  const uniqueEntries = Array.from(new Set(entries));
  const existing = await findExistingEntries(client, uniqueEntries, lang);
  const missing = uniqueEntries.filter((entry) => !existing.has(entry));
  if (missing.length === 0) {
    return 0;
  }

  await client.query(`SELECT insert_entries($1::jsonb)`, [
    JSON.stringify(
      missing.map((entry) => ({
        entry,
        lang,
        length: entry.length,
        display_text: null,
      })),
    ),
  ]);

  const tagValue = scrapedCrosswordTagValue(publicationId, isoDate);
  await client.query(`SELECT add_entry_tags($1::jsonb)`, [
    JSON.stringify(
      missing.map((entry) => ({
        entry,
        lang,
        tag: 'scraped-crossword',
        value: tagValue,
      })),
    ),
  ]);

  return missing.length;
}

async function insertPuzzle(client: PgClient, puzzle: AwsPuzzleRow): Promise<string> {
  const puzzleId = generateId();
  await client.query(
    `SELECT add_puzzle($1, $2, $3::date, $4, $5, $6, $7, $8, $9::int, $10::int, $11)`,
    [
      puzzleId,
      puzzle.publication_id,
      puzzle.date,
      puzzle.lang || 'en',
      puzzle.author,
      puzzle.title,
      puzzle.copyright,
      puzzle.notes,
      puzzle.width,
      puzzle.height,
      puzzle.source_link,
    ],
  );
  return puzzleId;
}

async function insertCollection(
  client: PgClient,
  puzzleId: string,
  puzzle: AwsPuzzleRow,
  collection: CopiedCollection,
): Promise<void> {
  const clues = [...collection.clues].sort((a, b) => a.order - b.order);
  const collectionId = generateId();
  const clueCount6Plus = clues.filter((clue) => clue.entry.length >= 6).length;

  await client.query(
    `SELECT add_clue_collection($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamp, $10::timestamp, $11, $12, $13::int, $14::int, $15)`,
    [
      collectionId,
      puzzleId,
      collection.title,
      collection.lang || puzzle.lang || 'en',
      collection.author ?? '',
      '',
      collection.description ?? '',
      collection.isPrivate,
      collection.createdDate,
      collection.modifiedDate,
      collection.metadata1 ?? '',
      collection.metadata2 ?? '',
      clues.length,
      clueCount6Plus,
      collection.source ?? puzzle.publication_id,
    ],
  );

  if (clues.length === 0) {
    return;
  }

  const cluesData = clues.map((clue, index) => ({
    collection_id: collectionId,
    id: generateId(),
    order: index,
    entry: clue.entry,
    lang: clue.lang,
    sense_id: null,
    custom_clue: clue.customClue,
    custom_display_text: clue.customDisplayText,
    metadata1: clue.metadata1,
    metadata2: clue.metadata2,
  }));

  await client.query(`SELECT add_clues_to_collection($1::jsonb)`, [JSON.stringify(cluesData)]);
}

async function copyPuzzle(aws: PgPool, local: PgPool, puzzle: AwsPuzzleRow): Promise<void> {
  const collections = await loadAwsCollections(aws, puzzle.id);
  const client = await local.connect();
  try {
    await client.query('BEGIN');

    const entriesByLang = new Map<string, string[]>();
    for (const collection of collections) {
      for (const clue of collection.clues) {
        const lang = clue.lang || puzzle.lang || 'en';
        const list = entriesByLang.get(lang) ?? [];
        list.push(clue.entry);
        entriesByLang.set(lang, list);
      }
    }

    let newEntryCount = 0;
    for (const [lang, entries] of entriesByLang) {
      newEntryCount += await insertMissingEntries(
        client,
        entries,
        lang,
        puzzle.publication_id,
        puzzle.date,
      );
    }

    const puzzleId = await insertPuzzle(client, puzzle);
    for (const collection of collections) {
      await insertCollection(client, puzzleId, puzzle, collection);
    }

    await client.query('COMMIT');

    const clueCount = collections.reduce((sum, collection) => sum + collection.clues.length, 0);
    console.log(
      `${puzzle.publication_id} ${puzzle.date}: saved ${clueCount} clues, ${newEntryCount} new entries.`,
    );
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(`Rollback failed for ${puzzle.publication_id} ${puzzle.date}.`, rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

function shiftCalendarDays(date: Date, days: number): Date {
  const shifted = toCalendarDate(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

export async function cruziLoaderFromProd(fromDate?: Date, toDate?: Date): Promise<void> {
  const end = toCalendarDate(toDate ?? new Date());
  const start = toCalendarDate(fromDate ?? shiftCalendarDays(end, -7));
  const fromIso = formatDateKey(start);
  const toIso = formatDateKey(end);
  if (fromIso > toIso) {
    throw new Error(`Start date ${fromIso} is after end date ${toIso}.`);
  }
  console.log(`Starting prod crossword load for puzzles from ${fromIso} through ${toIso}.`);

  const aws = createAwsPool();
  const local = createLocalPool();
  try {
    const localKeys = await loadLocalPuzzleKeys(local);
    const awsPuzzles = await loadAwsPuzzles(aws, fromIso, toIso);
    const toLoad: AwsPuzzleRow[] = [];
    const queued = new Set<string>();
    let alreadyLocal = 0;
    let duplicateAws = 0;

    for (const puzzle of awsPuzzles) {
      const key = puzzleKey(puzzle.publication_id, puzzle.date);
      if (localKeys.has(key)) {
        alreadyLocal += 1;
        continue;
      }
      if (queued.has(key)) {
        duplicateAws += 1;
        console.log(
          `Skipping extra AWS puzzle ${puzzle.id} for ${puzzle.publication_id} ${puzzle.date}.`,
        );
        continue;
      }
      queued.add(key);
      toLoad.push(puzzle);
    }

    console.log(
      `AWS puzzles from ${fromIso} through ${toIso}: ${awsPuzzles.length}. Already local: ${alreadyLocal}. Duplicate AWS rows: ${duplicateAws}. To load: ${toLoad.length}.`,
    );

    let loaded = 0;
    let failed = 0;
    for (const puzzle of toLoad) {
      try {
        await copyPuzzle(aws, local, puzzle);
        loaded += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `Failed to copy ${puzzle.publication_id} ${puzzle.date} (${puzzle.id}).`,
          error,
        );
      }
    }

    console.log(`Prod crossword load finished. loaded=${loaded} failed=${failed}`);
    if (failed > 0) {
      throw new Error(`${failed} puzzle(s) failed to copy from prod.`);
    }
  } finally {
    await aws.end();
    await local.end();
  }
}
