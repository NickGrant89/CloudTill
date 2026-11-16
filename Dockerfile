# CloudTill API — production-ish image (Postgres via DATABASE_URL)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @cloudtill/shared --filter @cloudtill/api --frozen-lockfile=false

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @cloudtill/shared build \
  && cd apps/api \
  && pnpm exec prisma generate \
  && pnpm exec tsc || true

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/packages /app/packages
COPY --from=deps /app/apps/api /app/apps/api
COPY --from=build /app/packages/shared/dist /app/packages/shared/dist
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/prisma apps/api/prisma
COPY apps/api/src apps/api/src
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
WORKDIR /app/apps/api
# Compose uses Postgres — flip Prisma provider at runtime
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
EXPOSE 4000
CMD ["sh", "-c", "pnpm exec prisma generate && pnpm exec prisma db push && pnpm exec tsx prisma/seed.ts && pnpm exec tsx src/index.ts"]
