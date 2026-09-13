# Cap Table indexer + REST API.
# `COPY deployments/` is load-bearing: /api/deployment reads
# deployments/hedera-testnet.json and the directory is gitignored, so a container
# built from a clean clone will not contain it. The file must be committed (A12)
# before the first Railway build.
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
