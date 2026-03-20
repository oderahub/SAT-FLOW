import test from 'node:test';
import assert from 'node:assert/strict';

import { initSimnet } from '@stacks/clarinet-sdk';
import { Cl } from '@stacks/transactions';

const manifestPath = './packages/contracts/Clarinet.toml';

function expectOkTrue(result) {
  assert.equal(result.type, 'ok');
  assert.equal(result.value.type, 'true');
}

function expectErrCode(result, code) {
  assert.equal(result.type, 'err');
  assert.equal(result.value.type, 'uint');
  assert.equal(result.value.value, BigInt(code));
}

function expectOkUint(result, value) {
  assert.equal(result.type, 'ok');
  assert.equal(result.value.type, 'uint');
  assert.equal(result.value.value, BigInt(value));
}

test('owner can configure caps and whitelist; agent can record spend once', async () => {
  const simnet = await initSimnet(manifestPath, true);
  const accounts = simnet.getAccounts();
  const owner = accounts.get('deployer');
  const wallet1 = accounts.get('wallet_1');
  const wallet2 = accounts.get('wallet_2');

  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-authorized-agent',
      [Cl.principal(wallet1)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-daily-cap',
      [Cl.uint(1), Cl.uint(5000)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-recipient-whitelist',
      [Cl.principal(wallet2), Cl.bool(true)],
      owner
    ).result
  );

  const spend = simnet.callPublicFn(
    'sat-flow-vault',
    'record-spend',
    [
      Cl.uint(1),
      Cl.uint(1000),
      Cl.principal(wallet2),
      Cl.bufferFromHex('ab'.repeat(32)),
      Cl.bufferFromHex('cd'.repeat(32)),
    ],
    wallet1
  );
  expectOkTrue(spend.result);

  const remaining = simnet.callReadOnlyFn(
    'sat-flow-vault',
    'get-remaining-allowance',
    [Cl.uint(1)],
    owner
  );
  assert.equal(remaining.result.type, 'ok');
  assert.equal(remaining.result.value.type, 'uint');
  assert.equal(remaining.result.value.value, 4000n);
});

test('duplicate payment txids are rejected', async () => {
  const simnet = await initSimnet(manifestPath, true);
  const accounts = simnet.getAccounts();
  const owner = accounts.get('deployer');
  const wallet1 = accounts.get('wallet_1');
  const wallet2 = accounts.get('wallet_2');
  const paymentTxId = Cl.bufferFromHex('ee'.repeat(32));
  const reasoningHash = Cl.bufferFromHex('ff'.repeat(32));

  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-authorized-agent',
      [Cl.principal(wallet1)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-daily-cap',
      [Cl.uint(0), Cl.uint(10000)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-recipient-whitelist',
      [Cl.principal(wallet2), Cl.bool(true)],
      owner
    ).result
  );

  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'record-spend',
      [Cl.uint(0), Cl.uint(1000), Cl.principal(wallet2), paymentTxId, reasoningHash],
      wallet1
    ).result
  );

  const duplicate = simnet.callPublicFn(
    'sat-flow-vault',
    'record-spend',
    [Cl.uint(0), Cl.uint(1000), Cl.principal(wallet2), paymentTxId, reasoningHash],
    wallet1
  );
  expectErrCode(duplicate.result, 104);
});

test('invalid token ids are rejected', async () => {
  const simnet = await initSimnet(manifestPath, true);
  const accounts = simnet.getAccounts();
  const owner = accounts.get('deployer');

  const invalid = simnet.callPublicFn(
    'sat-flow-vault',
    'set-daily-cap',
    [Cl.uint(99), Cl.uint(1000)],
    owner
  );

  expectErrCode(invalid.result, 105);
});

