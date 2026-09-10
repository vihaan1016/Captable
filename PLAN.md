# Cap Table — plan to a live public deployment

**Written 8 September 2026.** Submissions close **Sunday 13 September, 12:00 EDT**. That is
**five working days and a half-morning**, not six — the brief was drafted for the 7th. Every date
below is adjusted accordingly.

**Decisions taken (by the project owner, 8 Sept):**

| Decision | Choice |
|---|---|
| Indexer + Postgres hosting | **Railway** (container + managed Postgres, one project) |
| Frontend hosting | **Cloudflare Workers** — the Nitro build already emits `wrangler.json` |
| Public auction length | **300,000 blocks ≈ 7.44 days** |
| Coupon | **Wire it to ATS for real** |
| `AUDIT-2026-09-07.md` | Deleted; superseded by `AUDIT.md` |

Every finding reference below (F-1 … F-12, and facts 1.1 … 1.15) points into `AUDIT.md`.

---

## 0. The shape of the problem

One sentence: **the contracts are in good shape and the fork test proves it; everything that a
stranger with a browser would actually touch is broken or unhosted.**

The critical path is a chain of four things, each of which is useless without the one before it:

```
new multi-day auction   (F-1)
   └─> indexer that can see it          (F-4)
          └─> indexer reachable from a browser   (F-3, F-5)
                 └─> frontend built with the right API URL   (F-5)
                        └─> a stranger can bid
```

Nothing on that chain is optional and nothing on it can be parallelised away. It is owned by one
person (**B**, below) with **A** supplying the auction. Everything else in this plan runs alongside it.

**Team of five.** Named by role so the schedule can be read without knowing who is who:

| | Role | Owns |
|---|---|---|
| **A** | Contracts / chain | Auction lifecycle, NAV keep-alive, coupon contract path, verification |
| **B** | Backend | Indexer fixes, backfill, Railway, Postgres |
| **C** | Frontend | Write-path gaps, auction wizard, coupon UI, Cloudflare |
| **D** | Infra / QA | Dockerfile, CI, self-serve KYC endpoint, end-to-end rehearsal |
| **E** | Docs / submission | README, FEEDBACK.md, Uniswap form, video |

A and B must not be the same person on days 1–2; that is where the critical path is widest.

---

## Tuesday 8 September — unblock the chain

### T1 · Fix the auction step schedule and redeploy an auction · **must-ship** · A
Blocks everything. `DeployCapTable.s.sol:308-310` hardcodes a 300-block (10.7-minute) auction, and
the config keys that look like they control it are dead (1.6, F-12).

Make the deltas real, and make the step schedule follow them. The CCA constructor enforces
`Σ(mps × blockDelta) == 10_000_000` exactly (1.6) — get this wrong and deployment reverts.

```solidity
// contracts/script/DeployCapTable.s.sol — replace the hardcoded 30/300/30
uint64 startDelta = uint64(vm.parseJsonUint(cfg, '.auction.startBlockDelta'));
uint64 endDelta   = uint64(vm.parseJsonUint(cfg, '.auction.endBlockDelta'));
uint64 claimDelta = uint64(vm.parseJsonUint(cfg, '.auction.claimBlockDelta'));
uint64 startBlock = uint64(block.number) + startDelta;
uint64 endBlock   = startBlock + endDelta;
uint64 claimBlock = endBlock + claimDelta;
```

Steps must be derived, not hardcoded. For the two length profiles we ship:

| Profile | endBlockDelta | Steps | Σ check | Duration @ 2.1433 s |
|---|---|---|---|---|
| `long` (public) | 300,000 | `200_000 @ 25 mps` + `100_000 @ 50 mps` | 5,000,000 + 5,000,000 = 1e7 ✓ | **7.44 days** |
| `short` (video) | 300 | `200 @ 25_000` + `100 @ 50_000` | 5,000,000 + 5,000,000 = 1e7 ✓ | **10.7 min** |

The two profiles are the same shape scaled by 1000, which is why both satisfy the invariant. Keep
`short` — a ten-minute clearing is an asset on camera, and it is how the video gets a real graduation.
Select with `AUCTION_PROFILE=short|long`; default `long`.

