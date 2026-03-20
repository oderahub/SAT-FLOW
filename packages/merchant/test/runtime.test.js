import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'x402-stacks';

import { createMerchantApp, createMerchantConfig, startMerchantServer } from '../src/runtime.js';
import { runMerchantSmoke } from '../src/smoke-client.js';
import { createAccountFromEnv } from '../../cli/src/runtime.js';

test('createMerchantConfig derives defaults from SAT-FLOW env', async () => {
  const config = await createMerchantConfig({
    SAT_FLOW_NETWORK: 'testnet',
    SAT_FLOW_FACILITATOR_URL: 'https://x402-facilitator.onrender.com',
    SAT_FLOW_SEED_PHRASE:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  });

  assert.equal(config.network, 'testnet');
  assert.equal(config.amount, '1000000');
  assert.equal(config.resourcePath, '/api/premium-data');
  assert.equal(config.facilitatorUrl, 'https://x402-facilitator.onrender.com');
  assert.equal(config.tokenType, 'STX');
  assert.equal(config.settlementTimeoutMs, 5000);
  assert.equal(config.simulationMode, false);
  assert.match(config.payTo, /^ST/);
});

test('createMerchantConfig supports USDCx token configuration', async () => {
  const config = await createMerchantConfig({
    SAT_FLOW_NETWORK: 'testnet',
    SAT_FLOW_FACILITATOR_URL: 'http://localhost:8089',
    SAT_FLOW_SEED_PHRASE:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    MERCHANT_TOKEN_TYPE: 'USDCx',
    MERCHANT_TOKEN_CONTRACT: 'ST123.mock-usdcx',
  });

  assert.equal(config.tokenType, 'USDCx');
  assert.deepEqual(config.tokenContract, {
    address: 'ST123',
    name: 'mock-usdcx',
  });
});

test('createMerchantApp serves health and paid resource routes', async () => {
  const middlewareCalls = [];
  const app = createMerchantApp(
    {
      bind: '127.0.0.1',
      port: 0,
      network: 'testnet',
      payTo: 'STTESTPAYTO',
      facilitatorUrl: 'https://facilitator.test',
      resourcePath: '/api/premium-data',
      resourceUrl: 'http://127.0.0.1:4021/api/premium-data',
      amount: '1000000',
      tokenType: 'STX',
      description: 'test',
    },
    {
      paymentMiddlewareFactory(config) {
        middlewareCalls.push(config);
        return (req, _res, next) => {
          req.testPayment = {
            payer: 'STPAYER',
            transaction: 'ab'.repeat(32),
            network: 'testnet',
            asset: 'STX',
          };
          next();
        };
      },
      getPaymentFromRequest: req => req.testPayment,
    }
  );

  const routes = app._router.stack
    .filter(layer => layer.route)
    .map(layer => ({
      path: layer.route.path,
      methods: layer.route.methods,
    }));

  assert.deepEqual(routes, [
    {
      path: '/health',
      methods: { get: true },
    },
    {
      path: '/api/premium-data',
      methods: { get: true },
    },
  ]);
  assert.equal(middlewareCalls[0].address, 'STTESTPAYTO');
  assert.equal(middlewareCalls[0].payTo, 'STTESTPAYTO');
  assert.equal(middlewareCalls[0].tokenType, 'STX');
});

test('createMerchantApp forwards SIP-010 merchant config to x402 middleware', async () => {
  const middlewareCalls = [];
  createMerchantApp(
    {
      bind: '127.0.0.1',
      port: 0,
      network: 'testnet',
      payTo: 'STTESTPAYTO',
      facilitatorUrl: 'https://facilitator.test',
      resourcePath: '/api/premium-data',
      resourceUrl: 'http://127.0.0.1:4021/api/premium-data',
      amount: '1000000',
      tokenType: 'USDCx',
      tokenContract: 'ST123.mock-usdcx',
      description: 'test',
    },
    {
      paymentMiddlewareFactory(config) {
        middlewareCalls.push(config);
        return (_req, _res, next) => next();
      },
    }
  );

  assert.equal(middlewareCalls[0].tokenType, 'USDCx');
  assert.equal(middlewareCalls[0].tokenContract, 'ST123.mock-usdcx');
});

