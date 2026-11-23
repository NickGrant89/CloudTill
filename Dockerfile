# PurePOS all-in-one web app (API + static till/BO/ordering/marketing) for PaaS hosting
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/pos/package.json apps/pos/
COPY apps/backoffice/package.json apps/backoffice/
COPY apps/ordering/package.json apps/ordering/
COPY apps/marketing/package.json apps/marketing/
RUN pnpm install --filter @cloudtill/shared --filter @cloudtill/api --filter @cloudtill/pos --filter @cloudtill/backoffice --filter @cloudtill/ordering --filter @cloudtill/marketing --frozen-lockfile=false

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/pos apps/pos
COPY apps/backoffice apps/backoffice
COPY apps/ordering apps/ordering
COPY apps/marketing apps/marketing

RUN pnpm --filter @cloudtill/shared build \
  && VITE_BASE=/pos/ pnpm --filter @cloudtill/pos build \
  && VITE_BASE=/bo/ pnpm --filter @cloudtill/backoffice build \
  && VITE_BASE=/order/ pnpm --filter @cloudtill/ordering build \
  && mkdir -p apps/api/web/pos apps/api/web/bo apps/api/web/order apps/api/web/marketing \
  && cp -R apps/pos/dist/. apps/api/web/pos/ \
  && cp -R apps/backoffice/dist/. apps/api/web/bo/ \
  && cp -R apps/ordering/dist/. apps/api/web/order/ \
  && cp apps/marketing/index.html apps/api/web/marketing/ \
  && cp -R apps/marketing/assets apps/api/web/marketing/ \
  && sed -i 's/provider = "sqlite"/provider = "postgresql"/' apps/api/prisma/schema.prisma \
  && cd apps/api && pnpm exec prisma generate

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/apps/api /app/apps/api
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
WORKDIR /app/apps/api
ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080
# --accept-data-loss: a non-interactive push stops on Prisma's warning when a new
# unique column is added, even when every existing row is null. No rows are deleted.
CMD ["sh", "-c", "pnpm exec prisma db push --accept-data-loss && (pnpm exec tsx prisma/seed.ts || echo 'seed failed — continuing') && pnpm exec tsx src/index.ts"]