```bash
forge test                                     # step arithmetic must have a unit test — see T2
AUCTION_PROFILE=long forge script contracts/script/DeployCapTable.s.sol \
  --rpc-url https://testnet.hashio.io/api --broadcast -vvv
```

**Done when:** `cast call <newAuction> "endBlock()(uint256)"` minus `cast block-number` exceeds
250,000, and `isGraduated()` returns `false` with `startBlock` already passed.
**If skipped:** there is no demo. A visitor sees a dead venue (F-1).

### T2 · Unit-test the step invariant · **must-ship** · A
The invariant is the single most likely cause of a failed redeploy at 2am on Saturday.

```solidity
// contracts/test/AuctionSteps.t.sol
function test_StepsSumToOneE7() public pure {
    assertEq(200_000 * 25 + 100_000 * 50, 10_000_000);   // long
    assertEq(200 * 25_000 + 100 * 50_000, 10_000_000);   // short
}
```
**Done when:** `forge test --match-path contracts/test/AuctionSteps.t.sol` passes.
**If skipped:** a redeploy under time pressure reverts with an opaque CCA error.

### T3 · Wake the NAV oracle · **must-ship** · A · *30 minutes, highest value-per-minute in the plan*
The Chainlink integration is currently inert: the feed is 62.7 hours stale against a 1-hour
threshold, so the hook skips the band and accepts a bid at 4.8× NAV (F-2, proven end-to-end).

```bash
cast send <oracle> "setNav(int256)" 10331 --rpc-url $HEDERA_RPC --private-key $DEPLOYER_PRIVATE_KEY
```

One `setNav` is not enough — `maxStaleness` is 3600s, so it goes stale again in an hour. Choose one:

- **Preferred:** raise `maxStaleness` to `604800` (7 days) on the hook so the band holds for the whole
  judging window with no operator present. One transaction, no infrastructure.
- **Alternative:** a Railway cron calling `setNav` every 30 minutes. More moving parts, another
  place to fail silently at the weekend.

Take the first. The second is a fallback only if `maxStaleness` turns out not to be settable.

**Done when:** this returns `false` — the assertion that F-2 is actually closed:
```bash
cast call <hook> "previewValidate(uint256,uint128,address)(bool,bytes4)" \
  $(python3 -c 'print(50000<<96)') 100 <kycedAddr>    # must be false, was true
```
**If skipped:** the only Chainlink-facing feature in the project demonstrably does nothing, and a
judge can prove it with one `cast call`.

### T4 · Stop the indexer dying, then give it a memory · **must-ship** · B
Two separate defects, both on the critical path. Do them in this order.

**(a) F-3 — the crash.** `attempted_by TEXT NOT NULL` (schema:39) vs `attempted_by ?? null`
(api.ts:260) vs a frontend that never sends the field (chain-context.tsx:515). Posting a rejection
takes the whole process down.

Fix all three layers — any one alone leaves a hole:
1. `chain-context.tsx` `recordRefusal`: send `attempted_by: address`.
2. `api.ts`: reject with 400 when `attempted_by` is missing, rather than inserting `null`.
3. `index.ts`: an Express error handler **and** a process guard, because only 2 of 10 routes have
   any error handling at all:

```ts
app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: String(err), retryable: true } });
});
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
```

**Done when:** POSTing the exact frontend payload returns 400, POSTing a valid one returns 200, and
`curl /api/health` still answers afterwards. That last clause is the real test.

**(b) F-4 — the blindness.** `indexer.ts:33` `Math.max(START_BLOCK, head - 32)` makes
`INDEXER_START_BLOCK` a floor, so it can only move the start *forward* — verified: setting it to
40180500 still resumed at 40234923. And `indexRange` issues one unchunked `getLogs`, which a public
RPC will refuse over a large span.

```ts
last = await readCheckpoint(pool) ?? (START_BLOCK > 0 ? START_BLOCK : head - 32);
// and chunk:
for (let from = start; from <= head; from += 1000) {
  await indexRange(pool, client, BigInt(from), BigInt(Math.min(from + 999, head)));
  await writeCheckpoint(pool, Math.min(from + 999, head));
}
```
Checkpoint *inside* the loop, so a mid-backfill crash resumes instead of restarting.

