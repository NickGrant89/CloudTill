# CloudTill

Loyverse-parity **cloud POS** — web-first typed monorepo with a tablet-friendly register, desktop back office, Expo mobile scaffold, and Express + Prisma API. SQLite by default (Postgres-ready via `DATABASE_URL`).

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

| App | URL / command |
| --- | --- |
| API | http://localhost:4000/api/health |
| POS register | http://localhost:5173 |
| Back office | http://localhost:5174 |
| Mobile (Expo) | `pnpm --filter @cloudtill/mobile start` — see `apps/mobile/README.md` |

## Demo logins

| Role | Email | PIN |
| --- | --- | --- |
| Owner | `owner@cloudtill.demo` | `1234` |
| Manager | `manager@cloudtill.demo` | `2222` |
| Cashier | `cashier@cloudtill.demo` | `1111` |

Seed store: **CloudTill Demo Café** (plus **CloudTill Downtown** for multi-store inventory / transfers).

- Barcodes: `1001001001` (Latte), `3003003001` (Croissant)
- Gift cards: `GC-DEMO50` ($50), `GC-PARTIAL` ($18.00 remaining)

## Monorepo layout

```
apps/api          Express + Prisma API (SQLite / Postgres)
apps/pos          Vite React tablet POS
apps/backoffice   Vite React desktop back office
apps/mobile       Expo / React Native scaffold (shared API + @cloudtill/shared)
packages/shared   Shared TypeScript types + ESC/POS receipt builders
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
| Gift card tender | Done | Ledger + POS redeem (`gift_card` type) |
| Cash drawer | Done | Auto on cash + manual open + ESC/POS kick bytes |
| Receipts (HTML + ESC/POS) | Done | `/sales/:id/receipt` text/html/escpos; POS + BO print |
| Shifts / pay in-out / close | Done | Expected vs counted cash |
| Catalog (items, variants, categories, modifiers, kits, SKU/barcode, stock toggle) | Done | Kit: Breakfast Combo |
| Modifier CRUD (back office) | Done | Groups + options per item |
| Inventory (levels, receive, low stock, history) | Done | Multi-store levels |
| Store-to-store transfers | Done | Inventory → Transfer form + history |
| Customers (history, loyalty, credit) | Done | |
| Gift card ledger | Done | Issue / reload / redeem / adjust |
| Employees (roles, PIN) | Done | owner / manager / cashier |
| Time clock | Done | Clock in/out + timesheet (BO + POS + mobile) |
| Stores & registers | Done | Multi-store |
| Sales history (void / refund / reprint) | Done | HTML + ESC/POS download |
| Reports (sales, item, category, employee, payments, taxes, shifts) | Done | Last-7-days default |
| Settings (taxes, payment types, receipt, currency) | Done | Includes gift card payment type |
| Mobile wrap path | Done | Expo scaffold: login, catalog, clock, gift lookup |

### Still deferred / next

- Online ordering / e‑commerce sync
- Full native register checkout UI inside Expo (web POS remains primary register)
- Physical printer SDK wiring (we emit ESC/POS bytes + drawer kick for bridges)
- Postgres production deploy guide / Docker Compose

## Receipt / ESC/POS pipeline

```bash
# After login, with Bearer token:
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/sales/<saleId>/receipt?format=html"
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/sales/<saleId>/receipt?format=escpos-base64"
```

Shared builders live in `@cloudtill/shared` (`buildReceiptText`, `buildReceiptHtml`, `buildEscPosBytes`).

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm setup` | Install, `.env`, db push, seed |
| `pnpm dev` | API + POS + back office |
| `pnpm dev:mobile` | Expo start |
| `pnpm db:seed` | Reset demo data |
| `pnpm db:reset` | Recreate SQLite DB + seed |
| `pnpm build` | Build packages (shared + apps that support build) |

## Stack

- TypeScript monorepo (pnpm workspaces)
- API: Express, Zod, JWT PIN auth, Prisma
- DB: SQLite (`file:./dev.db`) — set `DATABASE_URL` to Postgres for production
- UI: React 19 + Vite (POS / BO); Expo RN scaffold (mobile)
- Typography: DM Sans / Fraunces (web)

## License

Private demo / portfolio project unless otherwise noted.
