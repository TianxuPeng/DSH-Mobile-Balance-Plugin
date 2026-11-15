/**
 * dsh-mobile host extension for the dshMobile native balance bar.
 *
 * It is intentionally served by the dsh-mobile gateway, not by a separate
 * LAN port. The gateway authenticates the paired phone, so this route works
 * over LAN and over a remote/mobile-data tunnel.
 *
 * URL used by the APK:
 *   /mobile-access/extensions/balance-title/routes/refresh
 */

const DSH_PET_ORIGIN = process.env.DSH_PET_ORIGIN || 'http://127.0.0.1:43129';
const DSH_PET_PREFIX = process.env.DSH_PET_PREFIX || '/dsh-pet-7340';
const REQUEST_TIMEOUT_MS = 18_000;

function tierAt(date = new Date()) {
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const day = beijing.getUTCDay();
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  const weekday = day >= 1 && day <= 5;
  const peak = weekday && ((minutes >= 9 * 60 && minutes < 12 * 60)
      || (minutes >= 14 * 60 && minutes < 18 * 60));
  return peak ? 'peak' : 'idle';
}

function money(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

function chooseWallet(wallets) {
  if (!Array.isArray(wallets)) return null;
  return wallets.find((wallet) => wallet && String(wallet.currency).toUpperCase() === 'CNY')
      ?? wallets.find((wallet) => wallet && String(wallet.currency).toUpperCase() === 'USD')
      ?? wallets.find((wallet) => wallet && wallet.total !== undefined && wallet.total !== null)
      ?? null;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('dsh-pet returned non-JSON data');
  }
}

async function refresh(signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const balanceResponse = await fetch(`${DSH_PET_ORIGIN}${DSH_PET_PREFIX}/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: combined,
  });
  if (!balanceResponse.ok) {
    throw new Error(`dsh-pet refresh returned HTTP ${balanceResponse.status}`);
  }

  const stateResponse = await fetch(`${DSH_PET_ORIGIN}${DSH_PET_PREFIX}/state`, {
    cache: 'no-store',
    signal: combined,
  });
  if (!stateResponse.ok) {
    throw new Error(`dsh-pet state returned HTTP ${stateResponse.status}`);
  }

  const state = await readJson(stateResponse);
  const section = state?.sections?.balance?.data;
  if (!section || section.ok !== true) {
    throw new Error('dsh-pet has no usable balance section');
  }
  const wallet = chooseWallet(section?.data?.wallets);
  const total = money(wallet?.total);
  if (!wallet || total === null) {
    throw new Error('dsh-pet returned no usable wallet');
  }

  return {
    ok: true,
    service: 'dsh-mobile-balance-title',
    version: 1,
    provider: String(section.provider ?? ''),
    currency: String(wallet.currency ?? '').toUpperCase(),
    total,
    granted: money(wallet.granted) ?? '0.00',
    toppedUp: money(wallet.toppedUp) ?? '0.00',
    tier: tierAt(),
    updatedAt: Date.now(),
  };
}

export default async function activate(api) {
  api.route({
    method: 'GET',
    path: '/refresh',
    timeoutMs: 25_000,
    async handle({ signal }) {
      let body;
      try {
        body = await refresh(signal);
      } catch (error) {
        body = {
          ok: false,
          service: 'dsh-mobile-balance-title',
          version: 1,
          error: error instanceof Error ? error.message : String(error),
          tier: tierAt(),
          updatedAt: Date.now(),
        };
      }
      return {
        status: 200,
        contentType: 'application/json; charset=utf-8',
        headers: { 'cache-control': 'no-store' },
        body: JSON.stringify(body),
      };
    },
  });
}
