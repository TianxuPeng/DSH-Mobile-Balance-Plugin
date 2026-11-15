import { createBalanceBridge } from './bridge.js';

const bridge = createBalanceBridge({
  token: process.env.DSH_BALANCE_TOKEN,
  host: process.env.DSH_BALANCE_HOST ?? '0.0.0.0',
  port: process.env.DSH_BALANCE_PORT ?? 43130,
  dshPetOrigin: process.env.DSH_PET_ORIGIN,
  petPrefix: process.env.DSH_PET_PREFIX,
  requestTimeoutMs: process.env.DSH_BALANCE_TIMEOUT_MS,
  log: (message) => console.log(`[dsh-balance-bridge] ${message}`),
});

try {
  await bridge.start();
} catch (error) {
  console.error(`[dsh-balance-bridge] failed to start: ${error?.message ?? error}`);
  process.exitCode = 1;
}

const stop = async () => {
  await bridge.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
