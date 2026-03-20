import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccountFromEnv,
  createLiveClientFromEnv,
  createSelectedChallenge,
  parseArgs,
  resolveUsdcxContract,
  runMerchantPaymentLive,
  runCli,
} from '../src/runtime.js';
import { generateKeypair } from 'x402-stacks';

test('parseArgs separates flags from positionals', () => {
  const parsed = parseArgs([
    'USDCX',
    '--live',
    '--url',
    'https://merchant.test/invoice',
    'merchant.btc',
  ]);

  assert.deepEqual(parsed, {
    positionals: ['USDCX', 'merchant.btc'],
    flags: {
      live: 'true',
      url: 'https://merchant.test/invoice',
    },
  });
});

test('createSelectedChallenge preserves a concrete v2 asset identifier', () => {
  const challenge = createSelectedChallenge({
    token: 'USDCX',
    amount: '1050000',
    recipient: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
    facilitatorUrl: 'https://facilitator.test',
    asset: 'ST123.usdcx-token',
  });

  assert.equal(challenge.token, 'USDCX');
  assert.equal(challenge.raw.accepted.asset, 'ST123.usdcx-token');
});

test('createLiveClientFromEnv requires a private key or seed phrase', async () => {
  await assert.rejects(
    () => createLiveClientFromEnv({}),
    /SAT_FLOW_AGENT_KEY or SAT_FLOW_SEED_PHRASE/
  );
});

test('createAccountFromEnv derives the sender account via x402-stacks', async () => {
  const keypair = generateKeypair('testnet');
  const account = await createAccountFromEnv({
    SAT_FLOW_NETWORK: 'testnet',
    SAT_FLOW_AGENT_KEY: keypair.privateKey,
  });

  assert.equal(account.privateKey, keypair.privateKey);
  assert.equal(account.network, 'testnet');
  assert.match(account.address, /^ST/);
});

test('createAccountFromEnv derives the sender account from a seed phrase', async () => {
  const account = await createAccountFromEnv({
    SAT_FLOW_NETWORK: 'testnet',
    SAT_FLOW_SEED_PHRASE:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  });

  assert.equal(account.network, 'testnet');
  assert.equal(account.address, 'STC5KHM41H6WHAST7MWWDD807YSPRQKJ68T330BQ');
  assert.match(account.privateKey, /^[0-9a-f]+01$/);
});

test('createAccountFromEnv supports SAT_FLOW_ACCOUNT_INDEX for mnemonic-derived accounts', async () => {
  const account = await createAccountFromEnv({
    SAT_FLOW_NETWORK: 'testnet',
    SAT_FLOW_SEED_PHRASE:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    SAT_FLOW_ACCOUNT_INDEX: '2',
  });

  assert.equal(account.address, 'ST28B7Q9N0NDJSRTGXRWF53B5M08BEV7G33N4VYGD');
});

