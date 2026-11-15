import { createBalanceBridge } from './bridge.js';

export const name = 'dsh-balance-bridge';
export const inject = [];

/**
 * DSH/Cordis host entry. The bridge is deliberately passive: it starts on
 * DSH boot, and only the phone's /refresh request asks dsh-pet for a balance.
 */
export function apply(ctx, config = {}) {
  const token = config.token ?? process.env.DSH_BALANCE_TOKEN ?? '';
  if (!token) {
    console.error(
      '[dsh-balance-bridge] DSH_BALANCE_TOKEN is missing; '
      + 'the LAN fallback bridge was not started.',
    );
    return undefined;
  }

  const bridge = createBalanceBridge({
    token,
    host: config.host ?? process.env.DSH_BALANCE_HOST,
    port: config.port ?? process.env.DSH_BALANCE_PORT,
    dshPetOrigin: config.dshPetOrigin ?? process.env.DSH_PET_ORIGIN,
    petPrefix: config.petPrefix ?? process.env.DSH_PET_PREFIX,
    requestTimeoutMs: config.requestTimeoutMs,
    log: (message) => console.log(`[dsh-balance-bridge] ${message}`),
  });

  bridge.start().catch((error) => {
    console.error(`[dsh-balance-bridge] failed to start: ${error?.message ?? error}`);
  });

  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      bridge.close().catch((error) => {
        console.error(`[dsh-balance-bridge] close failed: ${error?.message ?? error}`);
      });
    });
  }
  return bridge;
}