test('createMerchantApp supports simulation mode bypass', async () => {
  const app = createMerchantApp({
    bind: '127.0.0.1',
    port: 0,
    network: 'testnet',
    payTo: 'STTESTPAYTO',
    facilitatorUrl: 'https://facilitator.test',
    resourcePath: '/api/premium-data',
    resourceUrl: 'http://127.0.0.1:4021/api/premium-data',
    amount: '1000000',
    description: 'test',
    settlementTimeoutMs: 5000,
    simulationMode: true,
  });

  const routeLayer = app._router.stack.find(layer => layer.route?.path === '/api/premium-data');
  const handler = routeLayer.route.stack[0].handle;
  let payload;
  const res = {
    json(value) {
      payload = value;
    },
  };

  await handler({ headers: {} }, res, () => {});
  assert.deepEqual(payload, {
    ok: true,
    resource: 'http://127.0.0.1:4021/api/premium-data',
    data: {
      report: 'Stacks x402 merchant control path is live.',
    },
    payment: {
      mode: 'simulation',
    },
  });
});

test('createMerchantApp forwards the initial unsigned request directly to middleware', async () => {
  let middlewareCalls = 0;
  const app = createMerchantApp(
    {
      bind: '127.0.0.1',
      port: 0,
      network: 'testnet',
      payTo: 'STTESTPAYTO',
      facilitatorUrl: 'https://facilitator.test',
      resourcePath: '/api/premium-data',
      resourceUrl: 'http://127.0.0.1:4021/api/premium-data',
      amount: '1000000',
      description: 'test',
      settlementTimeoutMs: 5000,
      simulationMode: false,
    },
    {
      paymentHandler(req, res) {
        middlewareCalls += 1;
        res.statusCode = 402;
        res.body = { x402Version: 2 };
      },
    }
  );

  const routeLayer = app._router.stack.find(layer => layer.route?.path === '/api/premium-data');
  const handler = routeLayer.route.stack[0].handle;
  const res = {};

  await handler({ headers: {} }, res, () => {});
  assert.equal(middlewareCalls, 1);
  assert.equal(res.statusCode, 402);
  assert.deepEqual(res.body, { x402Version: 2 });
});

test('startMerchantServer starts a listening server with explicit overrides', async () => {
  const calls = [];
  const { server, config } = await startMerchantServer(
    {
      SAT_FLOW_FACILITATOR_URL: 'https://facilitator.test',
      SAT_FLOW_SEED_PHRASE:
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    },
    {
      port: 0,
      paymentHandler: (_req, res) => {
        res.status(402).json({ ok: false });
      },
      listenImpl(port, bind, onReady) {
        calls.push({ port, bind });
        const fakeServer = {
          once() {},
          close(callback) {
            if (callback) {
              callback();
            }
          },
          address() {
            return { port: 4021 };
          },
        };
        onReady();
        return fakeServer;
      },
    }
  );

  assert.equal(config.facilitatorUrl, 'https://facilitator.test');
  assert.deepEqual(calls, [{ port: 0, bind: '127.0.0.1' }]);
  assert.equal(server.address().port, 4021);
});