test('resolveUsdcxContract falls back to the upstream x402-stacks default', () => {
  const contractId = resolveUsdcxContract(
    {},
    {
      address: 'STTESTADDRESS',
      privateKey: 'test-private-key',
      network: 'testnet',
    }
  );

  assert.equal(contractId, 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx');
});

test('resolve-identity --live uses the Hiro-backed adapter path', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    async json() {
      return {
        address: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
      };
    },
  });

  try {
    const result = await runCli(
      ['node', 'sat-flow', 'resolve-identity', 'merchant.btc', '--live'],
      {
        SAT_FLOW_NETWORK: 'testnet',
        SAT_FLOW_AGENT_KEY: generateKeypair('testnet').privateKey,
        SAT_FLOW_VAULT_CONTRACT: 'ST123.sat-flow-vault',
        SAT_FLOW_USDCX_CONTRACT: 'ST123.usdcx-token',
      }
    );

    assert.deepEqual(result, {
      input: 'merchant.btc',
      resolved: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('pay-live builds a token-aware challenge and delegates through the live client', async () => {
  const calls = [];
  const result = await runCli(
    [
      'node',
      'sat-flow',
      'pay-live',
      'USDCX',
      '1050000',
      'merchant.btc',
      'Need the premium dataset to finish the report.',
      'https://merchant.test/invoice',
    ],
    {
      SAT_FLOW_NETWORK: 'testnet',
      SAT_FLOW_AGENT_KEY: generateKeypair('testnet').privateKey,
      SAT_FLOW_VAULT_CONTRACT: 'ST123.sat-flow-vault',
      SAT_FLOW_USDCX_CONTRACT: 'ST123.usdcx-token',
      SAT_FLOW_FACILITATOR_URL: 'https://facilitator.test',
    },
    {
      liveClient: {
        async resolveIdentity(nameOrPrincipal) {
          calls.push({ type: 'resolveIdentity', nameOrPrincipal });
          return 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P';
        },
        async payBill(input) {
          calls.push({ type: 'payBill', input });
          return {
            payment_status: 'success',
            accounting_status: 'recorded',
            tx_id: 'ab'.repeat(32),
            audit_hash: 'cd'.repeat(32),
          };
        },
      },
    }
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    type: 'resolveIdentity',
    nameOrPrincipal: 'merchant.btc',
  });
  assert.equal(calls[1].type, 'payBill');
  assert.equal(calls[1].input.x402Challenge.token, 'USDCX');
  assert.equal(calls[1].input.x402Challenge.raw.accepted.asset, 'ST123.usdcx-token');
  assert.equal(calls[1].input.recipient, 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P');
  assert.deepEqual(result, {
    challenge: {
      scheme: 'exact',
      network: 'stacks:2147483648',
      amount: '1050000',
      asset: 'ST123.usdcx-token',
      payTo: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
      maxTimeoutSeconds: 300,
    },
    result: {
      payment_status: 'success',
      accounting_status: 'recorded',
      tx_id: 'ab'.repeat(32),
      audit_hash: 'cd'.repeat(32),
    },
  });
});

test('pay-merchant-live settles a real 402 flow and records the spend', async () => {
  const calls = [];
  const paymentRequired = {
    x402Version: 2,
    resource: {
      url: 'http://127.0.0.1:4021/api/premium-data',
      description: 'SAT-FLOW merchant premium data',
    },
    accepts: [
      {
        scheme: 'exact',
        network: 'stacks:2147483648',
        amount: '1000000',
        asset: 'STX',
        payTo: 'ST3535KR5FDP54HB46XAR359YS8STTS0K2SAKN3X4',
        maxTimeoutSeconds: 300,
      },
    ],
  };
  const paymentRequiredHeader = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
  const paymentResponse = {
    success: true,
    payer: 'ST2FY55DK4NESNH6E5CJSNZP2CQ5PZ5BX65KWG39S',
    transaction: '0x' + 'ab'.repeat(32),
    network: 'stacks:2147483648',
  };
  const paymentResponseHeader = Buffer.from(JSON.stringify(paymentResponse)).toString('base64');
  const fetchImpl = async (_url, options = {}) => {
    if (!options.headers) {
      return new Response(JSON.stringify(paymentRequired), {
        status: 402,
        headers: new Headers({
          'content-type': 'application/json',
          'payment-required': paymentRequiredHeader,
        }),
      });
    }

    calls.push({
      type: 'merchantRetry',
      paymentSignature: options.headers['payment-signature'],
    });
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          report: 'Stacks x402 merchant control path is live.',
        },
      }),
      {
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
          'payment-response': paymentResponseHeader,
        }),
      }
    );
  };

  const result = await runCli(
    ['node', 'sat-flow', 'pay-merchant-live', 'http://127.0.0.1:4021/api/premium-data'],
    {
      SAT_FLOW_FACILITATOR_URL: 'http://localhost:8089',
    },
    {
      fetchImpl,
      liveClient: {
        tokenAdapters: {
          STX: {
            async signPayment(input) {
              calls.push({ type: 'signPayment', input });
              return { signedTransaction: 'deadbeef' };
            },
          },
        },
        vaultAdapter: {
          async recordSpend(input) {
            calls.push({ type: 'recordSpend', input });
            return { ok: true };
          },
        },
        async checkAllowance(input) {
          calls.push({ type: 'checkAllowance', input });
          return {
            remaining: '5000000',
            reset_at_block: 0,
            is_paused: false,
            is_recipient_allowed: true,
          };
        },
      },
    }
  );

  assert.equal(calls[0].type, 'checkAllowance');
  assert.equal(calls[0].input.token, 'STX');
  assert.equal(calls[1].type, 'signPayment');
  assert.equal(calls[2].type, 'merchantRetry');
  assert.equal(calls[3].type, 'recordSpend');
  assert.equal(calls[3].input.paymentTxId, '0x' + 'ab'.repeat(32));
  assert.deepEqual(result.result, {
    payment_status: 'success',
    accounting_status: 'recorded',
    tx_id: '0x' + 'ab'.repeat(32),
    audit_hash: result.result.audit_hash,
  });
  assert.equal(result.payment_response.transaction, '0x' + 'ab'.repeat(32));
});

