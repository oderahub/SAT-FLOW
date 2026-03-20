import {
  amountToBigInt,
  assertToken,
  normalizePrincipal,
} from '../../shared/src/index.js';
import { buildSatFlowMemo, createReasoningAudit } from './audit.js';

export class SatFlowClient {
  constructor({
    vaultAdapter,
    tokenAdapters,
    identityAdapter,
  }) {
    this.vaultAdapter = vaultAdapter;
    this.tokenAdapters = tokenAdapters;
    this.identityAdapter = identityAdapter;
  }

  async resolveIdentity(nameOrPrincipal) {
    return this.identityAdapter.resolveIdentity(nameOrPrincipal);
  }

  async checkAllowance({ vault, token, recipient = 'ST000000000000000000002AMW42H' }) {
    void vault;
    assertToken(token);
    return this.vaultAdapter.checkAllowance({
      token,
      recipient: normalizePrincipal(recipient),
    });
  }

  async payBill({ amount, recipient, justification, x402Challenge }) {
    const challenge = x402Challenge;
    assertToken(challenge.token);

    const normalizedRecipient = normalizePrincipal(recipient);
    if (normalizedRecipient !== challenge.recipient) {
      throw new Error('Recipient must match the normalized challenge recipient');
    }
    if (amountToBigInt(amount) !== amountToBigInt(challenge.amount)) {
      throw new Error('Amount must match the selected x402 challenge');
    }

    const allowance = await this.vaultAdapter.checkAllowance({
      token: challenge.token,
      recipient: normalizedRecipient,
    });

    if (allowance.is_paused) {
      return {
        payment_status: 'failed',
        accounting_status: 'skipped',
        audit_hash: '',
        error: 'vault_paused',
      };
    }

    if (!allowance.is_recipient_allowed) {
      return {
        payment_status: 'failed',
        accounting_status: 'skipped',
        audit_hash: '',
        error: 'recipient_not_whitelisted',
      };
    }

    if (amountToBigInt(allowance.remaining) < amountToBigInt(amount)) {
      return {
        payment_status: 'failed',
        accounting_status: 'skipped',
        audit_hash: '',
        error: 'allowance_exhausted',
      };
    }

    const audit = createReasoningAudit(justification);
    const memo = buildSatFlowMemo(audit.reasoningHash);
    const tokenAdapter = this.tokenAdapters[challenge.token];

    if (!tokenAdapter) {
      throw new Error(`Missing token adapter for ${challenge.token}`);
    }

    try {
      const settlement = await tokenAdapter.signAndSettle({
        challenge,
        memo,
      });

      try {
        await this.vaultAdapter.recordSpend({
          token: challenge.token,
          amount,
          recipient: normalizedRecipient,
          paymentTxId: settlement.txId,
          reasoningHash: audit.reasoningHash,
        });
        return {
          payment_status: 'success',
          accounting_status: 'recorded',
          tx_id: settlement.txId,
          audit_hash: audit.auditHash,
        };
      } catch (error) {
        return {
          payment_status: 'success',
          accounting_status: 'failed',
          tx_id: settlement.txId,
          audit_hash: audit.auditHash,
          error: error instanceof Error ? error.message : 'record_spend_failed',
        };
      }
    } catch (error) {
      return {
        payment_status: 'failed',
        accounting_status: 'skipped',
        audit_hash: audit.auditHash,
        error: error instanceof Error ? error.message : 'payment_failed',
      };
    }
  }
}
