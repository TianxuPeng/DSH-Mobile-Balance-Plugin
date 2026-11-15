# dsh-balance-bridge

A passive, token-protected LAN balance bridge plugin for **DeepSeek Harness (DSH)**.

It exposes the balance already fetched by dsh-pet to a phone client such as `dshMobile`'s LAN fallback path. It never polls on its own: only `POST /refresh` asks dsh-pet to refresh.

This is an optional fallback. The `dshMobile` 1.1.x primary path calls dsh-pet inside the authenticated DSH mobile page and does not need port 43130.

## Endpoints

- `POST /refresh` — refresh through dsh-pet and return the current wallet.
- `GET /balance` — cached result only.
- `GET /health` — health.

All endpoints require `X-DSH-Balance-Key: <token>` or `Authorization: Bearer <token>`.

## Install

The package contains a DSH bundle patch (`cordis.patch.yml`) and a Cordis host entry (`lib/index.js`). Publish it to GitHub and install it with your DSH plugin manager, or build a local package:

```bash
npm pack
```

Do not run it alongside the old standalone bridge on the same port.

## Configure

```powershell
[Environment]::SetEnvironmentVariable('DSH_BALANCE_TOKEN', '<random-token>', 'User')
```

Optional: `DSH_BALANCE_HOST`, `DSH_BALANCE_PORT`, `DSH_PET_ORIGIN`, `DSH_PET_PREFIX`, `DSH_BALANCE_TIMEOUT_MS`.

The token must match the token compiled into `dshMobile` if the LAN fallback is used. The primary in-page path does not need the bridge.

## License

MIT. No dsh-pet code or assets are bundled.
