import type { NextFunction, Request, Response } from 'express';
import { createApi, readDeployment } from './api.js';
import { createPool, migrate } from './db.js';
import { mountFaucet } from './faucet.js';
import { runIndexer } from './indexer.js';

const pool = createPool();

await migrate(pool);
console.log('[indexer] database ready');

const api = createApi(pool);

const deployment = await readDeployment();
const bond = typeof deployment.bond === 'string' && deployment.bond.length === 42 ? deployment.bond : null;
if (bond) mountFaucet(api, bond);
else console.warn('[faucet] no bond address in deployment file; KYC faucet not mounted');

// Only 2 of 10 routes carry their own try/catch, and Express 4 turns a rejected
// async handler into a process-level unhandled rejection (fatal under Node 25).
// This boundary keeps one bad request from taking the whole process down.
api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: String(err), retryable: true } });
});
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

const port = Number(process.env.PORT ?? 8080);
api.listen(port, () => console.log(`[indexer] REST API on :${port}`));

void runIndexer(pool);
