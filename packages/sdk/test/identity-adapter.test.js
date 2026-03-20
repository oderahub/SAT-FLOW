import test from 'node:test';
import assert from 'node:assert/strict';

import { responseOkCV, standardPrincipalCV } from '@stacks/transactions';

import {
  HiroBnsIdentityAdapter,
  HybridBnsIdentityAdapter,
  StacksBnsIdentityAdapter,
  StaticIdentityAdapter,
} from '../src/index.js';

test('StaticIdentityAdapter returns the input unchanged', async () => {
  const adapter = new StaticIdentityAdapter();
  assert.equal(
    await adapter.resolveIdentity('ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P'),
    'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P'
  );
});

test('HiroBnsIdentityAdapter passes principals through unchanged', async () => {
  const adapter = new HiroBnsIdentityAdapter({
    fetchImpl: async () => {
      throw new Error('fetch should not be called for principals');
    },
  });

  assert.equal(
    await adapter.resolveIdentity('ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P'),
    'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P'
  );
});

test('HiroBnsIdentityAdapter resolves a .btc name via the Hiro API', async () => {
  const requests = [];
  const adapter = new HiroBnsIdentityAdapter({
    network: 'testnet',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        async json() {
          return {
            address: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
          };
        },
      };
    },
  });

  const result = await adapter.resolveIdentity('merchant.btc');

  assert.equal(result, 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P');
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'https://api.testnet.hiro.so/v1/names/merchant.btc'
  );
  assert.equal(requests[0].options.headers.accept, 'application/json');
});

test('StacksBnsIdentityAdapter resolves a .btc name via the BNS contract', async () => {
  const calls = [];
  const adapter = new StacksBnsIdentityAdapter({
    network: 'testnet',
    readOnly: async ({ contractName, functionName, functionArgs, network }) => {
      calls.push({ contractName, functionName, functionArgs, network });
      return responseOkCV(
        standardPrincipalCV('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM')
      );
    },
  });

  const result = await adapter.resolveIdentity('merchant.btc');

  assert.equal(result, 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].contractName, 'bns');
  assert.equal(calls[0].functionName, 'name-resolve');
});

test('HybridBnsIdentityAdapter falls back to Hiro when on-chain resolution fails', async () => {
  const adapter = new HybridBnsIdentityAdapter({
    primary: new StacksBnsIdentityAdapter({
      network: 'testnet',
      readOnly: async () => {
        throw new Error('contract lookup failed');
      },
    }),
    fallback: new HiroBnsIdentityAdapter({
      network: 'testnet',
      fetchImpl: async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        async json() {
          return {
            address: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
          };
        },
      }),
    }),
  });

  const result = await adapter.resolveIdentity('merchant.btc');
  assert.equal(result, 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P');
});

test('HiroBnsIdentityAdapter supports explicit API base URL and API key', async () => {
  const requests = [];
  const adapter = new HiroBnsIdentityAdapter({
    network: 'mainnet',
    apiBaseUrl: 'https://hiro.example/',
    apiKey: 'secret-key',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        async json() {
          return {
            address: 'SP3FGQ8Z4M74A0P9GJ0M6R7R5TT6D6K4S1B2C3D4E',
          };
        },
      };
    },
  });

  const result = await adapter.resolveIdentity('agent.btc');

  assert.equal(result, 'SP3FGQ8Z4M74A0P9GJ0M6R7R5TT6D6K4S1B2C3D4E');
  assert.equal(requests[0].url, 'https://hiro.example/v1/names/agent.btc');
  assert.equal(requests[0].options.headers['x-api-key'], 'secret-key');
});

test('HiroBnsIdentityAdapter throws on missing address results', async () => {
  const adapter = new HiroBnsIdentityAdapter({
    fetchImpl: async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      async json() {
        return {
          names: ['merchant.btc'],
        };
      },
    }),
  });

  await assert.rejects(
    () => adapter.resolveIdentity('merchant.btc'),
    /did not return an address/
  );
});

test('HiroBnsIdentityAdapter surfaces API failures', async () => {
  const adapter = new HiroBnsIdentityAdapter({
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      async json() {
        return {
          error: 'cannot find name',
        };
      },
    }),
  });

  await assert.rejects(
    () => adapter.resolveIdentity('missing.btc'),
    /cannot find name/
  );
});
