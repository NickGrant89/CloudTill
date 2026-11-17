# Host PurePOS online

## Live right now (this Mac)

Public tunnel of the Docker stack:

**https://05eb-2a03-9c20-4080-8e01-cc5a-7e31-6e-b5c2.ngrok-free.app**

`/pos/` · `/bo/` · `/order/` · `/pricing` · `/api/health`  
Login: `owner@purepos.demo` / `1234`

This is online for testing while the Mac + Docker + ngrok stay up. It is **not** permanent DNS hosting.

## Permanent hosting (recommended)

`purepos.co.uk` is on **Fasthosts** and currently shows **Hosting Account Suspended**. That shared host also can’t run this Node + Postgres cloud stack (it was for WordPress).

Use a PaaS instead:

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
