# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

FROM oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS release

WORKDIR /app
RUN apk upgrade --no-cache
ENV NODE_ENV=production
ENV PORT=4173

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json bun.lock server.ts ./
COPY server ./server
COPY shared ./shared
COPY packages ./packages
COPY src ./src

USER bun
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const response = await fetch('http://127.0.0.1:4173/health'); process.exit(response.ok ? 0 : 1)"]

CMD ["bun", "run", "server.ts"]
