# Host PurePOS online

## Live on Railway (permanent host)

**https://web-production-b2a209a9.up.railway.app**

`/` marketing · `/pos/` till · `/bo/` BO · `/order/` · `/pricing` · `/admin` (platform licensing) · `/api/health`  
Store login: `owner@purepos.demo` / `1234`  
Platform admin: set `PLATFORM_ADMIN_SECRET` on Railway, open `/admin`

### DNS for purepos.co.uk

| Type | Host | Value |
| --- | --- | --- |
| CNAME (or ANAME/ALIAS at apex) | `@` | `25iorx89.up.railway.app` |
| TXT | `_railway-verify` | `railway-verify=ed28fa443c92ad85c284e9e8292630e6475d8a9b247115a2bc9694bd8bd69c9a` |

Apex `purepos.co.uk` should CNAME/ALIAS to Railway. Upgrade Railway if you need `www` / `staging` as extra custom domains.

## Permanent hosting (recommended)

Product is already on Railway above. Fasthosts shared hosting cannot run this Node + Postgres stack — keep DNS on Railway.

Optional alternate PaaS:

### Render (Blueprint)

1. Open [Render Blueprints](https://dashboard.render.com/blueprints) and connect `NickGrant89/CloudTill`.
2. Apply `render.yaml` (Postgres free + one Docker web service from `Dockerfile.webapp`).
3. After deploy, set `PUBLIC_BASE_URL` to `https://<your-service>.onrender.com`.
4. Optional: point `staging.purepos.co.uk` / `purepos.co.uk` CNAME at the Render URL once Fasthosts DNS is under your control again.

App paths on the hosted URL match staging docs: `/pos` `/bo` `/order` `/pricing` `/api`.

### Same Mac Docker (private online via tunnel)

```bash
pnpm docker:up
# then ngrok http 8080
```

## What “all-in-one” means

`Dockerfile.webapp` builds till + BO + ordering + marketing into the API image and Express serves them. One service, one Postgres — simpler for Render/Fly than nginx + multiple containers.
