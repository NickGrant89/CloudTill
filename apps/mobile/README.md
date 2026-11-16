# CloudTill Mobile (Expo)

Web-first CloudTill ships a **mobile-ready Expo/React Native scaffold** that talks to the same API and imports `@cloudtill/shared` (roles + receipt helpers).

## Run

```bash
# from repo root (API must be reachable from the device/simulator)
pnpm --filter @cloudtill/shared build
pnpm --filter @cloudtill/api dev

# Expo is installed separately to avoid React 19 vs RN peer conflicts
cd apps/mobile
npm install
EXPO_PUBLIC_API_URL=http://127.0.0.1:4000/api npx expo start
```

Types/receipt helpers live in `packages/shared` (used by API + web). The mobile scaffold talks to the same REST API.

On a physical device, set `EXPO_PUBLIC_API_URL` to your machine LAN IP (e.g. `http://192.168.1.10:4000/api`).

## Included screens

- PIN login (same employees as web)
- Catalog list (shared `/catalog/items`)
- Time clock in/out
- Gift card balance lookup

Full register/checkout remains on the tablet web POS (`apps/pos`); this app is the native wrap path for floor staff workflows.