test('runMerchantSmoke uses the wrapped payment client and returns response data', async () => {
  let callCount = 0;
  const result = await runMerchantSmoke(
    {},
    {
      account: {
        address: 'STPAYER',
        privateKey: 'a'.repeat(64),
        network: 'testnet',
      },
      baseUrl: 'http://127.0.0.1:4021',
      signPayment: async ({ fee }) => {
        assert.equal(fee, '2000');
        return 'ab'.repeat(16);
      },
      api: {
        async get(path, config) {
          assert.equal(path, '/api/premium-data');
          callCount += 1;
          if (callCount === 1) {
            return {
              status: 402,
              headers: {
                'payment-required': Buffer.from(
                  JSON.stringify({
                    x402Version: 2,
                    resource: {
                      url: 'http://127.0.0.1:4021/api/premium-data',
                    },
                    accepts: [
                      {
                        scheme: 'exact',
                        network: 'stacks:2147483648',
                        amount: '1000000',
                        asset: 'STX',
                        payTo: 'STRECIPIENT',
                        maxTimeoutSeconds: 300,
                      },
                    ],
                  })
                ).toString('base64'),
              },
              data: {},
            };
          }

          assert.equal(typeof config.headers['payment-signature'], 'string');
          return {
            status: 200,
            headers: {},
            data: {
              ok: true,
            },
          };
        },
      },
    }
  );

  assert.deepEqual(result, {
    ok: true,
    url: 'http://127.0.0.1:4021/api/premium-data',
    payer: 'STPAYER',
    status: 200,
    payment_response: null,
    data: {
      ok: true,
    },
  });
});

test('mnemonic-derived accounts are upstream-compatible for x402 smoke flows', async () => {
  const account = await createAccountFromEnv({
    SAT_FLOW_NETWORK: 'testnet',
    SAT_FLOW_SEED_PHRASE:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  });

  assert.equal(account.network, 'testnet');
  assert.match(account.address, /^ST/);
  assert.match(account.privateKey, /^[0-9a-f]+$/);
  assert.deepEqual(Object.keys(account).sort(), ['address', 'network', 'privateKey']);
});

test('runMerchantSmoke honors MERCHANT_SMOKE_PRIVATE_KEY override', async () => {
  const expectedAccount = privateKeyToAccount('b'.repeat(64), 'testnet');
  const result = await runMerchantSmoke(
    {
      MERCHANT_SMOKE_PRIVATE_KEY: 'b'.repeat(64),
      SAT_FLOW_AGENT_KEY: 'c'.repeat(64),
      SAT_FLOW_NETWORK: 'testnet',
    },
    {
      api: {
        async get() {
          return {
            status: 200,
            headers: {},
            data: { ok: true },
          };
        },
      },
    }
  );

  assert.equal(result.payer, expectedAccount.address);
});

test('runMerchantSmoke signs SIP-010 transfers for USDCx assets', async () => {
  let sawPaymentSignature = false;
  const result = await runMerchantSmoke(
    {},
    {
      account: {
        address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
        privateKey: 'a'.repeat(64),
        network: 'testnet',
      },
      signPayment: async ({ accepted }) => {
        assert.equal(accepted.asset, 'ST123.mock-usdcx');
        return 'deadbeef';
      },
      api: {
        async get(_path, config) {
          if (!config) {
            return {
              status: 402,
              headers: {
                'payment-required': Buffer.from(
                  JSON.stringify({
                    x402Version: 2,
                    resource: {
                      url: 'http://127.0.0.1:4021/api/premium-data',
                    },
                    accepts: [
                      {
                        scheme: 'exact',
                        network: 'stacks:2147483648',
                        amount: '1000000',
                        asset: 'ST123.mock-usdcx',
                        payTo: 'STRECIPIENT',
                        maxTimeoutSeconds: 300,
                      },
                    ],
                  })
                ).toString('base64'),
              },
              data: {},
            };
          }

          sawPaymentSignature = typeof config.headers['payment-signature'] === 'string';
          return {
            status: 200,
            headers: {},
            data: {
              ok: true,
              asset: 'ST123.mock-usdcx',
            },
          };
        },
      },
    }
  );

  assert.equal(sawPaymentSignature, true);
  assert.equal(result.data.asset, 'ST123.mock-usdcx');
});
