import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MEMO_PREFIX_HEX,
  normalizeX402Challenge,
  TOKEN_TO_CLARITY,
} from '../src/index.js';

test('normalizeX402Challenge normalizes CAIP-2 testnet payloads', () => {
  const challenge = normalizeX402Challenge({
    resource: 'https://merchant.test/data',
    maxAmountRequired: '10500000',
    tokenType: 'USDCX',
    payTo: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
    facilitatorUrl: 'https://facilitator.test',
    network: 'stacks:2147483648',
  });

  assert.equal(challenge.url, 'https://merchant.test/data');
  assert.equal(challenge.amount, '10500000');
  assert.equal(challenge.token, 'USDCX');
  assert.equal(challenge.network, 'testnet');
});

test('shared constants expose frozen token mapping', () => {
  assert.equal(MEMO_PREFIX_HEX, '5346');
  assert.equal(TOKEN_TO_CLARITY.STX, 0n);
  assert.equal(TOKEN_TO_CLARITY.USDCX, 1n);
});