**Done when:** started with `INDEXER_START_BLOCK=<newAuctionStart-100>` against an empty database,
`/api/auction/<addr>` returns 200 with real data — the route that returns 404 today (1.10).
**If skipped:** four of nine routes 404 forever and the venue renders zeros (F-4, 1.12).

### T5 · Decide and write down the KYC story · **must-ship (decision)** · D
Discussed in full in §"The KYC problem" below. Today only the decision and the rate-limit design are
needed; the code lands Wednesday.

---

## Wednesday 9 September — make it reachable

### W1 · Dockerfile + Railway · **must-ship** · B/D
No Dockerfile exists anywhere in the project (F-11).

```dockerfile
# packages/indexer/Dockerfile
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/indexer/package.json packages/indexer/
RUN pnpm install --frozen-lockfile
COPY packages/ ./packages/
COPY deployments/ ./deployments/
RUN pnpm --filter @cap-table/shared build && pnpm --filter @cap-table/indexer build
CMD ["pnpm","--filter","@cap-table/indexer","start"]
```

`COPY deployments/` is load-bearing and is the subtlest bug in the deployment path.
`/api/deployment` reads `../../../deployments/hedera-testnet.json` (api.ts:299), and that directory
is gitignored (`.gitignore:16`). A container built from a clean clone will not contain it, and the
route returns `DEPLOYMENT_UNREADABLE` 500 — the app never learns any contract addresses and nothing
renders. **This is why V2 (committing the file) must land before the first Railway build**, not after.

```bash
railway init && railway add --database postgres
railway variables set HEDERA_RPC=https://testnet.hashio.io/api INDEXER_START_BLOCK=<auctionStart-100>
railway up          # DATABASE_URL and PORT are injected by Railway
```
Railway injects `PORT`; `index.ts:11` already honours it. Schema is idempotent (`CREATE TABLE IF NOT
EXISTS`) and `migrate()` runs at boot, so no manual migration step.

**Done when:** `curl https://<app>.up.railway.app/api/auction/<addr>` returns 200 with real data
from outside your network.
**If skipped:** the frontend has nothing to talk to.

### W2 · CORS · **must-ship** · B · *ten minutes, total blocker*
The indexer sends no CORS headers at all — verified, zero `access-control-*` on any response (F-5).
The browser will block every cross-origin call regardless of everything else on this page.

New dependency: **`cors`** (~8 kB, zero transitive deps). Justified because hand-rolling preflight
handling is where people get `OPTIONS` subtly wrong under time pressure.

```ts
import cors from 'cors';
app.use(cors({ origin: [/\.workers\.dev$/, /^http:\/\/localhost:\d+$/] }));
```
Allowlist rather than `*`: the POST route writes to the database, so an open origin invites drive-by
writes into the demo's rejection feed.

**Done when:** `curl -i -H "Origin: https://x.workers.dev" .../api/health | grep access-control`
prints a header — it prints nothing today.

### W3 · Frontend env + Cloudflare · **must-ship** · C
`VITE_INDEXER_API` is unset and falls back to `http://localhost:8080`, which is baked into
`.output/public/assets/utils-*.js` — verified in the built bundle (F-5). Every visitor's browser
fetches *their own machine*. The build does not warn.

```bash
cd capstone-clarity
VITE_INDEXER_API=https://<app>.up.railway.app bun run build
npx wrangler deploy
```

Add a build-time guard so this can never ship silently again — the failure mode is invisible:
```ts
// vite.config.ts
if (mode === 'production' && !process.env.VITE_INDEXER_API) {
  throw new Error('VITE_INDEXER_API must be set for a production build');
}
```
Also delete `VITE_FEATURE_COUPON` from `.env.example` or implement it; it is referenced nowhere
in `src/` despite a code comment claiming the coupon is feature-flagged (F-6).

