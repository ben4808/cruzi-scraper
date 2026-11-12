/**
 * Tags entries for New York Times puzzles that are already in the local database.
 *
 * loadNytPuzzlesFromDb(startDate, endDate) selects puzzles with publication_id
 * 'NYT' whose calendar date is inside that inclusive range. For each puzzle it
 * inserts any missing entry rows, then inserts or increments entry_tags the
 * same way nytLoader.ts does:
 * - "nyt-ps" if the puzzle is pre-Shortz (before Nov 21, 1993)
 * - "nyt-s" if the puzzle is Shortz-era (Nov 21, 1993 or later)
 * - "nyt" in any case
 * If the entry_tags row already exists, the value is incremented by 1.
 *
 * Each distinct entry in a puzzle is counted once, matching nytLoader.ts.
 * This loader reads and writes only the local database (.env.local). It does
 * not open the AWS database, read .puz files, or fetch puzzles from the web.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';

import dotenv from 'dotenv';

import { formatDateKey, toCalendarDate } from './lib/utils';

const SHORTZ_ERA_START = '1993-11-21';

interface PgQueryResult {
  rows: Record<string, unknown>[];
}

interface PgPool {
  query: (text: string, values?: unknown[]) => Promise<PgQueryResult>;
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

interface NytPuzzleEntries {
  id: string;
  date: string;
  lang: string;
  entries: string[];
}

const requireFromDb = createRequire(require.resolve('cruzi-db'));
const { Pool } = requireFromDb('pg') as PgModule;

function eraTag(isoDate: string): 'nyt-ps' | 'nyt-s' {
  return isoDate < SHORTZ_ERA_START ? 'nyt-ps' : 'nyt-s';
}

function textOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function readLocalEnv(): DbEnv {
  const envPath = path.resolve(__dirname, '../.env.local');
  const env = dotenv.parse(fs.readFileSync(envPath));
  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'] as const;
  for (const key of required) {
    if (!env[key]) {
      throw new Error(`Missing ${key} in ${envPath}`);
    }
  }
  return env as unknown as DbEnv;
}

function createLocalPool(): PgPool {
  const env = readLocalEnv();
  return new Pool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    connectionTimeoutMillis: 20000,
  });
}

async function loadNytPuzzleEntries(
  local: PgPool,
  fromIso: string,
  toIso: string,
): Promise<NytPuzzleEntries[]> {
  const result = await local.query(
    `SELECT p.id,
            to_char(p."date", 'YYYY-MM-DD') AS date,
            COALESCE(p.lang, 'en') AS lang,
            c."entry" AS entry
     FROM puzzle p
     LEFT JOIN clue_collection cc ON cc.puzzle_id = p.id
     LEFT JOIN collection__clue link ON link.collection_id = cc.id
     LEFT JOIN clue c ON c.id = link.clue_id
     WHERE p.publication_id = 'NYT'
       AND p."date" >= $1::date
       AND p."date" <= $2::date
     ORDER BY p."date", p.id, c."entry"`,
    [fromIso, toIso],
  );

  const puzzles: NytPuzzleEntries[] = [];
  const byId = new Map<string, NytPuzzleEntries>();

  for (const row of result.rows) {
    const id = String(row.id);
    let puzzle = byId.get(id);
    if (!puzzle) {
      const date = textOrNull(row.date);
      if (!date) {
        console.log(`Skipping NYT puzzle ${id} with no date.`);
        continue;
      }
      puzzle = {
        id,
        date,
        lang: textOrNull(row.lang) || 'en',
        entries: [],
      };
      byId.set(id, puzzle);
      puzzles.push(puzzle);
    }

    const entry = textOrNull(row.entry)?.trim() ?? '';
    if (!entry || puzzle.entries.includes(entry)) {
      continue;
    }
    puzzle.entries.push(entry);
  }

  return puzzles;
}

async function tagNytPuzzleEntries(local: PgPool, puzzle: NytPuzzleEntries): Promise<void> {
  const { entries, lang } = puzzle;
  if (entries.length === 0) {
    return;
  }

  const tag = eraTag(puzzle.date);
  await local.query(`SELECT insert_entries($1::jsonb)`, [
    JSON.stringify(
      entries.map((entry) => ({
        entry,
        lang,
        length: entry.length,
        display_text: '',
      })),
    ),
  ]);
  await local.query(`SELECT add_entry_tags($1::jsonb)`, [
    JSON.stringify([
      ...entries.map((entry) => ({
        entry,
        lang,
        tag,
        value: '1',
      })),
      ...entries.map((entry) => ({
        entry,
        lang,
        tag: 'nyt',
        value: '1',
      })),
    ]),
  ]);
}

export async function loadNytPuzzlesFromDb(startDate: Date, endDate: Date): Promise<void> {
  const fromIso = formatDateKey(toCalendarDate(startDate));
  const toIso = formatDateKey(toCalendarDate(endDate));
  if (fromIso > toIso) {
    throw new Error(`Start date ${fromIso} is after end date ${toIso}.`);
  }

  console.log(`Starting NYT entry-tag loader for local puzzles from ${fromIso} through ${toIso}.`);
  const local = createLocalPool();
  try {
    const puzzles = await loadNytPuzzleEntries(local, fromIso, toIso);
    console.log(`Found ${puzzles.length} NYT puzzles in the local database.`);

    let tagged = 0;
    let empty = 0;
    let failed = 0;

    for (const puzzle of puzzles) {
      try {
        if (puzzle.entries.length === 0) {
          empty += 1;
          console.log(`NYT ${puzzle.date} (${puzzle.id}) has no clue entries.`);
          continue;
        }

        await tagNytPuzzleEntries(local, puzzle);
        tagged += 1;
        console.log(
          `NYT ${puzzle.date} tagged ${puzzle.entries.length} entries with ${eraTag(puzzle.date)} and nyt.`,
        );
      } catch (error) {
        failed += 1;
        console.error(`Failed to tag NYT puzzle ${puzzle.date} (${puzzle.id}).`, error);
      }
    }

    console.log(
      `NYT entry-tag loader finished. tagged=${tagged} empty=${empty} failed=${failed}`,
    );
    if (failed > 0) {
      throw new Error(`${failed} NYT puzzle(s) failed to tag.`);
    }
  } finally {
    await local.end();
  }
}

export const nytLoaderDb = loadNytPuzzlesFromDb;
