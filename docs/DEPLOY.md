# CloudTill production deploy (Docker + Postgres)

## Quick path (Compose)

From the repo root:

```bash
docker compose up --build -d
curl http://localhost:4000/api/health
```

Compose starts:

| Service | Port | Notes |
| --- | --- | --- |
| `db` | 5432 | Postgres 16 (`cloudtill` / `cloudtill` / db `cloudtill`) |
| `api` | 4000 | Prisma `db push` + seed + Express API |

Demo logins after seed: `owner@cloudtill.demo` / `1234`, etc.

### Point web apps at the API

Local Vite apps already proxy `/api` → `4000`. For a remote API, either:

- keep the Vite proxy and tunnel, or
- set a reverse proxy (Caddy/Nginx) so POS / back office / ordering are served as static builds with `/api` forwarded to the API container.

Example static build:

```bash
pnpm --filter @cloudtill/shared build
pnpm --filter @cloudtill/pos build
pnpm --filter @cloudtill/backoffice build
pnpm --filter @cloudtill/ordering build
```

Serve `apps/*/dist` behind Nginx with `/api` → `http://api:4000`.

## Postgres without Docker

1. Create a database and user.
2. Set API env:

```bash
cp apps/api/.env.example apps/api/.env
# DATABASE_URL="postgresql://USER:PASS@HOST:5432/cloudtill?schema=public"
# JWT_SECRET="long-random-secret"
```

3. Switch Prisma provider if needed (schema already works with Postgres when `DATABASE_URL` is Postgres — ensure `provider = "postgresql"` in `apps/api/prisma/schema.prisma` for production).

For this repo’s dual-mode demo, the default schema provider is **SQLite**. For Compose we recommend changing the provider to `postgresql` before `docker compose up`, or maintaining a `schema.postgres.prisma` copy. The included `Dockerfile` runs `prisma db push` against whatever `DATABASE_URL` is set; **set `provider = "postgresql"`** in `schema.prisma` when using the Compose Postgres service.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Then:

```bash
pnpm --filter @cloudtill/api exec prisma db push
pnpm db:seed
pnpm --filter @cloudtill/api start   # after build
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite `file:./dev.db` or Postgres URL |
| `JWT_SECRET` | Sign employee PIN sessions |
| `PORT` / `HOST` | API bind (default `4000` / `0.0.0.0`) |

## Printers in production

Configure printers in Back Office → **Printers**:

- **mock** — logs ESC/POS bytes (CI/demo)
- **network** — raw TCP to thermal printer host:9100
- **usb_bridge** — queues payload for a host agent

Kitchen online orders enqueue a `kitchen` print job automatically.
