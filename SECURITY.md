# Security

## Threat model

This plugin is a local-network bridge. It is not designed to be exposed to the
public internet.

- It listens on `0.0.0.0:43130` by default so a phone on the same Wi-Fi can
  reach it.
- Every route requires a shared token. There is no unauthenticated health or
  balance response.
- The token is supplied through `DSH_BALANCE_TOKEN` or DSH plugin config. It is
  never written to the repository or logs.
- The bridge only reads dsh-pet's local balance routes. It does not read the
  DeepSeek API key, chat content, sessions, or files.
- `POST /refresh` intentionally causes dsh-pet to perform a balance API call.

## Reporting

Open a private security advisory on the GitHub repository, or contact the
maintainer through the repository's listed contact. Do not include a live
token, API key, or personal data in a public issue.

## Operational guidance

- Use a random token of at least 32 bytes.
- Do not port-forward 43130.
- If the PC is on an untrusted network, set `host: '127.0.0.1'` (then phones
  cannot use the fallback) or stop the plugin.
- DSH plugins run with the user's desktop privileges; install only code you
  have reviewed.