**Done when:** `grep -r "localhost:8080" .output/` returns nothing, and the deployed page loads
auction data with a clean network tab.

### W4 · Self-serve KYC endpoint · **must-ship** · D
See §"The KYC problem" for the security analysis. Implementation:

```ts
// POST /api/faucet/kyc  { address }
// - allowlist origin, 1 grant per address ever, 20/hour global, 5/hour per IP
// - refuse if already KYC'd (idempotent, cheap)
// - ISSUER_PRIVATE_KEY from Railway secrets, never in the repo
```
**Done when:** a fresh address gets KYC from the browser and a second attempt is refused.
**If skipped:** a stranger cannot bid, so the product cannot be evaluated — only watched.

---

## Thursday 10 September — close the product gaps

### X1 · Auction creation from the browser · **must-ship** · C
There is **no auction-creation path in the frontend at all** — no `createAuction`, no `ccaFactory`
ABI, nothing (1.11). `create` appearing in grep is prose in `routes/README.md:4`. If the auction
expires mid-judging, nobody can replace it without a laptop and a private key.

With a 7.44-day auction this is insurance rather than daily necessity — but it is insurance against
total demo failure, and it closes 3 of the 13 unwired paths. Ship the wizard:
`getAddress → grantKyc → transfer → create`.

**Done when:** a new auction is created from the console and the venue switches to it without a redeploy.

### X2 · Wire the coupon to ATS · **must-ship, with a hard checkpoint** · A/C
The owner chose to wire it rather than cut it. I flagged this as the riskiest item; the audit then
established it is **much cheaper than it looked** (1.15) — the facet is already live on the deployed
bond, so this is wiring, not new contract work:

```
setter   0x6F5D42bC570CB5adcfe4E2df3560660a156b397e
selector 0xb16fd0cc  setCoupon((uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint8))
reads    0x1481BC45C7DF91B00865e34B73D8550FF2928A73  getCouponCount / getCoupon / getCouponFor
role     ROLE_CORPORATE_ACTION = 0x8a139eeb747b9809192ae3de1b88acfd2568c15241a5c4f85db0443a536d77d6
         keccak256('security.token.standard.role.corporateAction')   [v4 hash, confirmed in facet bytecode]
deployer holds DEFAULT_ADMIN_ROLE = true, ROLE_CORPORATE_ACTION = false  -> must self-grant first
```

Three steps:
1. `contracts/src/ats/ICoupon.sol` — the 8-field struct and `setCoupon`. Mirror 1.15 exactly; use the
   **v4** role hash, not the v8 one from ATS `main` (`AtsRoles.sol` warns about this explicitly).
2. `cast send <bond> "grantRole(bytes32,address)" <ROLE_CORPORATE_ACTION> <deployer>`
3. Replace the two fake handlers in `console.tsx:736-758` with a real `actions.setCoupon(...)`, and
   drive `couponScheduled` from `getCouponCount()` instead of the hardcoded `false`
   (`chain-context.tsx:386`) — otherwise Distribute stays permanently unreachable even when wired.

**Hard checkpoint — Thursday 18:00.** If `getCouponCount()` has not gone from 0 to 1 on testnet by
then, stop and fall back to the honest-disabled label (~20 minutes). Do not carry this into Friday;
Friday is for rehearsal. `cancelCoupon` is not registered on this diamond — do not build UI for it.

**Done when:** `cast call <bond> "getCouponCount()(uint256)"` returns `1` and the console reflects it.
**If skipped/cut:** remove the buttons. Shipping a green "Coupon scheduled" toast for a transaction
that never happened is worse than having no coupon feature (F-6).

### X3 · Contract verification + committed deployments · **must-ship** · A
All seven contracts are unverified — `match: null` on a chain Sourcify supports (1.7, F-9). The
Hedera track asks for verification.

```bash
for c in bond auction hook router compliance ccaFactory oracle; do
  forge verify-contract <addr> <Contract> --chain 296 \
    --verifier sourcify --verifier-url https://server-verify.hashscan.io
done
```
The auction and factory are CCA contracts compiled `via_ir` (see `compilation_restrictions` in
`foundry.toml`) — verify them with the matching profile or the bytecode will not match. The bond is
an ATS diamond proxy (390 bytes); verify the proxy, and note in the README that its facets are
ATS-deployed and already verified upstream.

