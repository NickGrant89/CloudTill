# CloudTill

Loyverse-parity **cloud POS** — web-first typed monorepo with tablet register, desktop back office, customer online ordering, Expo mobile register, printer drivers, and Express + Prisma API. SQLite by default; Postgres via Docker Compose.

## Quick start

```bash
pnpm setup   # install, .env, prisma db push, seed
pnpm dev     # API + POS + back office + online ordering
```

| App | URL / command |
| --- | --- |
| API | http://localhost:4000/api/health |
| POS register | http://localhost:5173 |
| Back office | http://localhost:5174 |
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
apps/api          Express + Prisma API
apps/pos          Tablet POS (+ tickets board, kitchen, quick keys)
apps/backoffice   Desktop back office
apps/ordering     Customer-facing online order UI
apps/mobile       Expo register checkout (install separately)
packages/shared   Types + ESC/POS receipt builders
docs/DEPLOY.md    Docker + Postgres guide
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
| Catalog, modifiers CRUD, kits | Done | |
| Inventory, transfers, stocktake | Done | |
| CSV import (items / customers / stock) | Done | BO **Import** · templates + preview |
| Low-stock toast (BO) | Done | In-app push stub |
| Customers / gift cards / employees / PIN | Done | |
| Time clock | Done | |
| Sales void/refund/reprint | Done | |
| Reports + EOD CSV / email stub | Done | |
| Settings | Done | |
| Online ordering → kitchen tickets | Done | Ordering app + kitchen queue |
| Expo mobile register checkout | Done | Grid, pay, kitchen, print job |
| Barcode label helper | Done | BO Labels |
| Quick keys / favorites | Done | POS ★ Quick keys |
| Docker + Postgres | Done | Compose + DEPLOY.md |

### Still lighter / future polish

- Real SMTP for EOD email (stub queues payload today)
- Live USB printer host agent binary
- Deeper Expo offline cache

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm setup` | Install + DB + seed |
| `pnpm dev` | API + POS + BO + ordering |
| `pnpm docker:up` | Compose API + Postgres |
| `pnpm db:seed` | Reseed demo |

## License

Private demo / portfolio project unless otherwise noted.
