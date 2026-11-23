# PurePOS

**PurePOS UK** is the product: **cloud till + back office + online ordering**. Hosted multi-tenant SaaS (central API, catalog, billing) with offline-capable tills that queue sales and sync when back online. Not a WordPress add-on, not a Loyverse bolt-on, not a boxed on-prem install.

- **Brand / domain:** PurePOS · live [Railway host](https://web-production-b2a209a9.up.railway.app) · [purepos.co.uk](https://purepos.co.uk) (DNS cutover from Fasthosts pending)
- **Staging (pilots):** `https://staging.purepos.co.uk` (documented target) · local `localhost` ports below
- **GitHub repo (unchanged for now):** [NickGrant89/CloudTill](https://github.com/NickGrant89/CloudTill)

Web-first typed monorepo: tablet register, desktop back office, customer online ordering, Expo mobile register, printer drivers, Express + Prisma API. SQLite by default for pilots; Postgres via Docker Compose for hosted shape.

## Packaging model

| Piece | Role |
| --- | --- |
| Cloud API + BO | Source of truth for catalog, customers, inventory, billing/plans, reports |
| POS tills | Browser/tablet clients; cache catalog; queue open tickets & completed sales offline; sync to cloud |
| Ordering | Customer web ordering against the same cloud store |
| Billing | Solo / Shop / Group monthly £ · trial + license keys · feature gates |

Conflict rules: **server wins catalog** on refresh; **client queues sales** until the cloud acks (`/api/pos/offline-sales`, idempotent `clientSaleId`).

Pilot walkthrough: [docs/PILOT.md](docs/PILOT.md) · Hosting (Mac + Docker): [docs/DEPLOY.md](docs/DEPLOY.md) · Local pricing: http://localhost:4000/pricing

## Quick start

```bash
pnpm setup   # install, .env, prisma db push, seed
pnpm dev     # API + POS + back office + online ordering
```

| App | Local (dev) | Staging (documented) |
| --- | --- | --- |
| API health | http://localhost:4000/api/health | https://staging.purepos.co.uk/api/health |
| Pricing / trial | http://localhost:4000/pricing | https://staging.purepos.co.uk/pricing |
| POS till | http://localhost:5173 | https://staging.purepos.co.uk/pos |
| Back office | http://localhost:5174 | https://staging.purepos.co.uk/bo |
| Online ordering | http://localhost:5175 | https://staging.purepos.co.uk/order |
| Mobile (Expo) | `cd apps/mobile && npm install && npx expo start` | — |
| Docker gateway (hosted shape) | http://localhost:8080 — `pnpm docker:up` · [docs/DEPLOY.md](docs/DEPLOY.md) | staging paths `/pos` `/bo` `/order` |

Set `PUBLIC_BASE_URL` / `STAGING_BASE_URL` in `apps/api/.env` when pointing tills at staging.

## Demo logins

| Role | Email | PIN |
| --- | --- | --- |
| Owner | `owner@purepos.demo` | `1234` |
| Manager | `manager@purepos.demo` | `2222` |
| Cashier | `cashier@purepos.demo` | `1111` |

- Stores: **demo-cafe** (slug), downtown stub  
- Gift cards: `GC-DEMO50`, `GC-PARTIAL`  
- Online order sample: `OL-1001`  
- Favorites / quick keys: Latte, Croissant, Breakfast Combo  

## Monorepo layout

```
apps/api          Cloud API (Prisma) + public pricing + billing stub
apps/pos          Offline-capable till (IndexedDB queue + sync badge)
apps/backoffice   Central BO (catalog, billing, import, pilot tools)
apps/ordering     Customer-facing online order UI
apps/marketing    PurePOS UK marketing site (static · :5180)
apps/mobile       Expo register checkout (install separately)
packages/shared   Types, plans, ESC/POS builders
docs/PILOT.md     Pilot env checklist + offline/billing smoke
docs/DEPLOY.md    Docker + Postgres (hosted shape)
```

## Feature map

| Area | Status | Notes |
| --- | --- | --- |
| POS grid, categories, barcode/SKU | Done | |
| Tickets, hold/recall, open tickets board | Done | POS **Tickets** board |
| Discounts, tax, tip suggestions | Done | Presets + round-up API |
| Customers, loyalty, store credit | Done | |
| Cash / card / other / gift card / split | Done | |
| Drawer + receipt print (HTML/ESC/POS/drivers) | Done | Mock · network · USB bridge |
| Shifts / cash mgmt | Done | |
| Catalog, modifiers CRUD, kits | Done | Cloud source of truth |
| Inventory, transfers, stocktake | Done | Transfers gated to Multi-store |
| CSV import (items / customers / stock) | Done | BO **Import** · Pro+ |
| Offline till sync | Done | IndexedDB queue · server-wins catalog |
| SaaS billing / plans | Done | Solo/Shop/Group £ · trial + licenses · Settings |
| Low-stock toast (BO) | Done | In-app push stub |
| Customers / gift cards / employees / PIN | Done | |
| Time clock | Done | |
| Sales void/refund/reprint | Done | |
| Reports + EOD CSV / email stub | Done | |
| Settings + pilot reset/health | Done | |
| Online ordering → kitchen tickets | Done | Ordering app + kitchen queue |
| Expo mobile register checkout | Done | Grid, pay, kitchen, print job |
| Barcode label helper | Done | BO Labels |
| Quick keys / favorites | Done | POS ★ Quick keys |
| Docker + Postgres | Done | Compose + DEPLOY.md |

### Still lighter / future polish

- Real Stripe / SMTP for production billing & EOD email
- Live USB printer host agent binary
- Stronger multi-tenant isolation beyond single-demo store pilots

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm setup` | Install + DB + seed |
| `pnpm dev` | API + POS + BO + ordering |
| `pnpm docker:up` | Compose API + Postgres |
| `pnpm db:seed` / `pnpm db:reset` | Reseed / wipe+seed demo |

## License

Private demo / portfolio project unless otherwise noted.
