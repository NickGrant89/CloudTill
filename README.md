# CloudTill

Loyverse-parity **cloud POS** — hosted multi-tenant SaaS by default (central API, back office, billing, and catalog), with **offline-capable POS tills** that queue sales locally and sync when back online. Not a boxed standalone install.

Web-first typed monorepo: tablet register, desktop back office, customer online ordering, Expo mobile register, printer drivers, Express + Prisma API. SQLite by default for pilots; Postgres via Docker Compose for hosted shape.

## Packaging model

| Piece | Role |
| --- | --- |
| Cloud API + BO | Source of truth for catalog, customers, inventory, billing/plans, reports |
| POS tills | Browser/tablet clients; cache catalog; queue open tickets & completed sales offline; sync to cloud |
| Ordering | Customer web ordering against the same cloud store |
| Billing | Starter / Pro / Multi-store monthly £ · trial stub · feature gates |

Conflict rules: **server wins catalog** on refresh; **client queues sales** until the cloud acks (`/api/pos/offline-sales`, idempotent `clientSaleId`).

Pilot walkthrough: [docs/PILOT.md](docs/PILOT.md) · Pricing: http://localhost:4000/pricing

## Quick start

```bash
pnpm setup   # install, .env, prisma db push, seed
pnpm dev     # API + POS + back office + online ordering
```

| App | URL / command |
| --- | --- |
| API health | http://localhost:4000/api/health |
| Pricing / trial stub | http://localhost:4000/pricing |
| POS till (offline-capable) | http://localhost:5173 |
| Back office (cloud control) | http://localhost:5174 |
| Online ordering | http://localhost:5175 |
| Mobile (Expo) | `cd apps/mobile && npm install && npx expo start` |
| Docker (API + Postgres) | `docker compose up --build` — see [docs/DEPLOY.md](docs/DEPLOY.md) |

## Demo logins

| Role | Email | PIN |
| --- | --- | --- |
| Owner | `owner@cloudtill.demo` | `1234` |
| Manager | `manager@cloudtill.demo` | `2222` |
| Cashier | `cashier@cloudtill.demo` | `1111` |

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
apps/mobile       Expo register checkout (install separately)
packages/shared   Types, plans, ESC/POS builders
docs/PILOT.md     Pilot env checklist + offline/billing smoke
docs/DEPLOY.md    Docker + Postgres (hosted shape)
```

## Loyverse feature map

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
| SaaS billing / plans | Done | Starter/Pro/Multi £ · trial stub · Settings |
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
