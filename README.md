# CloudTill

Loyverse-parity **cloud POS** — web-first typed monorepo with a tablet-friendly register, desktop back office, and Express + Prisma API. SQLite by default (Postgres-ready via `DATABASE_URL`).

## Quick start

```bash
pnpm setup   # install, .env, prisma db push, seed
# or step-by-step:
pnpm install
pnpm --filter @cloudtill/shared build
cp -n apps/api/.env.example apps/api/.env
pnpm --filter @cloudtill/api exec prisma db push
pnpm db:seed
pnpm dev
```

| App | URL |
| --- | --- |
| API | http://localhost:4000/api/health |
| POS register | http://localhost:5173 |
| Back office | http://localhost:5174 |

## Demo logins

| Role | Email | PIN |
| --- | --- | --- |
| Owner | `owner@cloudtill.demo` | `1234` |
| Manager | `manager@cloudtill.demo` | `2222` |
| Cashier | `cashier@cloudtill.demo` | `1111` |

Seed store: **CloudTill Demo Café** (plus a second downtown store stub for multi-store inventory).

Barcode examples: `1001001001` (Latte), `3003003001` (Croissant).

## Monorepo layout

```
apps/api          Express + Prisma API (SQLite / Postgres)
apps/pos          Vite React tablet POS
apps/backoffice   Vite React desktop back office
packages/shared   Shared TypeScript types
```

## Loyverse feature map

| Loyverse area | CloudTill | Notes |
| --- | --- | --- |
| POS item grid + categories | Done | Color tiles, category chips |
| Search / barcode / SKU | Done | Search box + Enter to scan |
| Tickets, hold / recall | Done | Open + held tickets API |
| Discounts (%, $) | Done | Ticket-level |
| Tax | Done | Configurable rate (bps) |
| Tips | Done | Presets + custom |
| Customers on ticket | Done | Loyalty pts + store credit |
| Cash / card / other / split pay | Done | Multi-tender checkout |
| Cash drawer | Done | Auto on cash + manual open |
| Receipts | Done | On-screen + reprint in sales |
| Shifts / pay in-out / close | Done | Expected vs counted cash |
| Catalog (items, variants, categories, modifiers, kits, SKU/barcode, stock toggle) | Done | Kit: Breakfast Combo |
| Inventory (levels, receive, low stock, history) | Done | Multi-store levels stub |
| Customers (history, loyalty, credit) | Done | |
| Employees (roles, PIN) | Done | owner / manager / cashier |
| Stores & registers | Done | Multi-store stub |
| Sales history (void / refund / reprint) | Done | |
| Reports (sales, item, category, employee, payments, taxes, shifts) | Done | Last-7-days default |
| Settings (taxes, payment types, receipt, currency) | Done | |

### Deferred / roadmap (mobile & depth)

- **Native mobile apps** via Expo/React Native wrapping the same API (web-first preference)
- Hardware: real cash drawer ESC/POS, receipt printers, barcode scanners (HID works today)
- Online ordering / e‑commerce sync
- Advanced inventory transfers between stores (levels stubbed today)
- Employee time clock & timesheets
- Gift cards as first-class ledger (store credit covers the common case)
- Full modifier editing UI in back office (API + seed modifiers present; POS selection works)
- Postgres production deploy guide / Docker Compose

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | API + POS + back office |
| `pnpm db:seed` | Reset demo data |
| `pnpm db:reset` | Recreate SQLite DB + seed |
| `pnpm build` | Build all packages |

## Stack

- TypeScript monorepo (pnpm workspaces)
- API: Express, Zod, JWT PIN auth, Prisma
- DB: SQLite (`file:./dev.db`) — set `DATABASE_URL` to Postgres for production
- UI: React 19 + Vite, DM Sans / Fraunces

## License

Private demo / portfolio project unless otherwise noted.