Then commit the deployments file:
```bash
# .gitignore: replace  deployments/  with:
deployments/*
!deployments/hedera-testnet.json
git add -f deployments/hedera-testnet.json
```
Confirmed safe: the file holds only addresses and boolean flags — no keys (1.14). Re-check with
`git diff --cached` before committing anyway.

**Done when:** `curl https://sourcify.dev/server/v2/contract/296/<addr>` returns a non-null `match`
for each, and the JSON is tracked.
**If skipped:** a Hedera qualification requirement is unmet and judges cannot map addresses to source.

### X4 · Remaining write-path gaps · **cuttable** · C
Of the 13 unwired paths (1.11), X1 closes 3 and X2 closes 1. The rest —
`deployBond`, `grantRole`, `addIssuer`, `mint`, `setCompliance`, `setExempt`, `checkpoint`,
`sweepUnsoldTokens`, `sweepCurrency` — are issuance and post-auction operations that the demo
narrative does not traverse. Ship if Thursday goes well; cut without regret otherwise. Say plainly
in the README that issuance is script-driven rather than implying browser support.

---

## Friday 11 September — documentation and rehearsal

### F1 · README rewrite · **must-ship** · E
Two of the seven line citations are wrong, and they are the two carrying the **Uniswap qualification
claim** — a track requirement is "a README that points at the exact contracts and lines" (F-7).

| Currently claims | Actually contains | Correct target |
|---|---|---|
| `SettlementRouter.sol:264` — ATS hold settlement | `}` | `:192` `executeHoldByPartition`, `:284` `createHoldByPartition` |
| `SettlementRouter.sol:77` — router is sole `submitBid` caller | *blank line* | `CapTableValidationHook.sol:156` `DirectBidsNotPermitted` |

Note the second is in a **different contract** — not an off-by-a-few-lines slip. Verified still
accurate and needing no change: `DeployCapTable.s.sol:211`, `:225`,
`CapTableValidationHook.sol:126`, `:172`, `:224`.

Also (F-8): drop the `apps/web` row (line 28) — that tree is deleted; replace
`pnpm --filter cap-table-web dev` (line 47) with the real `capstone-clarity` commands; correct
"20 tests" to 24; and fix the root `.env.example`, which advertises `NEXT_PUBLIC_*` variables that
the Vite frontend never reads.

Add up front: the live URL, the deployed addresses with HashScan links, and a one-line "what to click".

**Done when:** every `path:line` in the README is confirmed by `sed -n '<n>p' <file>` — the check
that caught this, and cheap to re-run.

### F2 · FEEDBACK.md final pass + Uniswap form · **must-ship** · E
`FEEDBACK.md` is nine substantive upstream findings and is the most differentiated artifact in the
repo — Permit2 fallback, counterfactual KYC, claim-time compliance, partition defaults. It needs
only a light pass: confirm each still matches the shipped code, add file:line anchors, and add the
NAV stale-skip trade-off surfaced by F-2 (an oracle outage must not brick bidding, but a silent skip
means the guard can be absent exactly when it matters — a real design tension worth reporting upstream).

Then complete the **Uniswap Developer Feedback Form** linking to the public `FEEDBACK.md`. This is a
stated qualification requirement, it is not code, and it is the single easiest requirement to forget.
Do it Friday, not Sunday.

### F3 · Full rehearsal on the public URL · **must-ship** · D + all
From a machine that has never seen this project, on a clean browser profile:
connect wallet → self-serve KYC → rejected bid (identity) → rejected bid (register cap) → accepted
bid → settle → hold executed → coupon (if X2 shipped). Check the network tab for CORS errors and
`localhost:8080`. Have someone outside the team do it — the whole premise is "a stranger can use it".

**Done when:** a person who did not build it completes a bid unaided.

