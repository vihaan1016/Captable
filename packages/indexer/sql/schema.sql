-- Cap Table indexer schema (§4.4).
-- All monetary values are NUMERIC(78,0); ratios are NUMERIC(20,6). No floats.

CREATE TABLE IF NOT EXISTS auctions (
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

CREATE TABLE IF NOT EXISTS bids (
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
CREATE INDEX IF NOT EXISTS bids_auction_price ON bids (auction_address, max_price_q96 DESC);
CREATE INDEX IF NOT EXISTS bids_beneficiary ON bids (beneficiary);

CREATE TABLE IF NOT EXISTS rejections (
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

CREATE TABLE IF NOT EXISTS checkpoints (
  auction_address    TEXT NOT NULL,
  block_number       BIGINT NOT NULL,
  clearing_price_q96 NUMERIC(78,0) NOT NULL,
  supply_released    NUMERIC(78,0) NOT NULL,
  currency_raised    NUMERIC(78,0) NOT NULL,
  PRIMARY KEY (auction_address, block_number)
);

CREATE TABLE IF NOT EXISTS holders (
  bond_address       TEXT NOT NULL,
  holder             TEXT NOT NULL,
  balance            NUMERIC(78,0) NOT NULL,
  kyc_status         SMALLINT NOT NULL,
  blocked            BOOLEAN NOT NULL DEFAULT FALSE,
  updated_block      BIGINT NOT NULL,
  PRIMARY KEY (bond_address, holder)
);

CREATE TABLE IF NOT EXISTS register_snapshots (
  bond_address       TEXT NOT NULL,
  block_number       BIGINT NOT NULL,
  holder_count       INT NOT NULL,
  max_investors      INT NOT NULL,
  largest_bps        INT NOT NULL,
  max_ownership_bps  INT NOT NULL,
  PRIMARY KEY (bond_address, block_number)
);

CREATE TABLE IF NOT EXISTS indexer_state (
  key                TEXT PRIMARY KEY,
  value              TEXT NOT NULL
);
