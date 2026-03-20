import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeX402Challenge } from '../../shared/src/index.js';
import {
  X402FacilitatorClient,
  createPaymentPayload,
  createX402Settlement,
  paymentRequirementsFromChallenge,
} from '../src/index.js';

test('paymentRequirementsFromChallenge derives a v2-compatible requirement', () => {
  const challenge = normalizeX402Challenge({
    resource: 'https://merchant.test/invoice',
    amount: '1050000',
    token: 'USDCX',
    recipient: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
    facilitatorUrl: 'https://facilitator.test',
    network: 'testnet',
    accepted: {
      scheme: 'exact',
      asset: 'ST123.usdcx-token',
      maxTimeoutSeconds: 600,
      extra: { invoiceId: 'inv_123' },
    },
  });

  const paymentRequirements = paymentRequirementsFromChallenge(challenge);

  assert.deepEqual(paymentRequirements, {
    scheme: 'exact',
    network: 'stacks:2147483648',
    amount: '1050000',
    asset: 'ST123.usdcx-token',
    payTo: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
    maxTimeoutSeconds: 600,
    extra: { invoiceId: 'inv_123' },
  });
});

test('createPaymentPayload builds an x402 v2 payload from a signed transaction', () => {
  const challenge = normalizeX402Challenge({
    url: 'https://merchant.test/invoice',
    amount: '500',
    token: 'STX',
    recipient: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
    facilitatorUrl: 'https://facilitator.test',
    network: 'mainnet',
  });

  const payload = createPaymentPayload({
    signedTransaction: 'deadbeef',
    challenge,
  });

  assert.deepEqual(payload, {
    x402Version: 2,
    resource: {
      url: 'https://merchant.test/invoice',
    },
    accepted: {
      scheme: 'exact',
      network: 'stacks:1',
      amount: '500',
      asset: 'STX',
      payTo: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
      maxTimeoutSeconds: 300,
    },
    payload: {
      transaction: 'deadbeef',
    },
  });
});

test('X402FacilitatorClient settles through the v2 facilitator endpoint', async () => {
  const calls = [];
  const challenge = normalizeX402Challenge({
    url: 'https://merchant.test/invoice',
    amount: '1050000',
    token: 'USDCX',
    recipient: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
    facilitatorUrl: 'https://facilitator.test/',
    network: 'testnet',
    accepted: {
      asset: 'ST123.usdcx-token',
    },
  });

  const client = new X402FacilitatorClient({
    createVerifier: facilitatorUrl => {
      calls.push({ type: 'createVerifier', facilitatorUrl });
      return {
        async settle(paymentPayload, { paymentRequirements }) {
          calls.push({
            type: 'settle',
            paymentPayload,
            paymentRequirements,
          });
          return {
            success: true,
            payer: 'ST3PAYER',
            transaction: 'ab'.repeat(32),
            network: 'stacks:2147483648',
          };
        },
      };
    },
  });

  const result = await client.settle({
    signedTransaction: 'deadbeef',
    challenge,
  });

  assert.equal(result.txId, 'ab'.repeat(32));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    type: 'createVerifier',
    facilitatorUrl: 'https://facilitator.test',
  });
  assert.deepEqual(calls[1].paymentRequirements, {
    scheme: 'exact',
    network: 'stacks:2147483648',
    amount: '1050000',
    asset: 'ST123.usdcx-token',
    payTo: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
    maxTimeoutSeconds: 300,
  });
  assert.equal(calls[1].paymentPayload.payload.transaction, 'deadbeef');
  assert.equal(calls[1].paymentPayload.x402Version, 2);
});

test('createX402Settlement maps facilitator failures to thrown errors', async () => {
  const challenge = normalizeX402Challenge({
    url: 'https://merchant.test/invoice',
    amount: '500',
    token: 'STX',
    recipient: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
    facilitatorUrl: 'https://facilitator.test',
    network: 'testnet',
  });

  const settle = createX402Settlement({
    client: new X402FacilitatorClient({
      createVerifier: () => ({
        async settle() {
          return {
            success: false,
            errorReason: 'invalid_payload',
            transaction: '',
            network: 'stacks:2147483648',
          };
        },
      }),
    }),
  });

  await assert.rejects(
    () =>
      settle({
        signedTransaction: 'cafebabe',
        challenge,
      }),
    /invalid_payload/
  );
});
