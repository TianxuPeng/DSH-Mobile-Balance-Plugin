# dsh-mobile balance-title extension

This is the **internet-capable route** used by `dshMobile`'s native title bar.

The dsh-mobile gateway serves this local host extension itself, so the request
runs on the same authenticated origin as the mobile page. It therefore works
over LAN **and** over a remote/mobile-data tunnel, unlike the LAN-only 43130
bridge.

## Install

Create this directory under the DSH data directory:

```text
%APPDATA%\dsh-desktop\harness\mobile-access\extensions\balance-title\
```

Copy:

- `extension.json`
- `host.mjs`

The dsh-mobile gateway watches the extensions directory and loads the route;
reload the mobile page (or the extension from the Mobile Access panel) if your
dsh-mobile version does not pick it up automatically.

## Route

```text
GET /mobile-access/extensions/balance-title/routes/refresh
```

The route is protected by the dsh-mobile pairing/session authentication. It is
not a public route and has no separate token.

It calls:

- `POST http://127.0.0.1:43129/dsh-pet-7340/balance`
- `GET  http://127.0.0.1:43129/dsh-pet-7340/state`

and returns:

```json
{
  "ok": true,
  "service": "dsh-mobile-balance-title",
  "version": 1,
  "provider": "deepseek-official",
  "currency": "CNY",
  "total": "27.17",
  "granted": "0.00",
  "toppedUp": "27.17",
  "tier": "idle",
  "updatedAt": 1794737396238
}
```

`dshMobile` calls this route on page load and then every five minutes. If it
returns an error, the app falls back to the in-page dsh-pet route and finally
to the LAN 43130 bridge.

## Security

- It runs with the current desktop user's permissions.
- It only calls dsh-pet on loopback.
- It does not read or expose the DeepSeek API key, sessions, files or chat.
- The dsh-mobile gateway authentication controls access.
