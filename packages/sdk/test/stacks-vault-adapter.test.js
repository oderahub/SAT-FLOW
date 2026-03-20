import test from 'node:test';
import assert from 'node:assert/strict';

import { responseOkCV, uintCV, boolCV, principalCV } from '@stacks/transactions';

import { StacksVaultAdapter } from '../src/index.js';

test('StacksVaultAdapter checkAllowance aggregates read-only calls', async () => {
  const calls = [];
  const adapter = new StacksVaultAdapter({
    contractId: 'ST123.sat-flow-vault',
    senderAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
    senderKey: 'unused',
    network: 'testnet',
    readOnly: async ({ functionName, functionArgs }) => {
      calls.push({ functionName, functionArgs });
      switch (functionName) {
        case 'get-remaining-allowance':
          return responseOkCV(uintCV(4500));
        case 'get-reset-at-block':
          return responseOkCV(uintCV(288));
        case 'is-paused':
          return responseOkCV(boolCV(false));
        case 'is-recipient-whitelisted':
          return responseOkCV(boolCV(true));
        default:
          throw new Error(`Unexpected readonly call: ${functionName}`);
      }
    },
  });

  const result = await adapter.checkAllowance({
    token: 'USDCX',
    recipient: 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG',
  });

  assert.deepEqual(result, {
    remaining: '4500',
    reset_at_block: 288,
    is_paused: false,
    is_recipient_allowed: true,
  });
  assert.deepEqual(
    calls.map(call => call.functionName),
    [
      'get-remaining-allowance',
      'get-reset-at-block',
      'is-paused',
      'is-recipient-whitelisted',
    ]
  );
});

test('StacksVaultAdapter recordSpend builds and broadcasts a contract call', async () => {
  const built = [];
  const broadcasts = [];
  const adapter = new StacksVaultAdapter({
    contractId: 'ST123.sat-flow-vault',
    senderAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
    senderKey: 'test-private-key',
    network: 'testnet',
    makeCall: async options => {
      built.push(options);
      return { kind: 'contract-call' };
    },
    broadcast: async ({ transaction }) => {
      broadcasts.push(transaction);
      return { txid: 'fe'.repeat(32) };
    },
  });

  const result = await adapter.recordSpend({
    token: 'STX',
    amount: '1000',
    recipient: 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG',
    paymentTxId: 'ab'.repeat(32),
    reasoningHash: Buffer.alloc(32, 0xcd),
  });

  assert.equal(result.ok, true);
  assert.equal(result.txid, 'fe'.repeat(32));
  assert.equal(built.length, 1);
  assert.equal(built[0].functionName, 'record-spend');
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].kind, 'contract-call');
});

test('StacksVaultAdapter setAuthorizedAgent builds and broadcasts an admin call', async () => {
  const built = [];
  const broadcasts = [];
  const adapter = new StacksVaultAdapter({
    contractId: 'ST123.sat-flow-vault',
    senderAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
    senderKey: 'test-private-key',
    network: 'testnet',
    makeCall: async options => {
      built.push(options);
      return { kind: 'set-authorized-agent' };
    },
    broadcast: async ({ transaction }) => {
      broadcasts.push(transaction);
      return { txid: 'aa'.repeat(32) };
    },
  });

  const result = await adapter.setAuthorizedAgent('ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG');

  assert.equal(result.txid, 'aa'.repeat(32));
  assert.equal(built[0].functionName, 'set-authorized-agent');
  assert.equal(broadcasts[0].kind, 'set-authorized-agent');
});

test('StacksVaultAdapter setDailyCap builds and broadcasts an admin call', async () => {
  const built = [];
  const adapter = new StacksVaultAdapter({
    contractId: 'ST123.sat-flow-vault',
    senderAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
    senderKey: 'test-private-key',
    network: 'testnet',
    makeCall: async options => {
      built.push(options);
      return { kind: 'set-daily-cap' };
    },
    broadcast: async () => ({ txid: 'bb'.repeat(32) }),
  });

  const result = await adapter.setDailyCap({ token: 'USDCX', cap: '5000000' });

  assert.equal(result.txid, 'bb'.repeat(32));
  assert.equal(built[0].functionName, 'set-daily-cap');
});

test('StacksVaultAdapter setRecipientWhitelist builds and broadcasts an admin call', async () => {
  const built = [];
  const adapter = new StacksVaultAdapter({
    contractId: 'ST123.sat-flow-vault',
    senderAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
    senderKey: 'test-private-key',
    network: 'testnet',
    makeCall: async options => {
      built.push(options);
      return { kind: 'set-recipient-whitelist' };
    },
    broadcast: async () => ({ txid: 'cc'.repeat(32) }),
  });

  const result = await adapter.setRecipientWhitelist({
    recipient: 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG',
    allowed: true,
  });

  assert.equal(result.txid, 'cc'.repeat(32));
  assert.equal(built[0].functionName, 'set-recipient-whitelist');
});
