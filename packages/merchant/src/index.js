#!/usr/bin/env node

import { loadDotEnv } from '../../cli/src/dotenv.js';
import { startMerchantServer } from './runtime.js';

loadDotEnv();

startMerchantServer()
  .then(({ config }) => {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          message: 'x402 merchant server listening',
          bind: config.bind,
          port: config.port,
          network: config.network,
          resource: config.resourceUrl,
          pay_to: config.payTo,
          facilitator_url: config.facilitatorUrl,
          amount: config.amount,
          settlement_timeout_ms: config.settlementTimeoutMs,
          simulation_mode: config.simulationMode,
        },
        null,
        2
      )}\n`
    );
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
