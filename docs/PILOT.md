# PurePOS pilot guide

**Brand:** PurePOS UK · domain **purepos.co.uk** (production hosting suspended — use local or staging).  
**Repo folder / GitHub:** still `CloudTill` / `NickGrant89/CloudTill` for now.

**Packaging:** PurePOS is a **cloud-controlled SaaS** — central API, back office, billing, and catalog — with **offline-capable POS tills** that sync. Default deployment shape is **hosted multi-tenant**, not a boxed standalone server per shop.

## Quick start (this Mac)

```bash
cd ~/Projects/CloudTill
pnpm run setup          # once
pnpm dev                # API :4000 · POS :5173 · BO :5174 · Ordering :5175
```

Or use the existing `cloudtill-dev` tmux session.

| Surface | Local | Staging (documented) |
| --- | --- | --- |
| API health | http://localhost:4000/api/health | https://staging.purepos.co.uk/api/health |
| Pricing / trial | http://localhost:4000/pricing | https://staging.purepos.co.uk/pricing |
| POS till | http://localhost:5173 | https://staging.purepos.co.uk/pos |
| Back office | http://localhost:5174 | https://staging.purepos.co.uk/bo |
| Online ordering | http://localhost:5175 | https://staging.purepos.co.uk/order |

Demo PINs: owner `1234` · manager `2222` · cashier `1111`  
Emails: `owner@purepos.demo`, etc.

## Env checklist

Copy `apps/api/.env.example` → `apps/api/.env`:

| Variable | Pilot value | Hosted note |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | Use Postgres in Compose / prod |
| `JWT_SECRET` | change before shared deploy | Per-environment secret |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | Behind reverse proxy |
| `PUBLIC_BASE_URL` | `http://localhost:4000` | Local API origin |
| `STAGING_BASE_URL` | `https://staging.purepos.co.uk` | Documented staging host |

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
