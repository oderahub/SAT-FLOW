import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeX402Challenge } from '../../shared/src/index.js';
import { MemoryTokenAdapter, MemoryVaultAdapter, SatFlowClient, StaticIdentityAdapter } from '../../sdk/src/index.js';
import { createMcpHandlers } from '../src/index.js';

test('MCP pay_bill delegates to the SDK', async () => {
  const vault = new MemoryVaultAdapter();
  vault.setAllowance('STX', '2000');
  vault.allowRecipient('ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P');

  const client = new SatFlowClient({
    vaultAdapter: vault,
    tokenAdapters: { STX: new MemoryTokenAdapter({ txId: 'cd'.repeat(32) }) },
    identityAdapter: new StaticIdentityAdapter(),
  });

  const handlers = createMcpHandlers(client);
  const challenge = normalizeX402Challenge({
    url: 'https://merchant.test/invoice',
    amount: '1000',
    token: 'STX',
    recipient: 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P',
    facilitatorUrl: 'https://facilitator.test',
    network: 'testnet',
  });

  const result = await handlers.pay_bill({
    amount: '1000',
    recipient: challenge.recipient,
    justification: 'Need to complete the report.',
    x402_challenge: challenge,
  });

  assert.equal(result.payment_status, 'success');
  assert.equal(result.accounting_status, 'recorded');
});
