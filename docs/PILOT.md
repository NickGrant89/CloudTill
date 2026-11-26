# PurePOS pilot guide

**Brand:** PurePOS UK · live Railway host (see `docs/HOSTING-ONLINE.md`) · **purepos.co.uk** DNS cutover from Fasthosts pending.  
**Repo folder / GitHub:** still `CloudTill` / `NickGrant89/CloudTill` for now.

**Product:** PurePOS = **cloud till + back office + online ordering** (this monorepo). Not a WordPress add-on / Loyverse bolt-on.  
**Packaging:** Hosted multi-tenant SaaS — central API, catalog, billing — with **offline-capable tills** that sync.

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
| Platform admin | http://localhost:4000/admin | https://purepos.co.uk/admin |
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
| `PLATFORM_ADMIN_SECRET` | `openssl rand -hex 24` | Unlocks `/admin` platform licensing (not BO) |

`GET /api/health` reports `ok`, DB status, store count, and whether `JWT_SECRET` / `PLATFORM_ADMIN_SECRET` are set.

## Demo reset

- CLI: `pnpm db:reset` (wipe SQLite + seed)
- BO: **Settings → Pilot tools → Demo reset** (owner) → `POST /api/extras/demo-reset`

Reseed includes Venue (`pro`) trial billing settings on the demo store.

## Offline till ↔ cloud sync

Tills are thin clients of the cloud catalog:

1. Open POS **while online** once — catalog/payment types/settings cache into IndexedDB.
2. Go offline (DevTools → Offline, or unplug).
3. Badge shows **Offline**; sell from cached catalog; open tickets stay local; completed sales enter the local queue.
4. Back online → badge **Sync N** / auto-sync every ~20s; sales POST to `/api/pos/offline-sales`.
5. **Conflicts:** server wins catalog on refresh; client-queued sales are idempotent on `clientSaleId` (`note: offline:<id>`).

### Durability extras (browser)

- Requests **persistent storage** so the OS is less likely to evict the queue.
- **Service worker** caches the till shell and can **background-sync** queued sales (Chromium) when connectivity returns — even if the tab was closed after queueing.
- **Leave warning** if you close the tab while sales are still unsynced.
- **Export** button (when Sync N shows) downloads a JSON backup of unsynced sales.

Still true: clearing site data, or wiping the device *before* sync/export, can lose the queue. Once synced to the cloud, sales are durable.

## Billing / tiers

| Package | £/mo | Cloud features |
| --- | --- | --- |
| Counter (`starter`) | 19 | Till · BO · Items/groups · live ticket sync · offline queue · backup |
| Venue (`pro`) | 35 | + web ordering · kitchen · UK delivery apps · CSV · richer reports |
| Multi-site (`multi`) | 59 | + multi-store transfers · assign items to branches |

- Public page: https://purepos.co.uk/pricing (cards from `/api/public/plans`)
- BO **Settings → Billing** to switch package / activate license
- Gates: CSV / ordering / delivery / kitchen / richer reports → Venue+; transfers / branch assign → Multi-site

## Smoke checklist

- [ ] `/api/health` → `ok: true` (0.5.4+)
- [ ] POS PIN `1111`, add Latte, charge £
- [ ] Offline badge; queue a sale offline; sync online
- [ ] BO Import preview (Venue plan)
- [ ] Pricing page Counter/Venue/Multi-site + trial signup
- [ ] Settings billing plan switch + backup panel
- [ ] Kitchen simulate delivery app
- [ ] Demo reset + re-login
