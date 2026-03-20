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

test('mock-usdcx faucet mints to the caller', async () => {
  const simnet = await initSimnet(manifestPath, true);
  const accounts = simnet.getAccounts();
  const wallet1 = accounts.get('wallet_1');

  expectOkTrue(
    simnet.callPublicFn('mock-usdcx', 'faucet', [Cl.uint(1000000)], wallet1).result
  );

  const balance = simnet.callReadOnlyFn(
    'mock-usdcx',
    'get-balance',
    [Cl.principal(wallet1)],
    wallet1
  );

  assert.equal(balance.result.type, 'ok');
  assert.equal(balance.result.value.type, 'uint');
  assert.equal(balance.result.value.value, 1000000n);
});

test('mock-usdcx owner can mint and non-owner cannot', async () => {
  const simnet = await initSimnet(manifestPath, true);
  const accounts = simnet.getAccounts();
  const deployer = accounts.get('deployer');
  const wallet1 = accounts.get('wallet_1');
  const wallet2 = accounts.get('wallet_2');

  expectOkTrue(
    simnet.callPublicFn(
      'mock-usdcx',
      'mint',
      [Cl.uint(500000), Cl.principal(wallet1)],
      deployer
    ).result
  );

  const rejected = simnet.callPublicFn(
    'mock-usdcx',
    'mint',
    [Cl.uint(500000), Cl.principal(wallet2)],
    wallet1
  );
  expectErrCode(rejected.result, 100);
});
