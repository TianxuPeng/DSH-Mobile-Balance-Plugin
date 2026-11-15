import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { createBalanceBridge, pricingTierAt } from '../lib/bridge.js';

const TOKEN = 'test-token';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

function mockDshPet() {
  let balanceCalls = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/dsh-pet-7340/balance') {
      balanceCalls++;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
      return;
    }
    if (request.method === 'GET' && request.url === '/dsh-pet-7340/state') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        sections: {
          balance: {
            data: {
              ok: true,
              provider: 'deepseek-official',
              data: {
                wallets: [
                  { currency: 'CNY', total: '28.91', granted: '0.00', toppedUp: '28.91' },
                  { currency: 'USD', total: '4.00' },
                ],
              },
            },
          },
        },
      }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  return { server, balanceCalls: () => balanceCalls };
}

test('pricingTierAt follows Beijing peak windows', () => {
  assert.equal(pricingTierAt(new Date('2026-11-16T01:00:00Z')), 'peak'); // Mon 09:00
  assert.equal(pricingTierAt(new Date('2026-11-16T04:00:00Z')), 'idle'); // Mon 12:00
  assert.equal(pricingTierAt(new Date('2026-11-16T06:00:00Z')), 'peak'); // Mon 14:00
  assert.equal(pricingTierAt(new Date('2026-11-16T10:00:00Z')), 'idle'); // Mon 18:00
  assert.equal(pricingTierAt(new Date('2026-11-15T02:00:00Z')), 'idle'); // Sunday
});

test('requires a token', () => {
  assert.throws(
    () => createBalanceBridge({ token: '', port: 0, host: '127.0.0.1' }),
    /token is required/,
  );
});

test('health and balance routes are token protected', async () => {
  const pet = mockDshPet();
  const petPort = await listen(pet.server);
  const bridge = createBalanceBridge({
    token: TOKEN,
    host: '127.0.0.1',
    port: 0,
    dshPetOrigin: `http://127.0.0.1:${petPort}`,
  });
  await bridge.start();
  try {
    const port = bridge.port;
    const denied = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(denied.status, 403);

    const health = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { 'X-DSH-Balance-Key': TOKEN },
    });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).balanceReady, false);
  } finally {
    await bridge.close();
    await close(pet.server);
  }
});

test('refresh actively asks dsh-pet and returns the wallet', async () => {
  const pet = mockDshPet();
  const petPort = await listen(pet.server);
  const bridge = createBalanceBridge({
    token: TOKEN,
    host: '127.0.0.1',
    port: 0,
    dshPetOrigin: `http://127.0.0.1:${petPort}`,
    log: () => {},
  });
  await bridge.start();
  try {
    const port = bridge.port;
    const before = await fetch(`http://127.0.0.1:${port}/balance`, {
      headers: { 'X-DSH-Balance-Key': TOKEN },
    });
    assert.equal((await before.json()).ok, false);
    assert.equal(pet.balanceCalls(), 0);

    const refreshed = await fetch(`http://127.0.0.1:${port}/refresh`, {
      method: 'POST',
      headers: { 'X-DSH-Balance-Key': TOKEN },
    });
    const body = await refreshed.json();
    assert.equal(body.ok, true);
    assert.equal(body.currency, 'CNY');
    assert.equal(body.total, '28.91');
    assert.ok(body.tier === 'peak' || body.tier === 'idle');
    assert.equal(pet.balanceCalls(), 1);

    const cached = await fetch(`http://127.0.0.1:${port}/balance`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal((await cached.json()).total, '28.91');
    assert.equal(pet.balanceCalls(), 1);
  } finally {
    await bridge.close();
    await close(pet.server);
  }
});

test('refresh never throws when dsh-pet is unavailable', async () => {
  const bridge = createBalanceBridge({
    token: TOKEN,
    host: '127.0.0.1',
    port: 0,
    dshPetOrigin: 'http://127.0.0.1:1',
    requestTimeoutMs: 500,
    log: () => {},
  });
  await bridge.start();
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.port}/refresh`, {
      method: 'POST',
      headers: { 'X-DSH-Balance-Key': TOKEN },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, false);
    assert.equal(typeof body.error, 'string');
  } finally {
    await bridge.close();
  }
});

test('plugin entry starts and disposes the bridge through ctx.effect', async () => {
  const { apply } = await import('../lib/index.js');
  let dispose;
  const ctx = {
    effect(factory) {
      dispose = factory();
    },
  };
  const bridge = apply(ctx, {
    token: TOKEN,
    host: '127.0.0.1',
    port: 0,
  });
  assert.ok(bridge);
  for (let i = 0; i < 100 && !bridge.port; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(bridge.port, 'bridge did not start');
  const health = await fetch(`http://127.0.0.1:${bridge.port}/health`, {
    headers: { 'X-DSH-Balance-Key': TOKEN },
  });
  assert.equal((await health.json()).ok, true);
  await dispose();
  assert.equal(bridge.port, null);
});