### F4 · Workspace coherence + CI · **cuttable** · D
`capstone-clarity` sits outside the pnpm workspace with its own `bun.lock`; neither it nor the
indexer has a `test` script, so `pnpm test` runs 7 assertions in `packages/shared` and nothing else
(1.8, F-11).

**Recommendation: leave it outside the workspace, deliberately, and document why.** Merging a
bun-locked Vite app into a pnpm workspace three days before a deadline risks the one artifact
judges actually open, for a tidiness benefit. Make the root scripts honest instead:

```json
"build": "pnpm -r build && cd capstone-clarity && bun run build",
"test":  "pnpm -r test && forge test"
```
That makes `pnpm build` and `pnpm test` cover the whole repo, which was the actual requirement.
A GitHub Actions workflow running `forge test` + `pnpm test` is nice-to-have; cut it first.

---

## Saturday 12 September — video

### S1 · Demo video ≤ 5 minutes · **must-ship** · E + A
Hedera requires ≤ 5 min. Record against a **`short` profile auction** (T1) so a real graduation
happens on camera — a 7-day auction cannot clear inside five minutes, and faking it would undercut
the one thing this project can genuinely show.

Suggested beats, mapping to the five the fork test already proves (1.2):

| Time | Beat |
|---|---|
| 0:00–0:30 | The problem: ATS issues securities; there is no compliant secondary market |
| 0:30–1:15 | Architecture: CCA unmodified + validation hook + settlement router |
| 1:15–2:15 | **Rejected on identity**, then **rejected on register cap** — the hook refusing, with the decoded reason |
| 2:15–3:00 | Accepted bid, clearing price moves |
| 3:00–4:00 | Settlement via `holdByPartition` + secret reveal — *not* a raw transfer |
| 4:00–4:45 | NAV band rejecting an out-of-band bid (only if T3 landed) |
| 4:45–5:00 | Live URL, invitation to try it |

Lead with the refusals. An auction that accepts bids is unremarkable; an auction that refuses one
*for a legible regulatory reason* is the entire thesis.

### S2 · Buffer · unallocated
Deliberately empty. Something on Wednesday will slip.

---

## Sunday 13 September — submit by 12:00 EDT

Submit by **09:00 EDT**, three hours early. Final checks:

```bash
curl https://<frontend>.workers.dev                      # 200
curl https://<app>.up.railway.app/api/health             # lagBlocks small
cast call <auction> "endBlock()(uint256)"                # still ahead of head
cast call <hook> "previewValidate(uint256,uint128,address)(bool,bytes4)" \
     $(python3 -c 'print(50000<<96)') 100 <kyced>        # false -> NAV band alive
git ls-files | xargs grep -lE '(0x)?[0-9a-f]{64}' | grep -v lock   # no key material
```

Checklist: public repo · demo video ≤ 5 min · contracts verified · `deployments/hedera-testnet.json`
tracked · `FEEDBACK.md` · **Uniswap form submitted** · README citations verified · live URL in the
submission.

---

## The KYC problem for strangers

The venue refuses bids from addresses without KYC. **That is the product**, not a bug — it is the
thing the Hedera track is asking to see. But it means a visitor cannot try the demo unless somebody
grants them KYC, and nobody will be awake to do that at 3am during judging.

**The design.** A `POST /api/faucet/kyc` endpoint holding the issuer key, exposed in the venue as a
"Get demo KYC" button that appears only when the connected address lacks it.

**This puts an issuer private key behind a public HTTP endpoint. Be honest about what that means.**
On this deployment the exposure is bounded and acceptable; the reasoning is what matters:

- The key is **testnet-only**, funded with testnet HBAR of no value. Worst case is a drained faucet
  account and a demo that stops granting KYC — recoverable by funding a new one.
- The key is an **ATS issuer on one demo bond**, not an admin of anything else. It can grant KYC.
  It cannot mint to arbitrary addresses, move the seller's tokens, or alter compliance rules — those
  need `ROLE_ISSUER`/`DEFAULT_ADMIN_ROLE` held by the deployer, which stays off the internet.
- **The endpoint's surface is one function with one argument.** It takes an address and grants KYC.
  It never accepts calldata, a target contract, or an amount. There is no path from this endpoint to
  an arbitrary transaction.

