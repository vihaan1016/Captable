import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

export function createPool(): pg.Pool {
  return new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://cap_table:cap_table@127.0.0.1:5432/cap_table',
  });
}

export async function migrate(pool: pg.Pool): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const schema = await readFile(resolve(here, '../sql/schema.sql'), 'utf8');
  await pool.query(schema);
}