test('runMerchantPaymentLive short-circuits when recipient is not whitelisted', async () => {
  const paymentRequired = {
    x402Version: 2,
    resource: {
      url: 'http://127.0.0.1:4021/api/premium-data',
      description: 'SAT-FLOW merchant premium data',
    },
    accepts: [
      {
        scheme: 'exact',
        network: 'stacks:2147483648',
        amount: '1000000',
        asset: 'STX',
        payTo: 'ST3535KR5FDP54HB46XAR359YS8STTS0K2SAKN3X4',
        maxTimeoutSeconds: 300,
      },
    ],
  };
  const fetchImpl = async () =>
    new Response(JSON.stringify(paymentRequired), {
      status: 402,
      headers: new Headers({
        'content-type': 'application/json',
        'payment-required': Buffer.from(JSON.stringify(paymentRequired)).toString('base64'),
      }),
    });

  const result = await runMerchantPaymentLive({
    client: {
      tokenAdapters: {},
      vaultAdapter: {},
      async checkAllowance() {
        return {
          remaining: '5000000',
          reset_at_block: 0,
          is_paused: false,
          is_recipient_allowed: false,
        };
      },
    },
    resourceUrl: 'http://127.0.0.1:4021/api/premium-data',
    justification: 'Need the premium dataset to finish the report.',
    facilitatorUrl: 'http://localhost:8089',
    fetchImpl,
  });

  assert.deepEqual(result.result, {
    payment_status: 'failed',
    accounting_status: 'skipped',
    audit_hash: '',
    error: 'recipient_not_whitelisted',
  });
});

test('show-account-live reports the derived live signer account from a seed phrase', async () => {
  const result = await runCli(
    ['node', 'sat-flow', 'show-account-live'],
    {
      SAT_FLOW_NETWORK: 'testnet',
      SAT_FLOW_SEED_PHRASE:
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      SAT_FLOW_ACCOUNT_INDEX: '2',
      SAT_FLOW_VAULT_CONTRACT: 'ST123.sat-flow-vault',
      SAT_FLOW_FACILITATOR_URL: 'https://facilitator.test',
    }
  );

  assert.deepEqual(result, {
    address: 'ST28B7Q9N0NDJSRTGXRWF53B5M08BEV7G33N4VYGD',
    network: 'testnet',
    signer_source: 'seed-phrase',
    account_index: 2,
  });
});

test('faucet-mock-usdcx-live broadcasts a faucet contract call', async () => {
  const calls = [];
  const result = await runCli(
    ['node', 'sat-flow', 'faucet-mock-usdcx-live', '1000000'],
    {
      SAT_FLOW_NETWORK: 'testnet',
      SAT_FLOW_SEED_PHRASE:
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      SAT_FLOW_USDCX_CONTRACT: 'ST123.mock-usdcx',
    },
    {
      makeTokenCall: async request => {
        calls.push({ type: 'makeCall', request });
        return { txid: 'ignored', serialize: () => Buffer.from('deadbeef', 'hex') };
      },
      broadcast: async () => ({ txid: 'ab'.repeat(32) }),
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.txid, 'ab'.repeat(32));
  assert.equal(calls[0].request.functionName, 'faucet');
});

test('mint-mock-usdcx-live resolves recipient and broadcasts a mint contract call', async () => {
  const calls = [];
  const result = await runCli(
    ['node', 'sat-flow', 'mint-mock-usdcx-live', '1000000', 'merchant.btc'],
    {
      SAT_FLOW_NETWORK: 'testnet',
      SAT_FLOW_SEED_PHRASE:
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      SAT_FLOW_VAULT_CONTRACT: 'ST123.sat-flow-vault',
      SAT_FLOW_USDCX_CONTRACT: 'ST123.mock-usdcx',
      SAT_FLOW_FACILITATOR_URL: 'https://facilitator.test',
    },
    {
      liveClient: {
        async resolveIdentity(nameOrPrincipal) {
          assert.equal(nameOrPrincipal, 'merchant.btc');
          return 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG';
        },
      },
      makeTokenCall: async request => {
        calls.push({ type: 'makeCall', request });
        return { txid: 'ignored', serialize: () => Buffer.from('deadbeef', 'hex') };
      },
      broadcast: async () => ({ txid: 'cd'.repeat(32) }),
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.txid, 'cd'.repeat(32));
  assert.equal(calls[0].request.functionName, 'mint');
});
