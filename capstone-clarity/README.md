# Capstone Clarity

Here is a comprehensive, granular, and heavily detailed UI/UX Product Requirements Document (PRD) for the Cap Table frontend. This document builds directly upon your technical specification and UX mandate, translating the strict operational requirements into a premium, Web3-native design language.




The aesthetic direction synthesizes dark mode minimalism, glassmorphism, rounded bento-grid layouts, pastel accents, and high-fidelity Lottie animations.




Cap Table — Frontend UI/UX Design PRD

1. Design Philosophy & Global Aesthetic

The application must feel like a high-performance financial instrument wrapped in a cutting-edge Web3 shell. We are avoiding cluttered interfaces, jarring colors, and generic component libraries. The design language is characterized by a "beautiful, dark, and minimalist" aesthetic.




1.1 Core Visual Pillars

Deep Dark Mode: The foundational canvas is not pure black (#000000), but a deep, rich space-grade dark tone (e.g., #0A0A0C). This reduces eye strain while allowing colored elements to glow.

Textured Backgrounds: Flat colors are strictly forbidden for main backgrounds. We will utilize subtle, high-resolution SVG noise/grain overlays blended at a 3-5% opacity. Beneath the bento grids, we will employ blurred, slow-moving mesh gradients using pastel tones (Mint, Lavender, Deep Blue) to simulate light bleeding through frosted glass.

Glassmorphism & Bento Grids: All distinct UI regions (Composer, Register, Console Steps) are housed within bento-box modular cards. These cards feature heavy border radii (24px to 32px), internal padding, and a backdrop-filter blur (backdrop-blur-xl). Borders are ultra-thin (1px) and semi-transparent (rgba(255, 255, 255, 0.08)).

The Terminal Element: To honor the developer-centric nature of the Hedera ecosystem without breaking the strict "no terminal required" mandate, specific read-only data surfaces (like the Bid Pre-flight panel and the Refusal Ledger decoded arguments) will utilize a stylized, glassy CLI aesthetic.

Micro-Interactions & Lottie: Static SVGs are replaced by JSON-based Lottie animations for empty states, loaders, and success metrics.

1.2 Global Color Palette

No "big ugly colors." Every hue is mathematically selected for accessibility and dark-mode vibrancy.




Base Background: #09090B (Rich Zinc) with SVG noise overlay.

Card Surface (Glass): rgba(24, 24, 27, 0.4) with backdrop-filter: blur(24px).

Card Border: rgba(255, 255, 255, 0.06) with a linear gradient shine on hover.

Primary Accent (The Glow): #B692FE (Neon Pastel Purple) — used for primary buttons, active tabs, and positive Lottie accents.

Secondary Accent: #00F0FF (Cyan) — used for secondary data visualization and hover states.

Success: #10B981 (Emerald) — specifically for "KYC Granted" and settled states.

Warning/Refusal: #FF3366 (Deep Crimson) — crucial for the Refusal Ledger and failed pre-flight checks. Never a harsh standard red.

Typography Colors:




Primary Text: #FAFAFA (Off-white, 98% opacity)

Secondary Text: #A1A1AA (Zinc 400)

Disabled Text: #52525B (Zinc 600)

1.3 Typography System

Typography is the backbone of the minimalist aesthetic. No clunky fonts.




Display & Headings: Geist or Inter Display. Tightly tracked (letter-spacing: -0.02em), heavy weights (SemiBold 600, Bold 700) for page titles and large numbers (e.g., Clearing Price).

Body & UI Elements: Inter. Clean, highly legible, regular weight (400) with a 150% line height for maximum readability within bento cards.

Data & Terminal: JetBrains Mono. Applied exclusively to wallet addresses, transaction hashes, Q96 raw values, and the Refusal Ledger output. This creates a beautiful contrast against the sans-serif headings.

2. Component Library & Micro-Interactions

Every component must follow a strict behavior lifecycle: Idle → Hover → Active/Focus → Disabled/Loading.




2.1 The TxAction Button (Primary Write Surface)

The TxAction component is the only way state changes. It must feel weighty and secure.




Idle: background: rgba(182, 146, 254, 0.1); border: 1px solid rgba(182, 146, 254, 0.3); color: #B692FE; border-radius: 12px;

Hover: Smooth scale up to 1.02 using spring physics (stiffness: 400, damping: 25). The background transitions to a fully opaque pastel purple (#B692FE), and text shifts to #09090B. A subtle box-shadow glow 0 0 20px rgba(182, 146, 254, 0.4) engages.

Simulating/Loading State: The text fades out, replaced by a 60fps Lottie animation of a morphing, liquid loading loop (referencing the fluid aesthetic in image_696611.png).

Disabled (Blocked by Role/Validation): Background turns flat transparent, border becomes dashed rgba(255, 255, 255, 0.1), text color drops to #52525B. A tooltip explains exactly why it is disabled.

2.2 Inputs & Bid Composers

Idle: High padding (16px), background rgba(0,0,0,0.2), rounded corners (16px). No visible border, just a subtle inner shadow.

Focus Ring: When active, a glowing border transitions in: box-shadow: 0 0 0 2px rgba(182, 146, 254, 0.5).

Data Entry: Numbers type in JetBrains Mono.

2.3 Status Chips & Pills

Referencing the clean tables in image_69660e.png:




PENDING: Glassy orange/amber background rgba(245, 158, 11, 0.1), amber text, small pulsating Lottie dot.

SETTLED: Glassy emerald background, emerald text.

REFUNDED_INELIGIBLE: Glassy crimson background, crimson text, accompanied by an explicit warning icon.

2.4 Lottie Animation Integration Guidelines

Hero Visuals: Abstract, slow-moving liquid or metallic 3D meshes (referencing image_69662d.png).

Empty States: Never just text. Use a looping, low-opacity Lottie of a wireframe box or radar sweep to indicate scanning/waiting (e.g., waiting for the first bid in the ledger).

Success States: A snappy, custom-drawn Lottie checkmark that draws itself using spring physics, leaving a glowing trail.

3. Page Layouts & Granular UI Specification

3.1 P0 — Landing Page (/)

The landing page must convince a judge in 15 seconds. It is a single scroll, five sections, heavily utilizing the bento grid.




3.1.1 Hero Section

Background: Deep #09090B with a heavy noise texture. A massive, slow-moving mesh gradient (Purple/Cyan) sits behind the text, heavily blurred.

Visual Element: Taking inspiration from image_696611.png, a large, central Lottie animation of a glass-like liquid sphere that slowly morphs.

Typography: The thesis statement is in 72px Geist Bold, tracking -0.04em. Pure white, with a slight text-shadow.

CTAs: Two massive bento-style buttons. "Open the auction" (Primary glow style) and "Operator console" (Glassy transparent style).

3.1.2 The Problem & How it Works (Bento Grid)

Layout: A 3-column asymmetric bento grid.

Card Design: Each card uses the global glassmorphism standard.

Hover Effect: When the user hovers over a "How it Works" step (e.g., "bid submitted"), a micro-Lottie animation in the top right corner of the card plays (e.g., a paper plane turning into a cryptographic hash).

Terminal Integration: The contract functions (previewValidate, holdByPartition) are rendered in small, inline terminal blocks within the body text. Background #000000, text #00F0FF, font JetBrains Mono.

3.1.3 Live Strip

A fixed-height horizontal bar. Instead of a standard marquee, it functions like a Bloomberg terminal ticker stripped of the clutter.

Data points (Clearing Price, Holders against Cap) are separated by glowing vertical 1px dividers.

If no auction is deployed, it shows "AWAITING DEPLOYMENT" in a slow-pulsing Lottie text effect.

3.2 P1 — The Venue (/auction)

This is the demo page. Zero scrolling for the core loop. The layout is a masterclass in information density without visual clutter, taking inspiration from the dashboard in image_69660e.png and the floating UI in image_696614.png.




3.2.1 Status Bar (Sticky Top)

Design: A thin, ultra-blurred glass strip spanning 100% width.

Elements:




Phase Chip: A glowing pill component.

Countdown: Rendered in JetBrains Mono. The seconds pulse subtly every 2s (Hedera block time).

Graduation Badge: A Lottie animation of a filling circular progress bar.

3.2.2 The Register Panel (Hero Left - Bento Card)

Container: width: 40%, height matches the Composer exactly.

Holder Cap Meter: Not a boring HTML progress bar. A continuous, glowing gradient bar (Cyan to Purple). As it nears the maxInvestors cap, the gradient shifts toward Crimson (#FF3366). The text "N slots remaining" floats above it.

Pending Beneficiaries Table:




Minimal headers.

Addresses truncate beautifully: 0x1234...ABCD.

The "New Holder" flag is a tiny glowing Lottie spark.

The single sentence projecting the register sits at the bottom in a dedicated, slightly darker bento sub-card, acting as the definitive truth.

3.2.3 Bid Composer (Hero Right - Bento Card)

Container: width: 60%. This is where the magic happens.

Inputs: Massive, legible inputs for Amount and Max Price. The Q96 snap value appears dynamically below the input in small monospace text.

The Pre-flight Panel (The Terminal):




Located directly beneath the inputs inside the Composer card.

Visual Style: It mimics a terminal window. Background #050505, top bar with three macOS-style dots (but monochrome), font JetBrains Mono, size 13px.

State - Success (Green): Displays projected register delta. The text types out dynamically (simulating a terminal log) on every debounced keystroke.

State - Refusal (Crimson): If previewValidate fails, the panel flashes red for 100ms, then the decoded error (e.g., WouldExceedMaxInvestors) prints out, followed by the plain-English translation. The TxAction submit button instantly drops to 0.3 opacity and disables.

3.2.4 Refusal Ledger (Directly Beneath Composer)

Layout: A wide bento card. Adjacency to the Composer is critical for the "cause and effect" demo beat.

Table Design: No vertical borders, only faint horizontal 1px lines.

Color Coding: The error_name cell uses pastel warning colors depending on the severity.




Identity errors (KYC/Blocked): Amber.

Register Projection errors (Max Investors/Bps): Deep Crimson.

Decoded Arguments: Hovering over the error reveals a tooltip styled as a glass tooltip, displaying the raw JSON payload of the revert.

3.2.5 Book & Bids/Settlement Tables

Data Visualization: Taking heavy inspiration from the smooth, layered charts in image_696631.png. The cumulative demand curve is not a harsh jagged line, but a smoothed SVG path with a gradient fill underneath it (rgba(0, 240, 255, 0.2) fading to transparent at the bottom).

The Clearing Marker: A glowing vertical line slicing through the chart, with a Lottie pulse at the exact intersection of the demand curve.

Bids Table: The "Settle all claimable" button rests in the header. The REFUNDED_INELIGIBLE row has a distinct crimson background tint (rgba(255, 51, 102, 0.05)) across the entire <tr>, ensuring the judge immediately notices the compliance-aware refund path.

3.3 P2 — Operator Console (/console)

This page doubles as the system map. It must not feel like a chaotic admin panel, but rather a sleek, guided mission-control checklist.




3.3.1 Accordion/Bento Mechanics

Structure: Six massive horizontal bento cards stacked vertically.

State Handling:




Incomplete: Height is auto-expanded (using Framer Motion or pure CSS grids for silky smooth height transitions). A Lottie spinner or pulsing dot sits in the header.

Complete: The card collapses to a slim 64px header. A satisfying, vibrant Lottie checkmark permanently stamps the right side. The border color shifts from neutral to a subtle success green (rgba(16, 185, 129, 0.3)).

Auto-Expansion: On mount, the application scans the chain state. The layout smoothly slides open exactly at the user's current step in the lifecycle.

3.3.2 Internal Section Details

Section 0 (Health): A dashboard within a dashboard. 6x2 mini bento grid showing indexer lag, RPC endpoints, and contract verification status. Status dots are live Lottie pulses.

Section 1 (Issue Bond): The ISIN builder is a standout UI element. As the user types the NSIN, the ISO 6166 check digit calculates live. The digit sits in a small, glowing terminal box. When valid, a green border animates around the entire input group.

Section 2 (Compliance Rules): The "Current vs. Proposed" UI uses a split-pane slider or a clear diff view. The plain-language translation panel is styled like a glassy receipt, updating in real-time as the sliders/inputs are adjusted.

Section 3 (Investors): A robust data table. The "Grant KYC" bulk form is a drag-and-drop zone (referencing your SplitWiser preferences) or a sleek textarea. The drop zone is a dashed border with a Lottie animation of a folder opening upon drag-enter.

Section 4 (Create Auction): A StepGate.tsx component that renders a nested vertical timeline. Each step (Predict, Grant, Transfer, Create) connects via a 2px vertical line. When a step completes, a Lottie light particle travels down the line to illuminate the next step. The simulation panel sits at the bottom, styled as a read-only terminal validating the creation parameters before unlocking the final submit button.

4. UI Error Handling & Edge Cases

The UI must never break, crash, or show an unstyled browser alert. All errors are integrated into the design system.




4.1 Revert Reason Decoding

When a transaction fails (e.g., ReserveUnderfunded), the TxAction button enters the "reverted" state.




Visuals: The button shakes slightly (CSS keyframes). The background turns to a flat, dull dark red.

Messaging: A popover styled as a bento tooltip emerges above the button, displaying the raw selector in a tiny terminal chip, followed by the plain-English translation from lib/errors.ts.

4.2 Network Instability (429/502)

If the Hedera RPC is rate-limited, a non-intrusive toast notification slides in from the bottom right.

Design: Glassmorphic background, amber accent, and a looping Lottie animation of a satellite dish searching for a signal. It explicitly states "Network busy, retrying in X seconds" without requiring user intervention.

4.3 Stale Oracle Warning

If updatedAt exceeds maxStaleness, the UI does not block the user. Instead, the NAV display in the Status Bar (P1) changes from a glowing cyan to a muted amber. A subtle pulsing warning icon appears next to it, indicating the band check is bypassed.

5. Mobile & Responsive Hand-off

As per the spec, mobile-optimized layouts are strictly out of scope. The application is designed for a desktop viewport (minimum 1440x900) to ensure the P1 venue core loop (Composer, Register, Ledger) remains visible without scrolling. A CSS media query will deploy a heavily blurred overlay with a Lottie animation of a desktop monitor on screens below 1024px, gently advising the user to expand their window to experience the complex multi-panel dashboard properly.


Product: Cap Table — compliance-gated clearing auction for ATS-issued securities on HederaCompanion to: CAPTABLE-SPEC.md (system spec). This document covers the web application only.Mandate: the entire system must be operable from the frontend. All 24 on-chain write paths in the system spec have a UI surface; no step requires a terminal.Constraint: three pages, zero tabs. A judge watching a five-minute video sees two of them.

1. Purpose and the surface-area rule

The application is the sole operator interface for issuing a compliant bond, configuring its rules, running a clearing auction, bidding into it, and settling. It is also the artifact a judge opens.

Those two jobs pull in opposite directions, and the resolution is a hard rule: operator setup lives on one page, the venue lives on one page, and the landing page explains why either matters. Every additional page is a place a judge can get lost, and this submission's entire claim rests on one visible moment — a fully compliant, fully funded, KYC-granted bidder being refused because their fill would corrupt the shareholder register. Anything that competes with that moment for attention is a liability, not a feature.

Success condition: a person with a funded Hedera testnet account and no shell access completes issue → configure → create auction → bid → clear → settle → distribute coupon in the browser alone; and a person who opens /auction with no context understands the refusal within fifteen seconds.



2. Roles

Derived from chain state, never a login. The connected address resolves to zero or more roles:

RoleDerivationGainsADMINholds DEFAULT_ADMIN_ROLE on the bond Diamondcompliance rules, control list, role grants, oracleISSUERpresent on the bond's SSI issuer listKYC grant/revoke, coupon schedulingSELLERequals the auction's tokensRecipientauction creation, reserve funding, sweepsINVESTORany connected addressbidding, exiting, settling own bidsOBSERVERnot connectedall read-only surfaces/console is visible to everyone but every action is disabled with a stated reason for those who lack the role. Hiding it would make the system look smaller than it is; disabling it demonstrates that the permissions are real.

3. Page map, sections, and elements

Three routes. / and /auction are the judge-facing pair; /console is the operator surface.



P0 — / Landing (public, mandatory)

Single scroll, five sections.



Hero. One-line thesis; one-sentence subhead; two buttons — Open the auction, Operator console. No wallet prompt on load.

The problem. Three short blocks: compliance for a security is a property of the whole register, not a per-address flag; pro-rata fills turn one bid into many holders; a permissionless venue has no onboarding step, so the gate must live in the bid path.

How it works. Three numbered steps — bid submitted → register projected → accepted or refused — each with its one-line mechanism and the contract function it maps to.

Live strip. Auction phase, clearing price, holders against cap, bids accepted, bids refused. Reads from the indexer; renders labelled placeholders when nothing is deployed, never a spinner or an empty state.

Footer. Repo, HashScan links for bond / auction / router / hook, FEEDBACK.md, network badge, build commit.

P1 — /auction The venue (all roles; the demo page)

One page, no tabs, sections stacked in the order a viewer needs them. The first viewport must contain the register and the bid composer together, because the beat is type a bid → watch the projection → get refused → read why, and all four steps must be visible without scrolling.



Status bar (sticky). Phase chip (PENDING / OPEN / ENDED / CLAIMABLE / SETTLED / NOT_GRADUATED); countdown to the next boundary in blocks and seconds at 2s/block; clearing price in display units with the Q96 value on hover; raised against required with a graduation badge; NAV with band bounds and a staleness flag; a Checkpoint button showing the last checkpointed block.

Register panel (hero, left). Holder count against maxInvestors as a filled meter with N slots remaining stated in words; largest holder bps against maxOwnershipBps; a pending-beneficiaries table — address, current balance, pending amount, projected bps, new-holder flag; and a single sentence stating the projected register if every live bid filled to its worst case.

Bid composer (hero, right). Amount and max-price inputs; the price snaps to the nearest valid tick with the snapped value shown; a live pre-flight panel calling previewValidate on every keystroke, rendering either the projected register delta or the decoded refusal with a plain-English sentence; the submit TxAction, disabled while the pre-flight is red. A Try as another address control switches the beneficial owner for demonstration without reconnecting a wallet.

Refusal ledger (directly beneath the composer — adjacency is deliberate). Every refusal on this auction: beneficiary, price, amount, error name, decoded arguments, human sentence, block, transaction link. Filter by error type. This table is the product.

Book. Tick table — price, demand at tick, cumulative demand, clearing marker; display-units/Q96 toggle.

Bids and settlement. One table, all bids, filterable to mine: id, beneficiary, price, amount, filled, state chip, and the actions legal in that state drawn from lib/bidState.ts — exit, settle, execute hold. Above it: the settlement reserve balance with a warning when it is below outstanding obligations, a Fund reserve action for the seller, and a Settle all claimable batch action. Holds appear inline on their row with lock hash and expiration countdown. A REFUNDED_INELIGIBLE row renders distinctly and states in one sentence what happened and what would have happened without the refund path.

Sweeps (SELLER, post-auction only; hidden until then). Sweep unsold tokens and sweep currency, each a TxAction with the available amount.

P2 — /console Operator console (all roles, actions role-gated)

One page. Six collapsible sections in lifecycle order, each with a completion state in its header so the whole system reads as a checklist. Sections auto-expand to the first incomplete one. This page doubles as the system map — a judge who opens it sees every component and its status at once, which is more legible than four separate consoles.



0 · Deployment and health (always expanded). Bond, compliance module, auction, settlement router, hook, oracle — address, copy, HashScan link, verification status; facet-resolution table showing every ATS selector the app depends on and whether it resolves on the deployed Diamond; indexer lag, head block, RPC endpoint; a Re-scan from block action.

1 · Issue the bond (ISSUER). Bond parameter form (name, symbol, decimals fixed at 2 and read-only, nominal, coupon rate and frequency, maturity with a 30-day minimum); an ISIN builder computing the ISO 6166 check digit live on every keystroke with a validity chip and a Use Apple test vector button that must render US0378331005; the deploy TxAction; then a three-row enablement checklist — grant ROLE_SSI_MANAGER, add issuer to the SSI list, verify grantKyc against a probe address — each row gated in order with its own TxAction and live completion read.

2 · Compliance rules (ADMIN). Current compliance module address and an Attach module action; a rules editor for maxInvestors and maxOwnershipBps showing current-versus-proposed; and a plain-language panel translating the two numbers into the sentences the hook will enforce.

3 · Investors (ISSUER, ADMIN). Roster table — address, KYC status, blocked flag, balance, ownership bps, holder-since block — with per-row grant KYC, revoke KYC, add to control list, remove from control list; a bulk Grant KYC form taking newline-separated addresses; search and status filter. The freeze action is the one used in the demo's refund beat and must be reachable in one click.

4 · Create the auction (SELLER). Five gated steps inside the section, each with its own TxAction and completion read: parameters (currency fixed to native HBAR and read-only with the Permit2 note inline; start/end/claim entered in blocks with live seconds conversion; tick spacing; floor price with a Pull from NAV button; required raised; a supply-schedule builder rendering block → cumulative supply); predict address via getAddress with a copy button and a note that the contract does not yet exist; grant KYC to the predicted address; transfer supply to it; create — with a simulation panel whose success is the precondition for enabling submit.

5 · Operations and corporate actions (ADMIN, ISSUER). Oracle: current NAV, updated-at with staleness, setNav form, aggregator in use. Roles: grant and revoke ROLE_SSI_MANAGER, SSI issuer list with add. Coupon: scheduler form (record date, payment date, rate), scheduled coupons table, per-coupon Distribute action, per-holder entitlement table after distribution.

(Section 3: ~1,010 words.)

4. Technical implementation contract

Written so the frontend plugs into the rest of the system without negotiation. Follow it literally.



4.1 Stack and layout

Next.js 14 App Router, TypeScript strict, wagmi v2 + viem, TanStack Query v5, Tailwind. pnpm workspace member apps/web.



apps/web/

  app/

    page.tsx                  P0 landing

    auction/page.tsx          P1 venue

    console/page.tsx          P2 operator console

  components/

    tx/TxAction.tsx           the only component permitted to send a transaction

    tx/StepGate.tsx           ordered, read-gated step sequences (console §1 and §4)

    tx/SimulationPanel.tsx

    venue/RegisterPanel.tsx

    venue/BidComposer.tsx

    venue/RefusalLedger.tsx

    venue/BidsTable.tsx

    console/Section.tsx       collapsible section with completion state

    data/                     tables, meters, chips, address cells

  hooks/                      useRole, useDeployment, usePhase, useAuction, useRegister, usePreflight

  lib/

    units.ts                  branded numeric types and conversions

    errors.ts                 selector → decoder → sentence

    bidState.ts               the state machine

    queryKeys.ts              enumerated cache keys

    flags.ts                  feature flags

packages/

  contracts/                  GENERATED wagmi bindings — never hand-edited

  api-client/                 GENERATED indexer client — never hand-edited

Because there are three routes, page-level code must stay thin: a route file composes sections and owns no business logic. All chain interaction lives in hooks/, all formatting in lib/units.ts.



4.2 Contract bindings are generated, not written

packages/contracts is produced by @wagmi/cli with the foundry plugin pointed at the Foundry out/ directory, emitting typed ABIs and hooks. No hand-written ABI fragment or function selector may exist in apps/web — this is an acceptance criterion, not a preference. A contract change propagates by re-running codegen; if the app stops compiling afterwards, that is the intended signal.

Addresses come from useDeployment(), which fetches GET /api/deployment (the indexer serving deployments/hedera-testnet.json). No address is hardcoded, including the oracle.



4.3 The indexer client is generated

The indexer serves GET /api/openapi.json. packages/api-client is generated with openapi-typescript plus a thin fetch wrapper that throws a typed ApiError carrying { code, message, retryable } from the error envelope, and never coerces numeric strings to number.



4.4 Numbers

All chain and API numerics are bigint or branded strings. lib/units.ts is the single source:



type Q96     = bigint & { readonly __brand: 'Q96' };

type Bps     = number & { readonly __brand: 'Bps' };

type RawBond = bigint & { readonly __brand: 'RawBond' };   // 2 decimals

type Tinybar = bigint & { readonly __brand: 'Tinybar' };   // 18dp on Hedera EVM



toQ96(pricePerBondCents: bigint): Q96

fromQ96(p: Q96): { display: string; cents: bigint }

snapToTick(p: Q96, tickSpacing: Q96): Q96

formatBond(v: RawBond): string

formatHbar(v: Tinybar): string

blocksToSeconds(blocks: number): number      // × 2, HIP-415 cadence

No arithmetic on money outside this module. Number() applied to a monetary value is a lint error. Four conventions collide on one screen — bond decimals 2, HBAR 18, NAV 8, prices Q96 — and that collision is exactly how a demo auction clears at an absurd price.



4.5 TxAction — the only write surface

Every state-changing interaction renders a TxAction. There are no bare writeContract calls anywhere.



interface TxActionProps {

  label: string;

  pendingLabel?: string;

  simulate: () => Promise<SimulateResult>;   // viem simulateContract

  write: () => Promise<Hash>;

  confirmations?: number;                     // default 1

  invalidates?: QueryKey[];                   // refetched on receipt

  disabledReason?: string;                    // rendered instead of enabling

  onSuccess?: (receipt: TransactionReceipt) => void;

  destructive?: boolean;

}

Fixed internal lifecycle: idle → simulating → ready | blocked → signing → pending → success | reverted. In blocked it renders the decoded revert from §4.6. In success it renders the HashScan link and invalidates invalidates. In reverted it renders the decoded reason and offers retry. Optimistic UI is forbidden — the register must never show a state the chain has not confirmed, because on this page the register is the claim.



4.6 Error decoding

lib/errors.ts exports a registry keyed by 4-byte selector, generated from the contract ABIs and extended with a message function:



interface AppError { name: string; args: Record<string, unknown>; sentence: string; hint?: string }

const ERROR_REGISTRY: Record<Hex, (args: readonly unknown[]) => AppError>;

function decodeAppError(err: unknown): AppError | UnknownError;

Every custom error in system spec §5.2 and §5.3 needs an entry with a plain sentence — WouldExceedMaxInvestors renders "Filling this bid would make {projected} holders of record against a {max}-investor limit." An unrecognised selector renders the raw selector with a copy button, never a blank failure.



4.7 Reads, caching, freshness

All reads go through TanStack Query. Chain reads use refetchInterval: 2000 (one block); indexer reads 4000. Keys are namespaced (['auction', address, 'book']) and enumerated in lib/queryKeys.ts so TxAction.invalidates references constants.

Mandatory exception: the bid pre-flight calls previewValidate directly against the chain with staleTime: 0. It must never read the indexer — a bid's validity cannot depend on index freshness.



4.8 Role resolution

function useRole(): { isAdmin: boolean; isIssuer: boolean; isSeller: boolean; isConnected: boolean; roles: Role[]; loading: boolean }

Resolved from hasRole(DEFAULT_ADMIN_ROLE, addr), SSI issuer-list membership, and equality with the auction's tokensRecipient. Cached 30 seconds, invalidated on any role-granting transaction. Console sections read this to set disabledReason; they never hide.



4.9 Bid state machine

lib/bidState.ts mirrors system spec §4.2 exactly and is the only place mapping state to permitted actions:



const BID_STATES = {

  0: { name: 'NONE',                actions: [] },

  1: { name: 'PLACED',              actions: ['exit'] },

  2: { name: 'EXITED',              actions: [] },

  3: { name: 'CLAIMABLE',           actions: ['settle'] },

  4: { name: 'HELD',                actions: ['executeHold'] },

  5: { name: 'SETTLED',             actions: [] },

  6: { name: 'HOLD_EXPIRED',        actions: ['settle'] },

  7: { name: 'REFUNDED_INELIGIBLE', actions: [] },

} as const;

BidsTable renders action buttons from this table. No component decides independently whether an action is legal.



4.10 Console section contract

interface ConsoleSectionProps {

  index: number;

  title: string;

  requiredRole: Role | null;

  isComplete: () => Promise<boolean>;   // live chain read, not local state

  children: ReactNode;

}

Completion is always a chain read, never remembered client-side, so a reload or a different browser shows the true system state. The console auto-expands the lowest-index incomplete section on mount.



4.11 Feature flags

Public env flags mirror the system spec's cut order, so a feature is removed by configuration rather than code deletion: NEXT_PUBLIC_FEATURE_COUPON, NEXT_PUBLIC_FEATURE_NAV_BAND, NEXT_PUBLIC_FEATURE_HISTORY, NEXT_PUBLIC_FEATURE_WRITE_PATHS. With WRITE_PATHS=false the app renders read-only — the emergency fallback if wallet integration fails on demo day.



4.12 Endpoints the frontend requires

Already in system spec §5.7: /auction/:address, /auction/:address/book, /bond/:address/register, /auction/:address/rejections, /bid/:bidId, /health. This PRD adds four the backend must implement:



GET /api/deployment → all contract addresses, build ids, verification status

GET /api/roles/:address → resolved role set, for rendering before chain reads land

GET /api/bond/:address/investors → roster with KYC status, blocked flag, balance, bps

GET /api/bond/:address/coupons → scheduled coupons and per-holder entitlements

4.13 Network handling

Hedera testnet, chain id 296, https://testnet.hashio.io/api, with NEXT_PUBLIC_RPC_FALLBACK. A wrong-chain banner blocks all writes and offers a switch. Relay 429/502 surfaces as a network busy, retrying toast with backoff, never a silent failure. Every transaction hash renders before the receipt arrives, so a dropped receipt never loses the transaction.

5. Acceptance criteria

Full operability — all 24 write paths reachable from three pages:

Console §1: [ ] deployBond · [ ] grantRole(ROLE_SSI_MANAGER) · [ ] addIssuer

Console §2: [ ] setCompliance · [ ] compliance rules update

Console §3: [ ] grantKyc · [ ] revokeKyc · [ ] addToControlList · [ ] remove from control list · [ ] bulk grant

Console §4: [ ] getAddress (read, displayed) · [ ] grantKyc(predicted) · [ ] transfer(predicted, supply) · [ ] factory.create

Console §5: [ ] setNav · [ ] setCoupon · [ ] coupon distribution · [ ] role revoke

Auction: [ ] placeBid · [ ] exitBid · [ ] settle · [ ] executeHold · [ ] fundReserve · [ ] checkpoint · [ ] sweepUnsoldTokens · [ ] sweepCurrency

Behavioural:



[ ] Exactly three routes exist. Adding a fourth requires deleting one.

[ ] On /auction at 1440×900, the register panel, the bid composer, its pre-flight result, and the first refusal row are all visible without scrolling.

[ ] A user with no shell completes issue → configure → create → bid → clear → settle → coupon in the browser alone.

[ ] The ISIN builder renders US0378331005 for the Apple test vector, live, before any transaction.

[ ] The bid pre-flight shows a refusal reason before submission, and previewValidate and validate never disagree in the UI.

[ ] Console §4 step 5's submit stays disabled until the create simulation succeeds.

[ ] The register panel updates within three blocks of an accepted bid.

[ ] A REFUNDED_INELIGIBLE row explains what happened and what would have happened without the refund path.

[ ] Every failed transaction shows a decoded, human-readable reason.

[ ] The landing page renders correctly with no auction deployed and no wallet connected.

[ ] No hardcoded contract address, ABI fragment, or selector exists in apps/web.

6. Out of scope

Tabs anywhere. Mobile-optimised layouts. Internationalisation. Account abstraction or embedded wallets. Historical charting beyond the current auction. Multi-auction management — the app assumes one live auction, and multi-auction support is the first thing a fourth page would be for, which is why it is excluded. Server-side rendering of authenticated views. Any write path not enumerated in §5.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ad23f81c-19a1-4b00-b0dd-c8464be05c26).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
