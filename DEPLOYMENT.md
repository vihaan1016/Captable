# Deployment Guide

This repo is already structured for two hosted targets. Contracts are already
deployed and Sourcify-verified on Hedera testnet (chain id 296) — see the
address table in `README.md`. What remains for a public demo is the backend
(indexer + REST API + Postgres) and the frontend (SSR web app).

| Component | Path | Target | Build | Runtime env |
|---|---|---|---|---|
| Contracts | `contracts/` | Hedera testnet (already deployed) | Foundry | — |
| Indexer + API | `packages/indexer/` | Railway | `packages/indexer/Dockerfile` | `DATABASE_URL`, `HEDERA_RPC`, `INDEXER_START_BLOCK`, `FAUCET_ENABLED`, `ISSUER_PRIVATE_KEY`, `PORT` |
| Postgres | `docker-compose.yml` (dev) | Railway Postgres plugin | — | injected by Railway |
| Web app | `capstone-clarity/` | Cloudflare Workers | `bun run build` + `wrangler deploy` | `VITE_INDEXER_API` (required), `VITE_HEDERA_RPC`, `VITE_HEDERA_RPC_FALLBACK` |

## Prerequisites

- GitHub repo (done) — Railway and Cloudflare both deploy from it.
- A [Railway](https://railway.app) account + CLI (`npm i -g @railway/cli`).
- A [Cloudflare](https://cloudflare.com) account + `wrangler` (`npx wrangler login`).
- `bun` (or use `pnpm`/`npm` — the lockfile is `bun.lock`; `pnpm` is the monorepo root manager but `capstone-clarity/` is standalone).
- The issuer private key used by the deploy script (the `0x4791…C6F` account that
  holds SSI issuer role on the demo bond). Testnet-only, but treat it as a
  secret — it goes into Railway env, never into the repo (`.env` files are
  already gitignored).

## Step 1 — Backend on Railway

1. From the repo root:

   ```bash
   railway init
   ```

   Pick "Deploy from GitHub repo" and select this repository. Railway detects
   `packages/indexer/Dockerfile`.

   **Important:** the Dockerfile copies root-level files
   (`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `packages/`, `deployments/`), so
   the build context must be the **repo root**. In the Railway service
   settings set **Root Directory** to `/` (or leave it unset) and
   **Dockerfile Path** to `packages/indexer/Dockerfile` if Railway did not
   already do this.

   `deployments/hedera-testnet.json` is tracked in git and copied into the
   image — the `/api/deployment` route serves it, so this is load-bearing.

2. Add Postgres (Railway injects `DATABASE_URL` and `PORT` automatically):

   ```bash
   railway add --database postgres
   ```

   The schema applies itself at boot — `packages/indexer/src/index.ts` calls
   `migrate(pool)` which runs the idempotent `packages/indexer/sql/schema.sql`.
   No manual migration.

3. Set the service variables:

   ```bash
   railway variables set \
     HEDERA_RPC=https://testnet.hashio.io/api \
     HEDERA_RPC_FALLBACK=https://testnet.arkhia.io/api \
     INDEXER_START_BLOCK=<block> \
     FAUCET_ENABLED=true

   railway variables set ISSUER_PRIVATE_KEY=<issuer-private-key>   # secret
   ```

   `INDEXER_START_BLOCK` must be **before the auction's `AuctionCreated`
   event** or the indexer will never see the existing auction (it otherwise
   starts 32 blocks behind head). Find it: open the auction
   `0x7d69464Ec69F1413C421188485442f07F2c02C01` on
   [HashScan](https://hashscan.io/testnet) → its contract-creation transaction
   → block number, then subtract ~100.

   `FAUCET_ENABLED=true` + `ISSUER_PRIVATE_KEY` power the self-serve "Get KYC"
   button (`packages/indexer/src/faucet.ts`). Without them that endpoint
   returns 404/503 and visitors cannot onboard themselves.

4. Deploy and verify:

   ```bash
   railway up
   curl https://<app>.up.railway.app/api/health
   curl https://<app>.up.railway.app/api/auction/0x7d69464Ec69F1413C421188485442f07F2c02C01
   ```

   Done when `/api/health` returns `ok: true` with a small `lagBlocks` and the
   auction route returns 200 with phase data — from outside your network.

## Step 2 — Frontend on Cloudflare Workers

The web app is `capstone-clarity/` (the `apps/web/` directory is a leftover
build artifact, not the app). It builds with Vite/Nitro targeting Cloudflare
and ships as a single Worker with SSR.

1. Build with the production API URL. The build **fails loudly** without
   `VITE_INDEXER_API` (guard in `capstone-clarity/vite.config.ts`):

   ```bash
   cd capstone-clarity
   VITE_INDEXER_API=https://<app>.up.railway.app bun run build
   ```

   Optionally also set `VITE_HEDERA_RPC` and `VITE_HEDERA_RPC_FALLBACK`; they
   default to the Hashio/Arkhia testnet endpoints.

2. Deploy. Nitro emits `wrangler.json` into `.output/server/`; the
   `wrangler deploy` run from the app root picks it up:

   ```bash
   npx wrangler deploy
   ```

   First run asks for the worker name. After that, every
   `bun run build && npx wrangler deploy` publishes a new version.

3. Verify: `grep -r "localhost:8080" .output/` must be empty, and the deployed
   page must load live auction data with a clean network tab.

## Step 3 — CORS (skip only if you stay on `*.workers.dev`)

`packages/indexer/src/api.ts` allows CORS only for `*.workers.dev` and
`localhost` origins, because the rejection-feed and KYC-faucet endpoints write
to the database. If you attach a custom domain to the Worker, add it to the
allowlist:

```ts
app.use(cors({ origin: [/\.workers\.dev$/, /^http:\/\/localhost:\d+$/, /^https:\/\/<your-domain>$/] }));
```

then push — Railway redeploys the backend automatically.

## Post-deploy smoke test

1. Open the site, connect a wallet on Hedera testnet (chain id 296).
2. Click **Get KYC** — the faucet grants it on-chain (button only appears when
   the address lacks KYC).
3. Place a bid on the venue page. Expect either a legible refusal in the
   Refusal Ledger (identity / investor cap / NAV band) or an accepted bid that
   moves the clearing price.
4. `/console` → Deployment and health section should show all seven addresses
   with green indexer lag and the facet-resolution table resolving.

## Deploying contract changes (optional — contracts are already live)

Only needed if you redeploy issuance or the hook/router. The deploy script is
idempotent and re-runnable against the live state file
`deployments/hedera-testnet.json`:

```bash
forge script contracts/script/DeployCapTable.s.sol \
  --rpc-url $HEDERA_RPC --private-key $DEPLOYER_PRIVATE_KEY --broadcast -vvvv
```

Requirements: the deployer must be funded and KYC-granted, and the seller must
hold the bond total supply before auction creation. See
`EXECUTION-PLAN.md` §A9 for the full redeploy runbook (router + hook + auction,
`AUCTION_SALT` bump for a fresh address, verification commands).

After a redeploy: commit the updated `deployments/hedera-testnet.json` — the
backend serves it from the Docker image, so a Railway redeploy is needed for
the new addresses to reach the frontend.

## Updating the deployed app

Both targets deploy from GitHub:

- **Backend:** push to `main` → Railway rebuilds `packages/indexer/Dockerfile`
  automatically (or `railway up` from a branch for ad-hoc deploys).
- **Frontend:** push to `main`, then:

  ```bash
  cd capstone-clarity
  VITE_INDEXER_API=https://<app>.up.railway.app bun run build
  npx wrangler deploy
  ```

## Security notes

- `ISSUER_PRIVATE_KEY` lives only in Railway env — never in the repo, a
  Dockerfile, or a build log.
- The faucet key is scoped: it can grant KYC on the demo bond only
  (`packages/indexer/src/faucet.ts` — one function, one argument). The browser
  never holds an issuance-capable key; issuance is script-driven by design.
- The indexer binds `PORT` (Railway) and expects HTTPS upstream — Railway's
  proxy terminates TLS.
