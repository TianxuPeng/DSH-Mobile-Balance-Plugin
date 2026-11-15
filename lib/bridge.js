import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const VERSION = 1;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 43130;
const DEFAULT_DSH_PET_ORIGIN = 'http://127.0.0.1:43129';
const DEFAULT_PET_PREFIX = '/dsh-pet-7340';
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * DeepSeek's published peak windows are Beijing time (UTC+8, no DST):
 * Monday-Friday 09:00-12:00 and 14:00-18:00. Everything else is idle.
 */
export function pricingTierAt(date = new Date()) {
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
    throw new Error('upstream returned non-JSON data');
  }
}

function tokenMatches(header, token) {
  const supplied = typeof header === 'string' ? header : '';
  const expected = Buffer.from(token, 'utf8');
  const actual = Buffer.from(supplied, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sendJson(response, status, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
  });
  response.end(bytes);
}

/**
 * Create the bridge. It never polls on its own: /refresh is the only path
 * that asks dsh-pet to query DeepSeek. This keeps the phone in control of the
 * five-minute cadence and avoids duplicate balance refreshes.
 */
export function createBalanceBridge(options = {}) {
  const token = options.token ?? process.env.DSH_BALANCE_TOKEN ?? '';
  if (!token) {
    throw new Error('a non-empty balance bridge token is required');
  }
  const host = options.host ?? process.env.DSH_BALANCE_HOST ?? DEFAULT_HOST;
  const port = Number(options.port ?? process.env.DSH_BALANCE_PORT ?? DEFAULT_PORT);
  const dshPetOrigin = String(
    options.dshPetOrigin ?? process.env.DSH_PET_ORIGIN ?? DEFAULT_DSH_PET_ORIGIN,
  ).replace(/\/+$/, '');
  const petPrefix = String(
    options.petPrefix ?? process.env.DSH_PET_PREFIX ?? DEFAULT_PET_PREFIX,
  ).replace(/\/+$/, '');
  const timeoutMs = Number(
    options.requestTimeoutMs ?? process.env.DSH_BALANCE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );
  const log = typeof options.log === 'function' ? options.log : () => {};

  let latest = {
    ok: false,
    service: 'dsh-balance-bridge',
    version: VERSION,
    error: 'no balance fetched yet',
    updatedAt: 0,
  };
  let refreshing = null;
  let server = null;

  function payload() {
    if (!latest.ok) return { ...latest, tier: pricingTierAt() };
    return { ...latest, tier: pricingTierAt() };
  }

  async function doRefresh() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const refreshResponse = await fetch(`${dshPetOrigin}${petPrefix}/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      });
      if (!refreshResponse.ok) {
        throw new Error(`dsh-pet refresh returned HTTP ${refreshResponse.status}`);
      }
      const stateResponse = await fetch(`${dshPetOrigin}${petPrefix}/state`, {
        cache: 'no-store',
        signal: controller.signal,
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
      latest = {
        ok: true,
        service: 'dsh-balance-bridge',
        version: VERSION,
        provider: String(section.provider ?? ''),
        currency: String(wallet.currency ?? '').toUpperCase(),
        total,
        granted: money(wallet.granted) ?? '0.00',
        toppedUp: money(wallet.toppedUp) ?? '0.00',
        updatedAt: Date.now(),
      };
      log(`balance ok provider=${latest.provider} ${latest.currency} ${latest.total}`);
      return latest;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      latest = {
        ok: false,
        service: 'dsh-balance-bridge',
        version: VERSION,
        error: message,
        updatedAt: Date.now(),
      };
      log(`balance failed: ${message}`);
      return latest;
    } finally {
      clearTimeout(timer);
    }
  }

  function refresh() {
    if (!refreshing) {
      refreshing = doRefresh().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    const supplied = request.headers['x-dsh-balance-key']
      ?? (String(request.headers.authorization || '').startsWith('Bearer ')
        ? String(request.headers.authorization).slice(7)
        : '');
    if (!tokenMatches(String(supplied), token)) {
      return sendJson(response, 403, { ok: false, error: 'forbidden' });
    }
    if (request.method === 'GET' && url.pathname === '/balance') {
      return sendJson(response, 200, payload());
    }
    if ((request.method === 'GET' || request.method === 'POST')
        && url.pathname === '/refresh') {
      await refresh();
      return sendJson(response, 200, payload());
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, {
        ok: true,
        service: 'dsh-balance-bridge',
        version: VERSION,
        balanceReady: latest.ok,
        listeningPort: server.address()?.port ?? port,
      });
    }
    return sendJson(response, 404, { ok: false, error: 'not found' });
  });

  return {
    async start() {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          log(`listening on ${host}:${server.address().port}`);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      return this;
    },
    close() {
      return new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.closeIdleConnections?.();
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
    refresh,
    payload,
    get port() {
      return server.address()?.port ?? null;
    },
  };
}