test('paused vault rejects record-spend', async () => {
  const simnet = await initSimnet(manifestPath, true);
  const accounts = simnet.getAccounts();
  const owner = accounts.get('deployer');
  const wallet1 = accounts.get('wallet_1');
  const wallet2 = accounts.get('wallet_2');

  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-authorized-agent',
      [Cl.principal(wallet1)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-daily-cap',
      [Cl.uint(1), Cl.uint(5000)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-recipient-whitelist',
      [Cl.principal(wallet2), Cl.bool(true)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-paused',
      [Cl.bool(true)],
      owner
    ).result
  );

  const pausedSpend = simnet.callPublicFn(
    'sat-flow-vault',
    'record-spend',
    [
      Cl.uint(1),
      Cl.uint(1000),
      Cl.principal(wallet2),
      Cl.bufferFromHex('11'.repeat(32)),
      Cl.bufferFromHex('22'.repeat(32)),
    ],
    wallet1
  );

  expectErrCode(pausedSpend.result, 102);
});

test('non-whitelisted recipient rejects record-spend', async () => {
  const simnet = await initSimnet(manifestPath, true);
  const accounts = simnet.getAccounts();
  const owner = accounts.get('deployer');
  const wallet1 = accounts.get('wallet_1');
  const wallet2 = accounts.get('wallet_2');

  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-authorized-agent',
      [Cl.principal(wallet1)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-daily-cap',
      [Cl.uint(1), Cl.uint(5000)],
      owner
    ).result
  );

  const rejected = simnet.callPublicFn(
    'sat-flow-vault',
    'record-spend',
    [
      Cl.uint(1),
      Cl.uint(1000),
      Cl.principal(wallet2),
      Cl.bufferFromHex('33'.repeat(32)),
      Cl.bufferFromHex('44'.repeat(32)),
    ],
    wallet1
  );

  expectErrCode(rejected.result, 103);
});

test('non-agent caller is rejected', async () => {
  const simnet = await initSimnet(manifestPath, true);
  const accounts = simnet.getAccounts();
  const owner = accounts.get('deployer');
  const wallet1 = accounts.get('wallet_1');
  const wallet2 = accounts.get('wallet_2');

  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-authorized-agent',
      [Cl.principal(wallet1)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-daily-cap',
      [Cl.uint(1), Cl.uint(5000)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-recipient-whitelist',
      [Cl.principal(wallet2), Cl.bool(true)],
      owner
    ).result
  );

  const unauthorized = simnet.callPublicFn(
    'sat-flow-vault',
    'record-spend',
    [
      Cl.uint(1),
      Cl.uint(1000),
      Cl.principal(wallet2),
      Cl.bufferFromHex('55'.repeat(32)),
      Cl.bufferFromHex('66'.repeat(32)),
    ],
    owner
  );

  expectErrCode(unauthorized.result, 101);
});

test('per-token accounting remains isolated', async () => {
  const simnet = await initSimnet(manifestPath, true);
  const accounts = simnet.getAccounts();
  const owner = accounts.get('deployer');
  const wallet1 = accounts.get('wallet_1');
  const wallet2 = accounts.get('wallet_2');

  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-authorized-agent',
      [Cl.principal(wallet1)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-daily-cap',
      [Cl.uint(0), Cl.uint(3000)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-daily-cap',
      [Cl.uint(1), Cl.uint(5000)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-recipient-whitelist',
      [Cl.principal(wallet2), Cl.bool(true)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'record-spend',
      [
        Cl.uint(1),
        Cl.uint(1000),
        Cl.principal(wallet2),
        Cl.bufferFromHex('77'.repeat(32)),
        Cl.bufferFromHex('88'.repeat(32)),
      ],
      wallet1
    ).result
  );

  const stxRemaining = simnet.callReadOnlyFn(
    'sat-flow-vault',
    'get-remaining-allowance',
    [Cl.uint(0)],
    owner
  );
  const usdcxRemaining = simnet.callReadOnlyFn(
    'sat-flow-vault',
    'get-remaining-allowance',
    [Cl.uint(1)],
    owner
  );

  expectOkUint(stxRemaining.result, 3000);
  expectOkUint(usdcxRemaining.result, 4000);
});

test('allowance resets after 144 blocks', async () => {
  const simnet = await initSimnet(manifestPath, true);
  const accounts = simnet.getAccounts();
  const owner = accounts.get('deployer');
  const wallet1 = accounts.get('wallet_1');
  const wallet2 = accounts.get('wallet_2');

  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-authorized-agent',
      [Cl.principal(wallet1)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-daily-cap',
      [Cl.uint(1), Cl.uint(5000)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'set-recipient-whitelist',
      [Cl.principal(wallet2), Cl.bool(true)],
      owner
    ).result
  );
  expectOkTrue(
    simnet.callPublicFn(
      'sat-flow-vault',
      'record-spend',
      [
        Cl.uint(1),
        Cl.uint(1000),
        Cl.principal(wallet2),
        Cl.bufferFromHex('99'.repeat(32)),
        Cl.bufferFromHex('aa'.repeat(32)),
      ],
      wallet1
    ).result
  );

  simnet.mineEmptyBlocks(144);

  const remaining = simnet.callReadOnlyFn(
    'sat-flow-vault',
    'get-remaining-allowance',
    [Cl.uint(1)],
    owner
  );

  expectOkUint(remaining.result, 5000);
});
