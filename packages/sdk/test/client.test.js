import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeX402Challenge } from '../../shared/src/index.js';
import {
  MemoryTokenAdapter,
  MemoryVaultAdapter,
  SatFlowClient,
  StaticIdentityAdapter,
} from '../src/index.js';

test('payBill returns recorded accounting status on success', async () => {
  const vault = new MemoryVaultAdapter();
  vault.setAllowance('USDCX', '2000000');
  vault.allowRecipient('ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P');

  const client = new SatFlowClient({
    vaultAdapter: vault,
    tokenAdapters: {
      USDCX: new MemoryTokenAdapter({
        txId: 'ab'.repeat(32),
      }),
    },
    identityAdapter: new StaticIdentityAdapter(),
  });

  const challenge = normalizeX402Challenge({
    resource: 'https://merchant.test/invoice',
    amount: '1050000',
    token: 'USDCX',
    recipient: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
    facilitatorUrl: 'https://facilitator.test',
    network: 'testnet',
  });

  const result = await client.payBill({
    amount: '1050000',
    recipient: challenge.recipient,
    justification: 'Need this dataset for Q3 market analysis.',
    x402Challenge: challenge,
  });

  assert.equal(result.payment_status, 'success');
  assert.equal(result.accounting_status, 'recorded');
  assert.equal(result.tx_id, 'ab'.repeat(32));
  assert.equal(vault.state.records.length, 1);
});

test('payBill skips accounting when allowance is insufficient', async () => {
  const vault = new MemoryVaultAdapter();
  vault.setAllowance('USDCX', '100');
  vault.allowRecipient('ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P');

  const client = new SatFlowClient({
    vaultAdapter: vault,
    tokenAdapters: {
      USDCX: new MemoryTokenAdapter(),
    },
    identityAdapter: new StaticIdentityAdapter(),
  });

  const challenge = normalizeX402Challenge({
    url: 'https://merchant.test/invoice',
    amount: '101',
    token: 'USDCX',
    recipient: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
    facilitatorUrl: 'https://facilitator.test',
    network: 'testnet',
  });

  const result = await client.payBill({
    amount: '101',
    recipient: challenge.recipient,
    justification: 'Need this dataset for Q3 market analysis.',
    x402Challenge: challenge,
  });

  assert.equal(result.payment_status, 'failed');
  assert.equal(result.accounting_status, 'skipped');
});
