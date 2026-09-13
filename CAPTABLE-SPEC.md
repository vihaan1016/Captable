# Cap Table — Technical Specification

**Project:** Cap Table (submission codename; internal working name "Bid Rejected")
**Event:** ETHGlobal ETHOnline 2026 · build window 4 Sep – 13 Sep 2026, submissions close Sun 13 Sep 12:00 EDT
**Target tracks:** Hedera — Tokenization of Anything (anchor) · Uniswap Foundation — Best Uniswap Stack Contribution (native extension) · Chainlink (flex)
**Repo:** standalone public repository, empty at 00:00 on 4 Sep, real incremental commit history
**Document status:** implementation-ready. A coding agent should be able to build from this without follow-up questions.

---

## 1. Overview

Hedera's Asset Tokenization Studio (ATS) can issue and administer compliant securities under ERC-3643 and ERC-1400 — KYC grants, freezes, transfer restrictions, corporate actions, coupons, holds and clearing — and provides no venue on which those securities can trade. Hedera says so in their own prize text: *"A secondary market for ATS-issued assets, which the Studio does not have today."*

Cap Table is that venue. It runs Uniswap's Continuous Clearing Auction (CCA) on Hedera EVM as the price-discovery engine and inserts a validation hook at `submitBid()` that does something no gated auction does today: instead of asking *"is this bidder permitted to hold this token?"* it asks **"if this bid fills to its worst case, does the resulting shareholder register still satisfy the issuer's compliance rules?"** — reading maximum-investor and maximum-ownership limits from the token's own compliance module and refusing bids that would breach them.

Because compliance for a security is a property of the whole register rather than a per-address flag, a permissionless auction with pro-rata fills can turn one large bid into two hundred small holders and silently produce a cap table the issuer cannot legally own. Cap Table refuses to build that register. Cleared allocations settle through ATS's own `hold` and `clearing` facets via a settlement router, and a compliance-aware claim path refunds any bidder whose eligibility lapsed between bidding and claiming rather than stranding their funds forever.

---

## 2. Scope

### 2.1 Build configuration (assumptions, stated so they can be overridden)

- **Team:** 5 people. Cap Table work runs as **parallel workstreams**, not sequenced. Day 1 opens with a kill-check block (§6.6) executed in a throwaway directory before the repo receives its first commit. Day 9 is the delivery day: README, video, and feedback submission.
- **Contract toolchain:** **Foundry everywhere.** ATS is driven through raw ABIs with `forge script` and `cast`, not `@hashgraph/asset-tokenization-sdk`. This forfeits the SDK's deployment helpers, so the ISIN generator and the SSI/KYC ordering are specified by hand in §3.1 and §5.4.
- **Off-chain language:** **TypeScript throughout.** Node 20+, `viem` for chain access, `pnpm` workspaces.
- **Frontend:** **Full interactive web app.** Next.js 14 App Router, `wagmi` + `viem`, Tailwind. Wallet-connected, with real write paths for bid submission and claim.
- **Networks:** **Hedera testnet only** (chain id 296, JSON-RPC relay `https://testnet.hashio.io/api`). The Hedera prize requires deployment and demonstration on testnet with contracts verified on HashScan; a local fork does not satisfy it.
- **Mocking allowances adopted:** a mock Chainlink aggregator is permitted (§5.6); demo bidders, the issuer and the seller are deterministic scripted accounts. Every on-chain effect is real; only who initiates it is staged.

### 2.2 In scope

1. Deterministic ISO-6166-valid ISIN generation and ATS bond issuance on Hedera testnet.
2. The SSI-manager → issuer-registration → KYC-grant sequence, scripted and idempotent.
3. Deployment of the **unmodified** CCA factory and an auction instance on Hedera testnet.
4. Counterfactual-address pre-funding of the auction (§3.2) — the auction contract is KYC-granted before it exists.
5. `CapTableValidationHook` — the register-projection hook (§3.3). **This is the core deliverable.**
6. `SettlementRouter` — the only permitted bid submitter; holds beneficial-ownership records; converts CCA's raw token distribution into ATS hold-based settlement (§3.4).
7. Compliance-aware claim: refund-at-clearing when a filled bidder has become ineligible (§3.5).
8. Coupon distribution to holders of record after settlement (§3.6).
9. `MockV3Aggregator` NAV feed → auction `floorPrice` at creation, plus a NAV deviation band enforced in the hook (§3.7).
10. TypeScript indexer over auction and ATS events → Postgres → REST API (§4, §5.7).
11. Next.js web app: auction book, live cap-table projection, bid submission, claim, settlement log (§3.8).
12. Foundry test suite including the four adversarial cases in §7.
13. Required artifacts: public repo with real commit history, `README.md` mapping features to each sponsor's stated criteria line by line, `FEEDBACK.md`, Uniswap Developer Feedback Form submission, HashScan-verified contracts, demo video ≤ 5 minutes.

### 2.3 Explicitly out of scope

- Any modification to CCA. The contribution is a hook and a router that compose with the **unmodified** contracts. Forking CCA forfeits the Uniswap claim.
- Two-sided order book, RFQ, or continuous matching. Cap Table is a **periodic sell-side auction**, and the README must say so in those words.
- CCA graduation into a Uniswap v4 LBP pool. An ERC-3643 token cannot live in a permissionless pool — every swap to an unverified address reverts. `requiredCurrencyRaised` is used purely as a reserve price; `lbpInitializationParams()` is never called. This is stated in the README as a design finding, not omitted silently.
- ERC-20 payment currency. The auction currency is **native HBAR** (`currency = address(0)`), which bypasses CCA's hard Permit2 dependency (§6.2). Stablecoin settlement is documented as future work in `FEEDBACK.md`.
- Multi-partition trading. One partition (the ATS default) only.
- Upstream PR merge. An unmerged PR to `hashgraph/asset-tokenization-studio` is opened and linked; merge is not a requirement.
- Chainlink CRE workflows. The Chainlink integration is the NAV feed and the deviation band, nothing more.
- Mainnet. Testnet only.
- Real KYC/identity providers. ATS's internal KYC facet with scripted issuer grants.

### 2.4 Cut order if behind schedule

Cut in this order, first to go at the top. Everything below the line is the floor; beneath it the submission stops qualifying.

