import test from 'node:test';
import assert from 'node:assert/strict';

import { StacksSip10TokenAdapter, StacksStxTokenAdapter } from '../src/index.js';

test('StacksSip10TokenAdapter builds and settles a SIP-010 transfer', async () => {
  const built = [];
  const settled = [];

  const adapter = new StacksSip10TokenAdapter({
    senderKey: 'test-private-key',
    senderAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
    network: 'testnet',
    tokenContract: 'ST123.usdcx-token',
    makeCall: async options => {
      built.push(options);
      return {
        serialize() {
          return Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
        },
      };
    },
    settle: async payload => {
      settled.push(payload);
      return { txId: 'ab'.repeat(32) };
    },
  });

  const result = await adapter.signAndSettle({
    challenge: {
      token: 'USDCX',
      amount: '1050000',
      recipient: 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG',
    },
    memo: Buffer.alloc(34, 0xcd),
  });

  assert.equal(result.txId, 'ab'.repeat(32));
  assert.equal(built.length, 1);
  assert.equal(built[0].functionName, 'transfer');
  assert.equal(settled.length, 1);
  assert.equal(settled[0].signedTransaction, 'deadbeef');
});

test('StacksSip10TokenAdapter preserves hex-string serialization output', async () => {
  const adapter = new StacksSip10TokenAdapter({
    senderKey: 'test-private-key',
    senderAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
    network: 'testnet',
    tokenContract: 'ST123.usdcx-token',
    makeCall: async () => ({
      serialize() {
        return 'deadbeef';
      },
    }),
    settle: async payload => ({ txId: payload.signedTransaction }),
  });

  const result = await adapter.signAndSettle({
    challenge: {
      token: 'USDCX',
      amount: '1050000',
      recipient: 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG',
    },
    memo: Buffer.alloc(34, 0xcd),
  });

  assert.equal(result.txId, 'deadbeef');
});

test('StacksStxTokenAdapter builds and settles a signed STX transfer', async () => {
  const built = [];
  const settled = [];

  const adapter = new StacksStxTokenAdapter({
    senderKey: 'test-private-key',
    network: 'testnet',
    memoEncoder: () => 'SF' + 'a'.repeat(32),
    makeTransfer: async options => {
      built.push(options);
      return {
        serialize() {
          return Uint8Array.from([0xca, 0xfe, 0xba, 0xbe]);
        },
      };
    },
    settle: async payload => {
      settled.push(payload);
      return { txId: 'cd'.repeat(32) };
    },
  });

  const result = await adapter.signAndSettle({
    challenge: {
      token: 'STX',
      amount: '1000',
      recipient: 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG',
    },
    memo: Buffer.alloc(34, 0xab),
  });

  assert.equal(result.txId, 'cd'.repeat(32));
  assert.equal(built.length, 1);
  assert.equal(built[0].recipient, 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG');
  assert.equal(settled.length, 1);
  assert.equal(settled[0].signedTransaction, 'cafebabe');
});

test('StacksStxTokenAdapter preserves hex-string serialization output', async () => {
  const adapter = new StacksStxTokenAdapter({
    senderKey: 'test-private-key',
    network: 'testnet',
    memoEncoder: () => 'SF' + 'a'.repeat(32),
    makeTransfer: async () => ({
      serialize() {
        return 'cafebabe';
      },
    }),
    settle: async payload => ({ txId: payload.signedTransaction }),
  });

  const result = await adapter.signAndSettle({
    challenge: {
      token: 'STX',
      amount: '1000',
      recipient: 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG',
    },
    memo: Buffer.alloc(34, 0xab),
  });

  assert.equal(result.txId, 'cafebabe');
});

test('StacksStxTokenAdapter requires an explicit memo strategy', async () => {
  const adapter = new StacksStxTokenAdapter({
    senderKey: 'test-private-key',
    network: 'testnet',
    makeTransfer: async () => {
      throw new Error('should not build');
    },
  });

  await assert.rejects(
    () =>
      adapter.signAndSettle({
        challenge: {
          token: 'STX',
          amount: '1000',
          recipient: 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG',
        },
        memo: Buffer.alloc(34, 0xab),
      }),
    /explicit strategy/
  );
});