Controls, in decreasing importance:
1. **One grant per address, ever.** Idempotent and checked on-chain before spending gas.
2. **Global cap** (~20/hour). Bounds worst-case gas burn no matter how the per-IP limit is evaded.
   This is the control that actually protects the account; per-IP limits are trivially bypassed.
3. **Per-IP limit** (~5/hour). Stops casual abuse, nothing more.
4. **Origin allowlist.** Same list as CORS (W2).
5. **Key in Railway secrets, never in the repo.** `.env` is correctly gitignored and has never been
   committed (1.14) — keep it that way. Deploy with `railway variables set`, never `git add`.
6. **A revocation switch.** `FAUCET_ENABLED=false` and redeploy, if it is being abused during judging.

What we explicitly do **not** do: no captcha (a judge should not have to solve one), no signature
challenge (adds a wallet round-trip to the first interaction, which is exactly where people leave).

**If this is cut**, the fallback is a KYC'd demo address with its private key printed on the venue
page — a shared sandbox account. It works, it is honest, and it is strictly worse: concurrent judges
would fight over one nonce.

---

## Cut order — written down now, while nobody is tired

Cut from the bottom. Do not renegotiate this at 2am on Saturday; that is the whole point of writing
it today.

| # | Item | Cost of cutting |
|---|---|---|
| 1 | CI workflow (F4) | None. Nobody judges a green tick. |
| 2 | Remaining 9 write paths (X4) | Low. Document issuance as script-driven. |
| 3 | Coupon (X2) | Low **if cut cleanly** — remove the buttons. Fatal if left faking success. |
| 4 | Browser auction creation (X1) | Medium. Loses recovery if the auction expires; the 7.44-day window is the mitigation. |
| 5 | Workspace tidy (F4) | Low, and the recommendation is already "leave it and document". |
| 6 | Self-serve KYC (W4) | High. Falls back to a shared KYC'd account. |
| 7 | Contract verification (X3) | **Qualification risk (Hedera).** |
| 8 | README citation fixes (F1) | **Qualification risk (Uniswap).** |
| 9 | NAV keep-alive (T3) | High. Chainlink story becomes demonstrably inert. 30 minutes — never worth cutting. |
| 10 | Hosting (W1–W3) | **Total.** No public demo. |
| 11 | Indexer fixes (T4) | **Total.** Backend dies on the flagship beat. |
| 12 | New auction (T1) | **Total.** Nothing to demo. |

Items 10–12 are not cuttable in any scenario. If the schedule collapses, the minimum viable
submission is **T1 + T3 + T4 + W1 + W2 + W3 + F1 + F2** — a working auction, a live URL, honest
docs, and the Uniswap form. Everything else is upside.

---

## What runs in parallel

```
Tue 8   A: T1 auction + T2 steps + T3 NAV        B: T4 indexer (a then b)
        D: T5 KYC decision                       C: read the venue code, prep W3
        E: start README rewrite (F1 needs no running system)

Wed 9   B/D: W1 Railway  ->  W2 CORS             C: W3 Cloudflare (needs W1's URL)
        D: W4 KYC endpoint                       A: X3 verification (independent)
        E: F2 FEEDBACK.md pass

Thu 10  C: X1 auction wizard                     A/C: X2 coupon (checkpoint 18:00)
        A: finish X3                             E: finish F1
        D: X4 if time

Fri 11  E: F1/F2 land          D: F3 rehearsal (needs everything)     C: fix what F3 finds
Sat 12  E+A: S1 video          rest: buffer
Sun 13  submit 09:00 EDT
```

Real dependencies, and nothing else:
- **W3 needs W1's URL.** C cannot finish Wednesday until Railway is up. Give C X1 to start on.
- **F3 needs everything.** It is the only true all-hands item.
- **X3 (verification) and E's doc work depend on nothing.** Run them whenever someone is blocked —
  they are the schedule's shock absorbers.
- **T1 blocks T4(b)** only for the final `INDEXER_START_BLOCK`. B can write and test the backfill
  against the old auction's block range before the new auction exists.