1. Coupon distribution (§3.6)
2. Web app write paths — degrade to read-only dashboard plus `forge script` drivers
3. NAV deviation band in the hook (keep `floorPrice` from the feed)
4. Indexer historical series — keep current-state queries only
5. Upstream PR
— **floor** —
6. ISIN + issuance + KYC sequence, CCA deployed on testnet, `CapTableValidationHook` with register projection, `SettlementRouter` with ATS hold settlement, compliance-aware claim, tests for §7.1–§7.4, README, `FEEDBACK.md`, feedback form, video.

---

## 3. Functional Requirements

Requirements are numbered `FR-n`. Each is testable. "MUST" is binding; "SHOULD" is expected but cuttable per §2.4.

### 3.1 Bond issuance

**FR-1.** The system MUST generate a syntactically valid ISO 6166 ISIN deterministically from a seed string. ATS's `deployBond` reverts `WrongISIN` on any ISIN failing full ISO 6166 validation **including the Luhn check digit**.

Algorithm:
```
input:  countryCode (2 uppercase alpha, e.g. "US"), nsin (9 alphanumeric uppercase)
step 1: body = countryCode + nsin                       // 11 chars
step 2: expand each char to digits: '0'-'9' -> itself
                                    'A'-'Z' -> ordinal (A=10 ... Z=35), rendered as decimal digits
step 3: over the expanded digit string, apply Luhn:
          - index digits from the right, starting at 1
          - double every digit at an odd index
          - if a doubled value > 9, subtract 9
          - sum all values -> S
step 4: checkDigit = (10 - (S mod 10)) mod 10
output: countryCode + nsin + checkDigit                 // 12 chars
```
A unit test MUST assert the generator produces `US0378331005` for `countryCode="US", nsin="037833100"` (Apple Inc., a published ISIN) and that the generator's own output round-trips through an independent validator.

**FR-2.** The system MUST deploy an ATS bond on Hedera testnet with: name, symbol, decimals `2`, the generated ISIN, a nominal value, a coupon rate, a coupon frequency, and a maturity date at least 30 days out. Deployment parameters live in `config/bond.testnet.json` and are read by the deploy script.

**FR-3.** The system MUST execute the KYC enablement sequence in exactly this order, because `grantKyc` reverts `AccountIsNotIssuer` unless the issuer is on the bond's SSI issuer list and the zero-address default fails only at the on-chain revert:
1. `grantRole(ROLE_SSI_MANAGER, adminAddress)`
2. `addIssuer(issuerAddress)` on the SSI management facet
3. `grantKyc(account)` for each account, called by `issuerAddress`

**FR-4.** The issuance script MUST be **idempotent**. Re-running it MUST detect an existing deployment recorded in `deployments/hedera-testnet.json` and skip completed steps rather than reverting. Each step logs `SKIP` or `EXEC` with the transaction hash.

**FR-5.** The system MUST configure the bond's compliance module with a **maximum investor count** and a **maximum ownership percentage** (basis points of total supply). If the deployed ATS compliance module does not expose these as configurable rules, the system MUST deploy `CapTableComplianceModule` (§5.5) implementing `ICompliance` with those two rules and register it via `setCompliance`. **This fallback is the expected path and MUST be built; discovering the built-in module is a bonus, not a dependency.**

### 3.2 Auction creation

**FR-6.** Auction parameters MUST be assembled as `AuctionParameters` and ABI-encoded as `configData`:

