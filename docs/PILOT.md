# CloudTill pilot guide

**Packaging:** CloudTill is a **cloud-controlled SaaS** — central API, back office, billing, and catalog — with **offline-capable POS tills** that sync. Default deployment shape is **hosted multi-tenant**, not a boxed standalone server per shop.

## Quick start (this Mac)

```bash
cd ~/Projects/CloudTill
pnpm run setup          # once
pnpm dev                # API :4000 · POS :5173 · BO :5174 · Ordering :5175
```

Or use the existing `cloudtill-dev` tmux session.

| Surface | URL | Role |
| --- | --- | --- |
| Cloud API health | http://localhost:4000/api/health | Control plane |
| Pricing / trial | http://localhost:4000/pricing | Public SaaS tiers |
| POS till | http://localhost:5173 | Offline-capable client |
| Back office | http://localhost:5174 | Cloud catalog + billing |
| Online ordering | http://localhost:5175 | Customer web |

Demo PINs: owner `1234` · manager `2222` · cashier `1111`  
Emails: `owner@cloudtill.demo`, etc.

## Env checklist

Copy `apps/api/.env.example` → `apps/api/.env`:

| Variable | Pilot value | Hosted note |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | Use Postgres in Compose / prod |
| `JWT_SECRET` | change before shared deploy | Per-environment secret |
| `PORT` | `4000` | Behind reverse proxy |
| `HOST` | `0.0.0.0` | Bind for LAN tills |

`GET /api/health` reports `ok`, DB status, store count, and whether `JWT_SECRET` is set.

## Demo reset

- CLI: `pnpm db:reset` (wipe SQLite + seed)
- BO: **Settings → Pilot tools → Demo reset** (owner) → `POST /api/extras/demo-reset`

Reseed includes Pro trial billing settings on the demo store.

## Offline till ↔ cloud sync

Tills are thin clients of the cloud catalog:

1. Open POS **while online** once — catalog/payment types/settings cache into IndexedDB.
2. Go offline (DevTools → Offline, or unplug).
3. Badge shows **Offline**; sell from cached catalog; open tickets stay local; completed sales enter the local queue.
4. Back online → badge **Sync N** / auto-sync every ~20s; sales POST to `/api/pos/offline-sales`.
5. **Conflicts:** server wins catalog on refresh; client-queued sales are idempotent on `clientSaleId` (`note: offline:<id>`).

## Billing / tiers (stub)

| Plan | £/mo | Cloud features |
| --- | --- | --- |
| Starter | 29 | 1 store till · offline sync · BO |
| Pro | 59 | + ordering, kitchen, CSV import, reports |
| Multi-store | 99 | + transfers between stores |

- Public page: http://localhost:4000/pricing (trial stub applies plan to demo store)
- BO **Settings → Billing** to switch plan
- Gates: CSV import → Pro+; inventory transfers → Multi-store

## Smoke checklist

- [ ] `/api/health` → `ok: true`
- [ ] POS PIN `1111`, add Latte, charge £
- [ ] Offline badge; queue a sale offline; sync online
- [ ] BO Import preview (Pro plan)
- [ ] Pricing page + trial stub
- [ ] Settings billing plan switch
- [ ] Demo reset + re-login
