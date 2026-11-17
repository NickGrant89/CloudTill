# PurePOS hosting

Two ways to run — both stay supported:

| Mode | Command | DB | Entry |
| --- | --- | --- | --- |
| **Mac day-to-day** | `pnpm setup` then `pnpm dev` | SQLite | `:4000` API · `:5173` till · `:5174` BO · `:5175` ordering |
| **Hosted-shaped (Docker)** | `pnpm docker:up` | Postgres | **http://localhost:8080** (`/pos` `/bo` `/order` `/pricing` `/api`) |

Same product. Mac keeps fast Vite + SQLite. Docker is what you push toward staging / purepos.co.uk.

## Mac (keep this)

```bash
cd ~/Projects/CloudTill
pnpm setup          # once
pnpm dev            # or tmux session cloudtill-dev
```

| Surface | URL |
| --- | --- |
| API / pricing | http://localhost:4000 · http://localhost:4000/pricing |
| Till | http://localhost:5173 |
| Back office | http://localhost:5174 |
| Ordering | http://localhost:5175 |
| Marketing | `pnpm dev:marketing` → http://localhost:5180 |

Demo: `owner@purepos.demo` / PIN `1234` · cashier `1111`.

Share off-Mac: tunnel the Vite ports (ngrok) while `pnpm dev` is up.

## Docker gateway (hosted shape on this Mac)

Requires **Docker Desktop running**.

```bash
cd ~/Projects/CloudTill
pnpm docker:up          # build + start db + api + nginx gateway
curl -s http://localhost:8080/api/health
open http://localhost:8080/pos/
```

| Path | App |
| --- | --- |
| `/` | Marketing |
| `/pos/` | Till (static build) |
| `/bo/` | Back office |
| `/order/` | Online ordering |
| `/pricing` | Trial / plans |
| `/api/*` | Cloud API |

Stop: `pnpm docker:down`

Env overrides: copy `.env.docker.example` → `.env` next to compose (optional). Defaults are fine for a local hosted pilot.

### Point a real domain later

1. Run the same Compose stack on a VPS (or managed Postgres + containers).
2. Put TLS in front (Caddy / Cloudflare) for `staging.purepos.co.uk` then `purepos.co.uk`.
3. Set `PUBLIC_BASE_URL`, `JWT_SECRET`, and strong DB credentials.
4. Prisma provider is flipped to **postgresql** inside the API image; Mac schema stays **sqlite**.

## What Compose starts

| Service | Port | Notes |
| --- | --- | --- |
| `db` | 5432 | Postgres 16 |
| `api` | (internal) | Prisma push + seed + Express — use via gateway `/api` |
| `gateway` | **8080→80** | nginx: static apps + `/api` proxy |

Mac `pnpm dev` and Docker can run **at the same time**: Mac keeps `:4000`/`:517x`; Docker is only **`:8080`** on the host (Postgres + API stay inside the Compose network).

## Build notes

Frontends are built with `VITE_BASE=/pos/` (etc.) so asset URLs work under path prefixes. Mac `pnpm dev` keeps `base: /`.

## Printers in production

Configure in Back Office → **Printers**: mock · network (:9100) · usb_bridge.