| Field | Value for the demo auction |
|---|---|
| `currency` | `address(0)` — native HBAR |
| `tokensRecipient` | seller EOA |
| `fundsRecipient` | seller EOA |
| `startBlock` | `block.number + 30` (≈60 s at Hedera's 2 s cadence) |
| `endBlock` | `startBlock + 300` (≈10 min) |
| `claimBlock` | `endBlock + 30` (≈60 s) |
| `tickSpacing` | Q96 value corresponding to 0.25 price points on a par-100 basis |
| `validationHook` | deployed `CapTableValidationHook` |
| `floorPrice` | Q96 encoding of `NAV × 0.98`, read from the aggregator at creation time |
| `requiredCurrencyRaised` | 60% of `TOTAL_SUPPLY × floorPrice` — reserve price |
| `auctionStepsData` | packed schedule releasing `TOTAL_SUPPLY` linearly over `startBlock → endBlock` |

**FR-7.** The creation sequence MUST be exactly:
1. `predicted = factory.getAddress(token, amount, configData, salt, sender)`
2. `grantKyc(predicted)` — **the auction contract is KYC-granted before it exists**
3. `bond.transfer(predicted, TOTAL_SUPPLY)` from the seller
4. `factory.create(token, amount, configData, salt)`

Rationale, which MUST appear as a comment in the script and a paragraph in the README: CCA's constructor reverts unless `TOKEN.balanceOf(address(this)) >= TOTAL_SUPPLY`, and the factory does not pull tokens — it only `new`s the contract with a CREATE2 salt. ATS's `ComplianceModifiers` requires *"To address must be compliant."* Therefore the bonds must be sitting at a compliant counterfactual address at construction time.

**FR-8.** If step 4 reverts, the script MUST print the recovery path: the bonds are recoverable from `predicted` only by deploying to that address, so the script MUST NOT proceed to step 3 unless step 4's parameters are frozen. The script MUST perform a dry-run `create` against a local Anvil fork of Hedera state before executing step 3 on testnet.

**FR-9.** The seller MUST also grant KYC to the `SettlementRouter` address, since the router becomes the holder of record for all filled allocations before redistribution.

### 3.3 Bid validation — the core mechanism

**FR-10.** `CapTableValidationHook` MUST implement `IValidationHook`:
```solidity
function validate(
    uint256 maxPrice,
    uint128 amount,
    address owner,
    address sender,
    bytes calldata hookData
) external;
```
It MUST revert to reject. It MUST NOT return a boolean; the interface's contract is *"MUST revert to signal that the bid is invalid."*

**FR-11.** The hook MUST enforce **router-only submission**: `require(sender == SETTLEMENT_ROUTER, DirectBidsNotPermitted())`. Direct calls to `auction.submitBid` revert. This is what makes the beneficial-ownership indirection safe.

**FR-12.** `hookData` MUST decode as `abi.decode(hookData, (address beneficialOwner, bytes32 nonce))`. The hook MUST validate `beneficialOwner`, not `owner` — `owner` is always the router.

**FR-13.** The hook MUST perform these checks in this order, reverting with a distinct typed error at the first failure:

| # | Check | Error |
|---|---|---|
| 1 | `sender == SETTLEMENT_ROUTER` | `DirectBidsNotPermitted()` |
| 2 | `beneficialOwner != address(0)` | `ZeroBeneficialOwner()` |
| 3 | `kyc.getKycStatus(beneficialOwner) == GRANTED` | `BidderNotKycGranted(address)` |
| 4 | `!controlList.isBlocked(beneficialOwner)` | `BidderBlocked(address)` |
| 5 | `compliance.canTransfer(auction, beneficialOwner, worstCaseFill)` | `TransferWouldFailCompliance(address,uint256)` |
| 6 | Register projection — holder count (§FR-14) | `WouldExceedMaxInvestors(uint256 projected, uint256 max)` |
| 7 | Register projection — ownership share (§FR-15) | `WouldExceedMaxOwnership(uint256 projectedBps, uint256 maxBps)` |
| 8 | NAV deviation band (§FR-17) | `PriceOutsideNavBand(uint256 maxPrice, uint256 lo, uint256 hi)` |

**FR-14.** *Register projection — holder count.* Define `worstCaseFill = amount` (a bid clearing fully at its own `maxPrice` receives at most `amount` tokens). The hook MUST:
1. Read `currentHolders = securityHolders.getTotalSecurityHolders()`
2. Read `maxInvestors` from the compliance module
3. `isExistingHolder = bond.balanceOf(beneficialOwner) > 0 || router.isPendingBeneficiary(beneficialOwner)`
4. `projectedHolders = currentHolders + (isExistingHolder ? 0 : 1) + router.pendingNewBeneficiaryCount()`
5. `require(projectedHolders <= maxInvestors, WouldExceedMaxInvestors(projectedHolders, maxInvestors))`

`router.pendingNewBeneficiaryCount()` counts beneficiaries with live bids who are not yet holders. Without it, N simultaneous bids each individually project `currentHolders + 1` and all pass, then all settle and breach the cap. **This is the correctness core of the mechanism and MUST have a dedicated test (§7.1).**

**FR-15.** *Register projection — ownership share.*
1. `projectedBalance = bond.balanceOf(beneficialOwner) + router.pendingAmountFor(beneficialOwner) + amount`
2. `projectedBps = projectedBalance * 10_000 / bond.totalSupply()`
3. `require(projectedBps <= maxOwnershipBps, WouldExceedMaxOwnership(projectedBps, maxOwnershipBps))`

**FR-16.** The hook MUST be **view-equivalent apart from the router's pending accounting**. It performs no state writes of its own. All pending state lives in `SettlementRouter` and is written by the router before it calls `submitBid`.

**FR-17.** *NAV deviation band.* The hook MUST read `latestRoundData()` from the configured aggregator and require `maxPrice ∈ [nav × (10_000 - bandBps) / 10_000, nav × (10_000 + bandBps) / 10_000]` in Q96 terms, with `bandBps` configurable (default 1000 = ±10%). If the aggregator's `updatedAt` is older than `maxStaleness` (default 3600 s), the hook MUST skip the band check rather than revert, and emit `NavFeedStale(uint256 updatedAt)`. **A stale oracle must never halt the auction.**

**FR-18.** The hook MUST expose `previewValidate(uint256 maxPrice, uint128 amount, address beneficialOwner) external view returns (bool ok, bytes4 reason)` running the identical logic without reverting, for the web app's live pre-flight display. The two paths MUST share one internal function so they cannot diverge.

### 3.4 Bid submission through the settlement router

**FR-19.** `SettlementRouter.placeBid(uint256 maxPriceQ96, uint128 amount, uint256 prevTickPriceQ96) external payable returns (uint256 bidId)` MUST:
1. `require(msg.value == amount, IncorrectValue())` — HBAR currency, so CCA requires `msg.value == _amount`
2. Write pending accounting: `pendingAmount[msg.sender] += amount`; if `!isPendingBeneficiary[msg.sender]` and `bond.balanceOf(msg.sender) == 0`, set the flag and `pendingNewBeneficiaries++`
3. Call `auction.submitBid{value: amount}(maxPriceQ96, amount, address(this), prevTickPriceQ96, abi.encode(msg.sender, nonce))`
4. Record `bids[bidId] = Bid({beneficiary: msg.sender, amount: amount, maxPriceQ96: maxPriceQ96, claimed: false, refunded: false})`
5. Emit `BidPlaced(bidId, msg.sender, maxPriceQ96, amount)`

**FR-20.** If `submitBid` reverts, the router MUST revert with the underlying error bubbled unchanged, and the pending accounting from step 2 MUST be rolled back by the revert. The router MUST NOT use try/catch around `submitBid`.

**FR-21.** `SettlementRouter.exitBid(uint256 bidId)` MUST be callable after the auction is over by the beneficiary, calling `auction.exitBid` and forwarding the HBAR refund, and MUST decrement pending accounting.

### 3.5 Settlement and compliance-aware claim

**FR-22.** After `claimBlock`, anyone MAY call `SettlementRouter.settle(uint256 bidId)`. The router MUST:
1. `require(!bids[bidId].claimed && !bids[bidId].refunded, AlreadySettled())`
2. Call `auction.claimTokens(bidId)` — tokens arrive at the router, which is KYC-granted (FR-9)
3. Determine `tokensFilled` as the router's bond balance delta across step 2, and `currencyRefund` as its native balance delta
4. Evaluate `eligible = kyc.getKycStatus(b) == GRANTED && !controlList.isBlocked(b) && compliance.canTransfer(address(this), b, tokensFilled)`
5. If `eligible`: create an ATS hold and complete DvP settlement per FR-23
6. If `!eligible`: execute the refund path per FR-24
7. Forward `currencyRefund` to the beneficiary in both branches
8. Decrement pending accounting; emit `Settled(bidId, beneficiary, tokensFilled, path)`

**FR-23.** *DvP settlement leg.* The router MUST NOT raw-`transfer` the bond to the beneficiary. It MUST:
1. Generate `secret = keccak256(abi.encode(bidId, block.chainid, SALT))` and `lockHash = keccak256(abi.encode(secret))`
2. Call `bond.holdByPartition(DEFAULT_PARTITION, beneficiary, tokensFilled, expiration, lockHash)` — the router is the token holder, so it may create holds
3. Emit `HoldCreated(bidId, holdId, lockHash, expiration)`
4. `SettlementRouter.executeHold(uint256 bidId, bytes32 secret)` reveals the secret and executes the hold, transferring the bond atomically

This is what makes the claim *"we did not reinvent DvP — the auction discovers price, ATS settles"* true in the code and not only in the README. The README MUST point at these exact functions.

**FR-24.** *Refund path.* If the beneficiary has become ineligible between bidding and settlement, the router MUST:
1. NOT attempt the token transfer
2. Compute `refundValue = tokensFilled × clearingPriceQ96 >> 96`
3. Transfer `refundValue` in HBAR to the beneficiary from the router's settlement reserve
4. Transfer the unclaimable `tokensFilled` back to `tokensRecipient` (the seller)
5. Emit `RefundedIneligible(bidId, beneficiary, tokensFilled, refundValue)`

The settlement reserve is funded at settlement time from `fundsRecipient`'s proceeds via `SettlementRouter.fundReserve()` called by the seller before the first settle. If the reserve is underfunded, `settle` MUST revert `ReserveUnderfunded(uint256 needed, uint256 have)` rather than silently stranding the bidder — the failure must be loud and recoverable, never a permanent loss.

**FR-25.** Without this path, a bidder frozen between bidding and claiming has already paid, is filled, cannot `exitBid`, and their currency is unrecoverable. A test MUST demonstrate the naive failure (§7.2) and the fixed behaviour side by side.

### 3.6 Coupon distribution *(SHOULD)*

**FR-26.** After settlement, `couponFacet.setCoupon(...)` MUST schedule a coupon with a record date. On the record date a keeper MUST snapshot holders and trigger distribution, and the web app MUST show each holder's coupon entitlement.

### 3.7 Oracle

**FR-27.** `MockV3Aggregator` MUST implement `AggregatorV3Interface` with `decimals() = 8`, settable `latestAnswer`, and a monotonically increasing `roundId`. A `setNav(int256)` admin function drives the demo.

**FR-28.** The deploy script MUST accept `--real-feed <address>`; when supplied, no mock is deployed and the address is used directly. The README MUST state which was used in the recorded demo.

### 3.8 Web application

**FR-29.** Route `/` — auction overview: countdown to `startBlock`/`endBlock`/`claimBlock` in blocks and estimated seconds at 2 s/block, current clearing price, total raised, graduation status, NAV, floor price.

**FR-30.** Route `/book` — the tick book: bids grouped by tick price, cumulative demand curve, clearing-price marker.

**FR-31.** Route `/register` — **the cap-table panel, and the visual centre of the demo.** Current holders / max investors as a filled bar; largest holder ownership bps against the cap; a list of pending beneficiaries with their projected post-fill positions; and a live banner reading *"N of M investor slots remaining"*.

**FR-32.** Route `/bid` — bid form. On every keystroke it MUST call `previewValidate` (FR-18) and render the outcome inline: green with the projected register delta, or red with the decoded error name and a plain-English explanation. **The rejection must be visible before the user submits, not after.**

**FR-33.** Route `/settle` — per-bid settlement state machine with a Claim / Execute Hold button, and an explicit `REFUNDED_INELIGIBLE` state rendered distinctly.

**FR-34.** All reads MUST come from the indexer's REST API (§5.7), not directly from RPC, except the `previewValidate` call which MUST hit the chain live.

---

## 4. Data Model / Schema

### 4.1 On-chain storage — `SettlementRouter`

```solidity
struct Bid {
    address beneficiary;      // beneficial owner; hook validates this, not `owner`
    uint128 amount;           // HBAR committed, wei-denominated (18dp on Hedera EVM)
    uint256 maxPriceQ96;      // Q96 price
    uint128 tokensFilled;     // set at settle; 0 until then
    uint64  placedBlock;
    uint64  settledBlock;     // 0 until settled
    bytes32 lockHash;         // 0 until hold created
    uint8   state;            // see §4.2
}

mapping(uint256 bidId => Bid) public bids;
mapping(address beneficiary => uint256) public pendingAmount;
mapping(address beneficiary => bool)    public isPendingBeneficiary;
uint256 public pendingNewBeneficiaries;
uint256 public settlementReserve;         // HBAR held for ineligible refunds
address public immutable AUCTION;
address public immutable BOND;
bytes32 public constant DEFAULT_PARTITION = bytes32(0);
```

### 4.2 Bid state machine

| State | Value | Entered by | Exits to |
|---|---|---|---|
| `NONE` | 0 | — | `PLACED` |
| `PLACED` | 1 | `placeBid` | `EXITED`, `CLAIMABLE` |
| `EXITED` | 2 | `exitBid` after a non-graduated auction | terminal |
| `CLAIMABLE` | 3 | auction reaches `claimBlock` | `HELD`, `REFUNDED_INELIGIBLE` |
| `HELD` | 4 | `settle` when eligible — ATS hold created | `SETTLED`, `HOLD_EXPIRED` |
| `SETTLED` | 5 | `executeHold` with the secret | terminal |
| `HOLD_EXPIRED` | 6 | hold expiration passes unexecuted | `REFUNDED_INELIGIBLE` |
| `REFUNDED_INELIGIBLE` | 7 | `settle` when ineligible, or expiry sweep | terminal |

Illegal transitions MUST revert `InvalidStateTransition(uint8 from, uint8 to)`.

### 4.3 On-chain storage — `CapTableComplianceModule`

```solidity
struct Rules {
    uint32  maxInvestors;      // 0 = unlimited
    uint16  maxOwnershipBps;   // 0 = unlimited; basis points of totalSupply
    bool    active;
}
Rules public rules;
address public immutable BOND;
```
Implements `canTransfer(address from, address to, uint256 amount) external view returns (bool)` per `ICompliance`, plus `maxInvestors()` and `maxOwnershipBps()` getters consumed by the hook.

### 4.4 Off-chain schema (Postgres)

```sql
CREATE TABLE auctions (
  address            TEXT PRIMARY KEY,
  bond_address       TEXT NOT NULL,
  currency           TEXT NOT NULL,
  start_block        BIGINT NOT NULL,
  end_block          BIGINT NOT NULL,
  claim_block        BIGINT NOT NULL,
  tick_spacing       NUMERIC(78,0) NOT NULL,
  floor_price_q96    NUMERIC(78,0) NOT NULL,
  total_supply       NUMERIC(78,0) NOT NULL,
  required_raised    NUMERIC(78,0) NOT NULL,
  validation_hook    TEXT NOT NULL,
  created_at_block   BIGINT NOT NULL
);

CREATE TABLE bids (
  bid_id             BIGINT PRIMARY KEY,
  auction_address    TEXT NOT NULL REFERENCES auctions(address),
  beneficiary        TEXT NOT NULL,
  max_price_q96      NUMERIC(78,0) NOT NULL,
  amount             NUMERIC(78,0) NOT NULL,
  tokens_filled      NUMERIC(78,0),
  state              SMALLINT NOT NULL,
  placed_block       BIGINT NOT NULL,
  placed_tx          TEXT NOT NULL,
  settled_block      BIGINT,
  settled_tx         TEXT,
  lock_hash          TEXT
);
CREATE INDEX ON bids (auction_address, max_price_q96 DESC);
CREATE INDEX ON bids (beneficiary);

CREATE TABLE rejections (
  id                 BIGSERIAL PRIMARY KEY,
  auction_address    TEXT NOT NULL,
  attempted_by       TEXT NOT NULL,
  beneficiary        TEXT NOT NULL,
  max_price_q96      NUMERIC(78,0) NOT NULL,
  amount             NUMERIC(78,0) NOT NULL,
  error_selector     TEXT NOT NULL,
  error_name         TEXT NOT NULL,
  decoded_args       JSONB NOT NULL,
  block_number       BIGINT NOT NULL,
  tx_hash            TEXT
);

CREATE TABLE checkpoints (
  auction_address    TEXT NOT NULL,
  block_number       BIGINT NOT NULL,
  clearing_price_q96 NUMERIC(78,0) NOT NULL,
  supply_released    NUMERIC(78,0) NOT NULL,
  currency_raised    NUMERIC(78,0) NOT NULL,
  PRIMARY KEY (auction_address, block_number)
);

CREATE TABLE holders (
  bond_address       TEXT NOT NULL,
  holder             TEXT NOT NULL,
  balance            NUMERIC(78,0) NOT NULL,
  kyc_status         SMALLINT NOT NULL,
  blocked            BOOLEAN NOT NULL DEFAULT FALSE,
  updated_block      BIGINT NOT NULL,
  PRIMARY KEY (bond_address, holder)
);

CREATE TABLE register_snapshots (
  bond_address       TEXT NOT NULL,
  block_number       BIGINT NOT NULL,
  holder_count       INT NOT NULL,
  max_investors      INT NOT NULL,
  largest_bps        INT NOT NULL,
  max_ownership_bps  INT NOT NULL,
  PRIMARY KEY (bond_address, block_number)
);
```

**`rejections` is a first-class table, not a log.** The rejected bids are the product; the demo and the README both read from it.

### 4.5 Numeric conventions

- Prices are **Q96**: `priceQ96 = price × 2^96`, where price is currency-wei per token-unit.
- Bond decimals `2`, so one bond unit is `100` raw. Par 100.00 is `10_000` raw units of price basis — the price-to-Q96 helper MUST be a single audited function `toQ96(uint256 pricePerBondCents)` used everywhere, with a round-trip fuzz test.
- Ownership is basis points of `totalSupply`, integer division, floor.
- All monetary values in Postgres are `NUMERIC(78,0)` — never floats.

---

## 5. API / Interface Contracts

### 5.1 `IValidationHook` (consumed, unmodified)
```solidity
interface IValidationHook {
    function validate(uint256 maxPrice, uint128 amount, address owner, address sender, bytes calldata hookData) external;
}
```

### 5.2 `CapTableValidationHook` (produced)
```solidity
interface ICapTableValidationHook is IValidationHook {
    error DirectBidsNotPermitted();
    error ZeroBeneficialOwner();
    error BidderNotKycGranted(address beneficialOwner);
    error BidderBlocked(address beneficialOwner);
    error TransferWouldFailCompliance(address beneficialOwner, uint256 amount);
    error WouldExceedMaxInvestors(uint256 projected, uint256 max);
    error WouldExceedMaxOwnership(uint256 projectedBps, uint256 maxBps);
    error PriceOutsideNavBand(uint256 maxPrice, uint256 lo, uint256 hi);

    event NavFeedStale(uint256 updatedAt);

    function previewValidate(uint256 maxPrice, uint128 amount, address beneficialOwner)
        external view returns (bool ok, bytes4 reason);
    function registerState() external view returns (uint256 holders, uint256 maxInvestors, uint256 largestBps, uint256 maxOwnershipBps);
}
```

### 5.3 `SettlementRouter` (produced)
```solidity
interface ISettlementRouter {
    event BidPlaced(uint256 indexed bidId, address indexed beneficiary, uint256 maxPriceQ96, uint128 amount);
    event HoldCreated(uint256 indexed bidId, bytes32 indexed holdId, bytes32 lockHash, uint64 expiration);
    event Settled(uint256 indexed bidId, address indexed beneficiary, uint128 tokensFilled, uint8 path);
    event RefundedIneligible(uint256 indexed bidId, address indexed beneficiary, uint128 tokensFilled, uint256 refundValue);

    error IncorrectValue();
    error AlreadySettled();
    error ReserveUnderfunded(uint256 needed, uint256 have);
    error InvalidStateTransition(uint8 from, uint8 to);

    function placeBid(uint256 maxPriceQ96, uint128 amount, uint256 prevTickPriceQ96) external payable returns (uint256 bidId);
    function exitBid(uint256 bidId) external;
    function settle(uint256 bidId) external;
    function executeHold(uint256 bidId, bytes32 secret) external;
    function fundReserve() external payable;
    function pendingAmountFor(address beneficiary) external view returns (uint256);
    function isPendingBeneficiary(address beneficiary) external view returns (bool);
    function pendingNewBeneficiaryCount() external view returns (uint256);
}
```

### 5.4 ATS surface consumed (raw ABI)

| Facet | Function | Use |
|---|---|---|
| Factory | `deployBond(BondData,SecurityData)` | issuance |
| AccessControl | `grantRole(bytes32 role, address account)` | `ROLE_SSI_MANAGER` |
| SsiManagement | `addIssuer(address)` | prerequisite for `grantKyc` |
| Kyc | `grantKyc(address)` / `revokeKyc(address)` / `getKycStatus(address)` | eligibility |
| ControlList | `addToControlList(address)` / `isBlocked(address)` | freeze |
| Compliance | `canTransfer(address,address,uint256)` / `setCompliance(address)` | rules |
| ERC-20 facet | `transfer` / `balanceOf` / `totalSupply` | custody |
| Hold | `holdByPartition(bytes32,address,uint256,uint64,bytes32)` / `executeHoldByPartition(...)` | DvP |
| SecurityHolders | `getTotalSecurityHolders()` | register projection |
| Coupon | `setCoupon(...)` / `getCouponFor(address,uint256)` | corporate action |

Every selector MUST be resolved against the deployed Diamond via `DiamondLoupe.facetAddress(bytes4)` in a day-1 script; any selector that resolves to `address(0)` is missing from the deployed version and MUST be reported before code is written against it.

### 5.5 `ICompliance` (implemented by the fallback module)
```solidity
interface ICompliance {
    function canTransfer(address _from, address _to, uint256 _amount) external view returns (bool);
}
```

### 5.6 `AggregatorV3Interface` (consumed)
```solidity
function latestRoundData() external view returns (
    uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound
);
function decimals() external view returns (uint8);
```

### 5.7 Indexer REST API

Base `http://localhost:8080/api`. All numeric fields are **decimal strings**, never JSON numbers.

`GET /auction/:address`
```json
{
  "address": "0x5f...",
  "bond": "0xa3...",
  "phase": "OPEN",
  "currentBlock": "10482911",
  "startBlock": "10482600", "endBlock": "10482900", "claimBlock": "10482930",
  "secondsRemaining": 38,
  "clearingPriceQ96": "8031810176500000000000000000000",
  "clearingPriceDisplay": "101.25",
  "floorPriceQ96": "7772160000000000000000000000000",
  "navDisplay": "103.31",
  "supplyReleased": "620000", "totalSupply": "1000000",
  "currencyRaised": "62775000000000000000000",
  "requiredCurrencyRaised": "46632960000000000000000",
  "graduated": true
}
```

`GET /auction/:address/book`
```json
{ "ticks": [ { "priceQ96": "8031810176500000000000000000000", "priceDisplay": "101.25",
               "demand": "340000", "cumulativeDemand": "340000", "isClearing": true } ],
  "clearingTickIndex": 0 }
```

`GET /bond/:address/register`
```json
{
  "holderCount": 41, "maxInvestors": 50, "slotsRemaining": 9,
  "largestHolderBps": 1180, "maxOwnershipBps": 1500,
  "pendingBeneficiaries": [
    { "address": "0x91...", "currentBalance": "0", "pendingAmount": "20000",
      "projectedBps": 200, "isNewHolder": true }
  ],
  "atBlock": "10482911"
}
```

`GET /auction/:address/rejections?limit=50`
```json
{ "rejections": [
  { "beneficiary": "0x77...", "maxPriceDisplay": "101.50", "amount": "5000",
    "errorName": "WouldExceedMaxInvestors",
    "decodedArgs": { "projected": "51", "max": "50" },
    "humanReason": "Filling this bid would make 51 holders of record against a 50-investor limit.",
    "blockNumber": "10482880" } ] }
```

`GET /bid/:bidId` → the full `Bid` struct plus `stateName` and, when `REFUNDED_INELIGIBLE`, a `reason` string.

`GET /health` → `{ "ok": true, "headBlock": "10482911", "lagBlocks": 2 }`

**Error envelope**, used by every endpoint:
```json
{ "error": { "code": "AUCTION_NOT_INDEXED", "message": "No auction at that address in this index.", "retryable": false } }
```

### 5.8 Frontend → chain writes

Only three: `SettlementRouter.placeBid` (payable), `SettlementRouter.settle`, `SettlementRouter.executeHold`. Everything else is a read. The app MUST simulate every write with `viem`'s `simulateContract` and render the decoded revert reason before enabling the button.

---

## 6. Technical Constraints & Assumptions

**6.1 Hedera block model.** HIP-415 defines a block as a record file at a minimum 2-second cadence, with `block.number` incrementing by exactly one per file and the `NUMBER` opcode reliable. CCA is entirely block-driven — `startBlock`, `endBlock`, `claimBlock`, tokens-per-block steps, and a lazy per-block `checkpoint()`. **All block-denominated parameters MUST be sized for 2 s, not 12 s.** An auction parameterised for Ethereum runs six times faster here and will end mid-narration. Every countdown in the UI MUST convert blocks to seconds at 2 s/block and label the assumption.

**6.2 Permit2.** `submitBid` has exactly two paths: native value, or `SafeTransferLib.permit2TransferFrom`. There is **no plain `transferFrom` fallback**. Whether Permit2 exists at the canonical address on Hedera is unverified. The build therefore uses `currency = address(0)` (native HBAR) and sidesteps it entirely. If the day-1 check finds Permit2 deployed, an HTS-stablecoin variant becomes optional upside — it is not planned work.

**6.3 Contract size.** CCA pulls `v4-periphery`, `liquidity-launcher`, `solady` and OpenZeppelin, with the optimizer at 11111 runs. Hedera's bytecode limit is the last unresolved external unknown. Day-1 kill check deploys the unmodified factory to testnet before any other work starts.

**6.4 ATS ERC-20 semantics.** ATS is ERC-1400 with partitions and exposes an ERC-20 facet. CCA calls plain `transfer` and `balanceOf` in three places. Whether plain `transfer` routes correctly to the default partition under compliance is a day-1 check; if it does not, the settlement router must move to `transferByPartition` throughout and the auction's token-side calls need re-examination.

**6.5 Gas in the bid path.** The hook is an unbounded external call inside `submitBid`, and ATS compliance reads are Diamond delegatecalls across several facets. The build MUST record measured gas for `submitBid` with and without the hook in `README.md`. If a bid exceeds 400,000 gas, the hook MUST cache `maxInvestors`, `maxOwnershipBps` and `totalSupply` in immutables set at construction, re-reading only the mutable holder count.

**6.6 Day-1 kill checks.** Executed in throwaway directories, before the repo's first commit, in this order. Each has a defined fallback.

| # | Check | If it fails |
|---|---|---|
| 1 | Unmodified CCA factory deploys on Hedera testnet | Reduce optimizer target / strip unused imports; if still failing, escalate — this is the only check without a cheap fallback |
| 2 | ATS plain `transfer` routes to default partition under compliance | Switch all custody paths to `transferByPartition` |
| 3 | Every ATS selector in §5.4 resolves via `DiamondLoupe` | Build the missing facet's behaviour into `CapTableComplianceModule` |
| 4 | Permit2 present at the canonical address | Already assumed absent — no action, records a `FEEDBACK.md` line either way |
| 5 | Any Chainlink feed on Hedera testnet | Ship `MockV3Aggregator`, already the planned path |
| 6 | `getAddress` → `grantKyc` → `transfer` → `create` sequence works end to end | If CREATE2 prediction mismatches, fall back to deploying the auction first with a zero-supply guard bypass — requires escalation |

**6.7 Pre-event rule.** ETHGlobal's Classic track requires the project to begin when hacking begins; pre-existing project-specific code is not permitted and undisclosed prior work means disqualification and prize revocation. Everything before 4 Sep is reading, running upstream examples, and breaking things somewhere that never becomes this repository. **Learn everything, commit nothing.**

**6.8 Assumptions.** `securityHolders.getTotalSecurityHolders()` exists and is O(1). The deployed ATS compliance module may not expose configurable investor caps, so `CapTableComplianceModule` is planned work, not a contingency. Hedera testnet HBAR is obtainable in sufficient quantity for ~40 bids plus deployments. HashScan verification accepts Foundry standard-JSON input.

---

## 7. Edge Cases & Error Handling

### 7.1 The concurrent-bid holder-cap race *(highest severity)*
Register at 49 of 50 investors. Five new beneficiaries each bid simultaneously. Each bid, evaluated alone, projects 50 and passes. All five settle. Register hits 54 — the token's own compliance rules are breached by the venue that was supposed to enforce them.
**Expected behaviour:** the first bid passes and increments `pendingNewBeneficiaries`; bids two through five project 51+ and revert `WouldExceedMaxInvestors`. **Required test:** five bids in one block, exactly one succeeds.

### 7.2 Bidder frozen between bid and claim
Beneficiary bids while eligible, is added to the control list before `claimBlock`, and is filled.
**Naive behaviour:** `claimTokens` reverts inside ATS compliance; the bidder cannot `exitBid` because they are filled; HBAR is permanently stranded.
**Expected behaviour:** `settle` detects ineligibility, refunds `tokensFilled × clearingPrice` in HBAR from the reserve, returns the tokens to the seller, emits `RefundedIneligible`, sets state 7. **Required test:** both branches asserted, including the naive failure as a documented `vm.expectRevert`.

### 7.3 Settlement reserve underfunded
Ineligible refund exceeds `settlementReserve`.
**Expected:** revert `ReserveUnderfunded(needed, have)`; state unchanged; `settle` retryable after `fundReserve()`. Never a partial refund, never a state advance.

### 7.4 `owner` / `sender` bypass attempt
A KYC-granted account calls `auction.submitBid` directly with `_owner` set to a non-granted address.
**Expected:** revert `DirectBidsNotPermitted()` at check 1, before any compliance read. **Required test**, and this is a demo beat.

### 7.5 Auction fails to graduate
`currencyRaised < requiredCurrencyRaised` at `endBlock`.
**Expected:** every bid is fully refundable via `exitBid`; no settlement occurs; router state goes `PLACED → EXITED`; UI shows `NOT_GRADUATED` with a per-bid refund button; the seller reclaims the full supply via `sweepUnsoldTokens`.

### 7.6 Partial fill at the clearing tick
A bid at exactly the clearing price fills proportionally.
**Expected:** `tokensFilled < amount / price`; the currency remainder returns with the token allocation in the same `settle` call; the register projection used `amount` as the worst case, so a partial fill can only be *less* constraining — never a breach.

### 7.7 Hold expires unexecuted
`executeHold` is not called before `expiration`.
**Expected:** state `HOLD_EXPIRED`; a keeper sweep releases the hold, returns tokens to the seller and refunds the beneficiary at clearing, ending in `REFUNDED_INELIGIBLE`. Expiration is set to `claimBlock + 7 days` in seconds so it cannot fire during the demo.

### 7.8 NAV feed stale or reverting
`updatedAt` older than `maxStaleness`, or `latestRoundData` reverts.
**Expected:** skip the band check, emit `NavFeedStale`, allow the bid. **A broken oracle must never halt the auction.** The `latestRoundData` call MUST be wrapped in a low-level `staticcall` with a bounded gas stipend so a reverting or gas-griefing aggregator cannot brick the bid path.

### 7.9 NAV moves mid-auction
`floorPrice` is fixed at construction; NAV moves 15%.
**Expected:** `floorPrice` does not change — CCA has no setter. The band check follows the live NAV, so bids may become rejectable mid-auction. The UI MUST show the live band and flag when it has moved away from the fixed floor. This is documented as a design limitation, not hidden.

### 7.10 Zero or dust bid
`amount == 0` → CCA reverts `BidAmountTooSmall`. A bid producing a sub-1-raw-unit fill at clearing.
**Expected:** the hook enforces `amount >= MIN_BID` (default 100 raw units = 1.00 bond) and reverts `BidBelowMinimum`. Dust bidders are the cheapest way to attack the investor cap; the minimum is the defence, and the README must say so.

### 7.11 Bid at a non-tick-aligned price
**Expected:** CCA reverts on tick alignment; the UI snaps the input to the nearest valid tick before submission and displays the snapped value.

### 7.12 Beneficiary already at the ownership cap
Holder at 1500 bps against a 1500 cap bids again.
**Expected:** `WouldExceedMaxOwnership(projectedBps, 1500)` with `projectedBps > 1500`. Test the exact-boundary case: a bid landing at exactly 1500 must **pass** (`<=`, not `<`).

### 7.13 Re-entrancy through the hook
The hook is an external call inside `submitBid`, which is `nonReentrant` on the auction. The hook itself performs only view calls into ATS and the router.
**Expected:** the hook MUST NOT call back into the auction or the router's mutating functions. A test MUST assert a malicious hook-shaped reentrancy attempt reverts.

### 7.14 Indexer lag or crash
**Expected:** `/health` reports `lagBlocks`; the UI shows a "data is N blocks behind" banner above 10; `previewValidate` bypasses the indexer entirely and hits the chain, so bid validity is never stale. On restart the indexer resumes from the last persisted block, with the last 32 blocks re-scanned for reorg safety.

### 7.15 Hedera RPC relay failures
Hashio returns 429 or 502 under load.
**Expected:** exponential backoff with jitter, 5 attempts; a second relay URL configurable via `HEDERA_RPC_FALLBACK`; every script prints the tx hash before waiting for a receipt so a dropped receipt never loses the transaction.

### 7.16 Idempotency of every script
Re-running any deploy or setup script MUST be safe. State lives in `deployments/hedera-testnet.json`; each step checks for its own completion marker first.

### 7.17 Decimals confusion
Bond decimals 2, HBAR 18 on the EVM, NAV 8, prices Q96.
**Expected:** one conversion module, fuzz-tested for round-trip identity across the full representable range. No ad-hoc arithmetic anywhere else in the codebase.

### 7.18 Revert-reason decoding in the UI
**Expected:** every custom error in §5.2 and §5.3 has an entry in a shared `errors.ts` map producing a human sentence. An unrecognised selector renders the raw selector and a "report this" affordance rather than a blank failure.

---

## 8. Acceptance Criteria

### 8.1 Qualification gates — binary, and each one alone can void the track

- [ ] Public GitHub repo, first commit dated on or after 4 Sep 2026, with incremental daily commits and no single squashed final commit.
- [ ] All contracts deployed to **Hedera testnet** and **verified on HashScan**, with addresses in the README.
- [ ] `README.md` contains a table mapping each feature to the exact wording of Hedera's six extra-points bullets and to Uniswap's qualification requirements, with file paths and line numbers.
- [ ] `FEEDBACK.md` present, containing at minimum: CCA's Permit2 dependency with no `transferFrom` fallback; the counterfactual-KYC requirement created by the constructor's balance check; and the absence of any claim-time compliance re-check.
- [ ] Uniswap Developer Feedback Form submitted with the `FEEDBACK.md` link, **on day 2 and not on day 9**.
- [ ] Demo video ≤ 5:00 showing issuance, configuration, and at least one lifecycle operation.

### 8.2 Functional acceptance

- [ ] Generator produces `US0378331005` for the Apple seed and passes an independent ISO 6166 validator.
- [ ] A bond issues on Hedera testnet with a valid ISIN, non-zero supply, and KYC grantable to arbitrary accounts.
- [ ] The `getAddress → grantKyc → transfer → create` sequence succeeds and the auction constructor's supply check passes.
- [ ] A KYC-granted beneficiary can place a bid through `SettlementRouter` and it appears in the tick book.
- [ ] A non-granted beneficiary is rejected with `BidderNotKycGranted`.
- [ ] A direct `auction.submitBid` call reverts `DirectBidsNotPermitted`.
- [ ] **With 49 of 50 slots used, five concurrent new-beneficiary bids resolve to exactly one success and four `WouldExceedMaxInvestors` rejections.**
- [ ] A bid landing at exactly `maxOwnershipBps` passes; one basis point above reverts `WouldExceedMaxOwnership`.
- [ ] `previewValidate` and `validate` agree on 1,000 fuzzed inputs.
- [ ] The auction checkpoints per block, graduates above the reserve, and produces a clearing price.
- [ ] An eligible filled bid settles through `holdByPartition` + `executeHoldByPartition`, and the bond arrives via a hold, not a raw transfer.
- [ ] **A beneficiary frozen after bidding is refunded at clearing rather than stranded**, with the naive failure asserted alongside.
- [ ] A non-graduated auction returns every bid in full and the full supply to the seller.
- [ ] `/register` shows live holder count, cap, and pending projections, and updates within 3 blocks of a bid.
- [ ] `/bid` shows the rejection reason live, before submission.
- [ ] Measured `submitBid` gas with and without the hook is recorded in the README.

### 8.3 Demo script — the recorded run, in order

1. **Issue** the bond on testnet. Show the ISIN and the HashScan link. *(≈40 s)*
2. **Create** the auction. Show the counterfactual address being KYC-granted before the contract exists. *(≈30 s)*
3. **Bid, rejected on identity.** Non-granted account. Standard, and deliberately shown fast. *(≈15 s)*
4. **Bid, rejected on the register.** A fully KYC-granted, fully compliant, well-funded bidder is refused — because filling them would make 51 holders against a 50 limit. **This is the beat the submission lives on.** *(≈45 s)*
5. **Bid accepted.** Register updates live on `/register`. *(≈20 s)*
6. **Auction clears** at a uniform price, on camera, in roughly ten minutes of testnet time compressed in the edit — narrated with the two-second-block point. *(≈40 s)*
7. **Settlement via ATS hold.** Show `holdByPartition`, then the secret reveal. Say the sentence: *the auction discovered the price, ATS settled the trade.* *(≈35 s)*
8. **The frozen bidder.** Freeze a filled beneficiary, run `settle`, show the refund and the tokens returning to the seller. Say what would have happened without it. *(≈40 s)*
9. **Coupon distributes** to holders of record. *(≈20 s)*

Total ≈ 4:45. The register rejection must land inside the first 90 seconds of the video, not at step 4's natural position — cut the video so beat 4 appears early, then backfill context.

### 8.4 Definition of done

Cap Table is done when a stranger with the repo, a Hedera testnet account and the README can run `pnpm setup && pnpm deploy:testnet && pnpm demo` and reproduce beats 1 through 8 without asking a question, and when every box in §8.1 and §8.2 is ticked.
