# Prompt for Claude Code

Paste everything below the line into Claude Code, running from the repo root.

---

You are auditing and then shipping **Cap Table**, an ETHGlobal ETHOnline 2026 submission. Today is 7 September 2026. Submissions close **Sunday 13 September, 12:00 EDT**. Read this whole brief before running anything.

## What the project is

A compliance-gated clearing auction for tokenised securities on Hedera. Uniswap's Continuous Clearing Auction runs on Hedera EVM as the price-discovery layer for a bond issued through Hedera's Asset Tokenization Studio. A custom `IValidationHook` rejects a bid at `submitBid` if its worst-case fill would push the shareholder register past the token's max-investor or max-ownership limits. Settlement goes through ATS `holdByPartition` plus a secret reveal rather than a raw transfer, via a `SettlementRouter` that is the only permitted bid submitter.

Target tracks and their hard qualification requirements:

- **Hedera — Tokenization of Anything.** Must use ATS, must deploy and demonstrate on Hedera testnet, public repo, **contracts verified on HashScan where applicable**, demo video ≤ 5 min.
- **Uniswap — Best Uniswap Stack Contribution.** Public repo, a `FEEDBACK.md`, a completed Uniswap Developer Feedback Form linking to it, and a README that points at the exact contracts and lines so they can verify the integration.
- **Chainlink** (criteria unpublished; a `MockV3Aggregator` NAV feed drives the auction floor price and the hook's deviation band).

## Repo layout

- `contracts/` — Foundry. 9 source contracts, 7 test files, `script/DeployCapTable.s.sol`.
- `packages/indexer/` — TypeScript + Express + Postgres, 10 REST routes, `sql/schema.sql`. Listens on `PORT` (default 8080), reads `DATABASE_URL`.
- `packages/shared/` — shared TS utilities.
- `capstone-clarity/` — **the real frontend.** Vite + TanStack Start + wagmi/viem, three routes (`index`, `venue`, `console`), Nitro build output, wrangler config. It sits at the repo root and is **outside** the pnpm workspace, with its own `bun.lock`.
- `AUDIT-2026-09-07.md` — a prior audit. Treat every finding in it as a **hypothesis to confirm or refute by execution**, not as fact. It was written without the ability to run Foundry or reach the RPC.

Network: Hedera testnet, chain id 296, RPC `https://testnet.hashio.io/api`. Known deployed addresses: bond `0x40dbbb7587180f94388abfda89303e57af19b5aa`, auction `0x8c72dab63faf9b9f68fd6f28093c3877735a025b`, hook `0xb9f86eac6d2a7fecfc641c1d1dca9339a557cfa4`, settlement router `0xda21f64ef264574d06f7e5107109e86af6ba204e`, compliance module `0x28815d9ffdcb4e8c6c387c4eaadb02ac418bbb46`, CCA factory `0xcf4d1a8cfeb27a25e6fb8c9cc0109ff34dddeb27`.

## The goal

Two things, in this order.

1. **A verified audit.** Not a reading of the code — an execution of it.
2. **A plan that ends in a publicly deployed product** a stranger can open in a browser, connect a wallet to, and actually use on Hedera testnet, live through judging week.

## Phase 1 — Audit by execution

**The rule: every claim you make must be backed by a command you ran and its output.** If you did not run it, say "unverified" and say why. Do not describe what code appears to do when you can execute it and find out.

Run at minimum:

- `forge build` and `forge test -vv`. Record the exact pass/fail count per file.
- `forge test --match-path contracts/test/DemoBeats.t.sol --fork-url https://testnet.hashio.io/api -vv` — this is the end-to-end fork test.
- `cast call` against the live auction for `startBlock()`, `endBlock()`, `claimBlock()`, `isGraduated()` and compare to `cast block-number`. **Determine whether the deployed auction has already ended.** Report the numbers.
- `cast code` on each address above to confirm deployment.
- Check HashScan verification status for every deployed contract.
- Build the indexer and the frontend. Start the indexer against a local Postgres and hit every route in `packages/indexer/src/api.ts`. Report which return real data and which fail.
- Grep `capstone-clarity/src` for every write path and report which of these are wired to a real transaction and which are absent or stubbed: `deployBond`, `grantRole`, `addIssuer`, `mint`, `grantKyc`, `revokeKyc`, `addToControlList`, `removeFromControlList`, `setCompliance`, `setRules`, `setExempt`, `getAddress`, `transfer`, `create`, `placeBid`, `exitBid`, `settle`, `executeHold`, `fundReserve`, `checkpoint`, `sweepUnsoldTokens`, `sweepCurrency`, `setCoupon`, `setNav`.
- Resolve whether the coupon UI in `console.tsx` and `chain-context.tsx` calls a real contract path or is a stub. `coupon` does not appear anywhere in `contracts/`.
- Verify `previewValidate` and `validate` cannot disagree, and that the frontend pre-flight reads the chain rather than the indexer.
- Check the frontend's env wiring: `VITE_INDEXER_API` and `VITE_HEDERA_RPC` are inlined by Vite **at build time**. Confirm what happens in a production build when they are unset.
- Check the indexer for CORS. The browser calls it cross-origin in production.

Write the result to `AUDIT.md`, replacing `AUDIT-2026-09-07.md`. Structure it as: verified facts with the command and output that proved them; then findings ordered by severity, each labelled **blocks-qualification**, **blocks-live-demo**, or **costs-score**; then an explicit list of anything you could not verify and why.

## Phase 2 — The plan

Write `PLAN.md`. It must get to a live public deployment, not just a green test suite.

Cover at minimum:

- **Auction lifecycle.** The demo auction must survive judging week. Work out the right block parameters for a multi-day auction at Hedera's 2-second cadence, and keep a short parameterisation available for the video where a fast clearing is an asset. Decide whether the console also needs a create-a-new-auction path so an expired auction can be replaced from the browser.
- **The KYC problem for strangers.** The venue refuses bids from addresses without KYC — that is the product — which means a visitor cannot try the demo unless someone grants them KYC. Design the self-serve path: an endpoint holding the issuer key, rate-limited, exposed as a button. Include the security considerations of putting an issuer key behind a public endpoint.
- **Hosting.** Indexer needs a Dockerfile, a host, and managed Postgres. Frontend needs a host and build-time env. Name specific services, give the commands, and state what breaks if each step is skipped.
- **Contract verification on HashScan** for all six contracts, plus a committed `deployments/hedera-testnet.json` — `.gitignore` currently excludes `deployments/`.
- **Closing the frontend write-path gaps** found in Phase 1.
- **Workspace coherence.** Decide whether `capstone-clarity` moves into the pnpm workspace or stays out deliberately, and make `pnpm build` and `pnpm test` cover the whole repo either way.
- **README** — it currently describes `apps/web`, which no longer exists. It must map features to each sponsor's stated criteria with file paths and line numbers.
- **Submission artifacts** — `FEEDBACK.md` final pass, Uniswap feedback form, demo video plan.

Format the plan as dated blocks from 7 to 13 September. For each item give the concrete commands or file changes, a way to tell it is done, and mark it **must-ship** or **cuttable**. Put the cut order in writing now, while nobody is tired. Assume five people and say what can run in parallel.

## Constraints

- **Do not rewrite, backdate, squash or fabricate git history.** There is a `rebuild-history.sh` in the tree that generates 70 backdated commits. Do not run it, do not reference it, do not produce anything like it. Sponsors check commit history to confirm work happened inside the event window; falsifying it risks a prize being revoked after the fact. Commit granularly and honestly from here instead.
- Do not commit secrets. `.env` is correctly gitignored — keep it that way, and check nothing you add leaks a key. Flag it loudly if you find a private key anywhere in tracked files.
- Do not claim a test passes without pasting the output.
- Do not delete files without listing them and asking first.
- Do not add a dependency without saying why in the plan.
- Where a decision is genuinely mine to make rather than yours — hosting provider, whether to cut coupon, how long the public auction runs — ask instead of assuming.

Start with Phase 1. Do not write the plan until the audit is done and the numbers are real.
