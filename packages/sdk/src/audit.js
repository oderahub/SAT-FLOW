import crypto from 'node:crypto';

import {
  MEMO_PREFIX_BYTES,
  MEMO_TOTAL_BYTES,
  REASONING_HASH_BYTES,
} from '../../shared/src/index.js';

export function createReasoningAudit(justification) {
  if (typeof justification !== 'string' || justification.trim().length === 0) {
    throw new Error('Justification must be a non-empty string');
  }

  const reasoningHash = crypto
    .createHash('sha256')
    .update(justification, 'utf8')
    .digest();

  return {
    justification,
    reasoningHash,
    auditHash: reasoningHash.toString('hex'),
  };
}

export function buildSatFlowMemo(reasoningHash) {
  const hashBuffer =
    typeof reasoningHash === 'string'
      ? Buffer.from(reasoningHash, 'hex')
      : Buffer.from(reasoningHash);

  if (hashBuffer.byteLength !== REASONING_HASH_BYTES) {
    throw new Error('Reasoning hash must be 32 bytes');
  }

  const memo = Buffer.concat([MEMO_PREFIX_BYTES, hashBuffer]);
  if (memo.byteLength !== MEMO_TOTAL_BYTES) {
    throw new Error('SAT-FLOW memo must be 34 bytes');
  }

  return memo;
}

export function decodeStacksTxId(txid) {
  const normalized = txid.startsWith('0x') ? txid.slice(2) : txid;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`Invalid Stacks tx id: ${txid}`);
  }
  return Buffer.from(normalized, 'hex');
}
