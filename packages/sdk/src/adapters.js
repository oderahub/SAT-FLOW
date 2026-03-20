import {
  TOKEN_TO_CLARITY,
  amountToBigInt,
  assertNetwork,
  assertToken,
  normalizeAmountString,
  normalizePrincipal,
} from '../../shared/src/index.js';
import { BNS_CONTRACT_NAME } from '@stacks/bns';
import { networkFromName } from '@stacks/network';
import {
  AnchorMode,
  PostConditionMode,
  broadcastTransaction,
  boolCV,
  bufferCVFromString,
  bufferCV,
  ClarityType,
  cvToJSON,
  fetchCallReadOnlyFunction,
  makeContractCall,
  makeSTXTokenTransfer,
  principalCV,
  someCV,
  uintCV,
} from '@stacks/transactions';
import { buildSatFlowMemo, decodeStacksTxId } from './audit.js';

export class MemoryVaultAdapter {
  constructor(initial = {}) {
    this.state = {
      remaining: new Map(),
      paused: false,
      whitelist: new Set(),
      records: [],
      ...initial,
    };
  }

  setAllowance(token, remaining) {
    this.state.remaining.set(token, BigInt(remaining));
  }

  allowRecipient(recipient) {
    this.state.whitelist.add(recipient);
  }

  async checkAllowance({ token, recipient }) {
    normalizePrincipal(recipient);
    return {
      remaining: String(this.state.remaining.get(token) ?? 0n),
      reset_at_block: 0,
      is_paused: this.state.paused,
      is_recipient_allowed: this.state.whitelist.has(recipient),
    };
  }

  async recordSpend({ token, amount, recipient, paymentTxId, reasoningHash }) {
    const amountBigInt = amountToBigInt(amount);
    const txBuffer = decodeStacksTxId(paymentTxId);
    buildSatFlowMemo(reasoningHash);

    this.state.records.push({
      token: TOKEN_TO_CLARITY[token],
      amount: amountBigInt,
      recipient,
      paymentTxId: txBuffer.toString('hex'),
      reasoningHash: Buffer.from(reasoningHash).toString('hex'),
    });

    const current = this.state.remaining.get(token) ?? 0n;
    this.state.remaining.set(token, current - amountBigInt);

    return { ok: true };
  }
}

export class MemoryTokenAdapter {
  constructor({ txId = '0'.repeat(64) } = {}) {
    this.txId = txId;
    this.calls = [];
  }

  async signPayment({ challenge, memo }) {
    this.calls.push({ challenge, memo: Buffer.from(memo).toString('hex') });
    return {
      signedTransaction: this.txId,
      transaction: null,
    };
  }

  async signAndSettle({ challenge, memo }) {
    await this.signPayment({ challenge, memo });
    return { txId: this.txId };
  }
}

function serializeSignedTransaction(transaction) {
  const serialized = transaction.serialize();
  return typeof serialized === 'string' ? serialized : Buffer.from(serialized).toString('hex');
}

function defaultSettlement({ signedTransaction }) {
  return Promise.resolve({ txId: signedTransaction.slice(0, 64) });
}

function assertAsciiMemo(memo) {
  const string = typeof memo === 'string' ? memo : String(memo);
  const bytes = Buffer.from(string, 'utf8');
  if (bytes.length > 34) {
    throw new Error('STX memo must be 34 bytes or less');
  }
  return string;
}

export class StacksStxTokenAdapter {
  constructor({
    senderKey,
    network = 'testnet',
    stacksNetwork,
    makeTransfer = makeSTXTokenTransfer,
    settle = defaultSettlement,
    memoEncoder = () => {
      throw new Error(
        'STX memo encoding for SAT-FLOW requires an explicit strategy; raw 34-byte anchors are not safely representable through the default string memo path'
      );
    },
  }) {
    this.senderKey = senderKey;
    this.networkName = assertNetwork(network);
    this.network = stacksNetwork ?? networkFromName(this.networkName);
    this.makeTransfer = makeTransfer;
    this.settle = settle;
    this.memoEncoder = memoEncoder;
  }

  async signPayment({ challenge, memo }) {
    assertToken(challenge.token);
    if (challenge.token !== 'STX') {
      throw new Error(`StacksStxTokenAdapter cannot handle token ${challenge.token}`);
    }

    const memoString = assertAsciiMemo(this.memoEncoder(memo, challenge));
    const transaction = await this.makeTransfer({
      recipient: challenge.recipient,
      amount: BigInt(challenge.amount),
      senderKey: this.senderKey,
      network: this.network,
      memo: memoString,
      anchorMode: AnchorMode.Any,
    });

    return {
      signedTransaction: serializeSignedTransaction(transaction),
      transaction,
    };
  }

  async signAndSettle({ challenge, memo }) {
    const { signedTransaction, transaction } = await this.signPayment({ challenge, memo });
    return this.settle({
      signedTransaction,
      challenge,
      transaction,
    });
  }
}

export class StacksSip10TokenAdapter {
  constructor({
    senderKey,
    senderAddress,
    network = 'testnet',
    stacksNetwork,
    tokenContract,
    makeCall = makeContractCall,
    settle = defaultSettlement,
  }) {
    this.senderKey = senderKey;
    this.senderAddress = normalizePrincipal(senderAddress);
    this.networkName = assertNetwork(network);
    this.network = stacksNetwork ?? networkFromName(this.networkName);
    this.tokenContract = parseContractId(tokenContract);
    this.makeCall = makeCall;
    this.settle = settle;
  }

  async signPayment({ challenge, memo }) {
    assertToken(challenge.token);
    if (challenge.token !== 'USDCX') {
      throw new Error(`StacksSip10TokenAdapter cannot handle token ${challenge.token}`);
    }

    const transaction = await this.makeCall({
      ...this.tokenContract,
      functionName: 'transfer',
      functionArgs: [
        uintCV(BigInt(challenge.amount)),
        principalCV(this.senderAddress),
        principalCV(challenge.recipient),
        someCV(bufferCV(memo)),
      ],
      senderKey: this.senderKey,
      network: this.network,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Allow,
    });

    return {
      signedTransaction: serializeSignedTransaction(transaction),
      transaction,
    };
  }

  async signAndSettle({ challenge, memo }) {
    const { signedTransaction, transaction } = await this.signPayment({ challenge, memo });
    return this.settle({
      signedTransaction,
      challenge,
      transaction,
    });
  }
}

export class StaticIdentityAdapter {
  async resolveIdentity(nameOrPrincipal) {
    return nameOrPrincipal;
  }
}

const HIRO_API_BASE_URLS = {
  devnet: 'http://localhost:3999',
  testnet: 'https://api.testnet.hiro.so',
  mainnet: 'https://api.hiro.so',
};

function trimTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text ? { error: text } : {};
}

function isBnsName(nameOrPrincipal) {
  return typeof nameOrPrincipal === 'string' && nameOrPrincipal.toLowerCase().endsWith('.btc');
}

function decodeBnsName(nameOrPrincipal) {
  if (!isBnsName(nameOrPrincipal)) {
    throw new Error(`Not a supported BNS name: ${nameOrPrincipal}`);
  }

  const parts = nameOrPrincipal.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Unsupported BNS name format: ${nameOrPrincipal}`);
  }

  return {
    name: parts[0],
    namespace: parts[1],
  };
}

function unwrapResolvedPrincipal(responseCV, nameOrPrincipal) {
  if (responseCV.type === ClarityType.ResponseOk) {
    const json = cvToJSON(responseCV.value);
    if (json.type === 'principal' && typeof json.value === 'string' && json.value.length > 0) {
      return normalizePrincipal(json.value);
    }
  }

  throw new Error(`BNS contract did not resolve ${nameOrPrincipal}`);
}

export class StacksBnsIdentityAdapter {
  constructor({
    network = 'testnet',
    senderAddress = 'ST000000000000000000002AMW42H',
    readOnly = fetchCallReadOnlyFunction,
    stacksNetwork,
  } = {}) {
    this.networkName = assertNetwork(network);
    this.network = stacksNetwork ?? networkFromName(this.networkName);
    this.senderAddress = normalizePrincipal(senderAddress);
    this.readOnly = readOnly;
  }

  async resolveIdentity(nameOrPrincipal) {
    if (!isBnsName(nameOrPrincipal)) {
      return normalizePrincipal(nameOrPrincipal);
    }

    const { namespace, name } = decodeBnsName(nameOrPrincipal);
    const response = await this.readOnly({
      contractAddress: this.network.bootAddress,
      contractName: BNS_CONTRACT_NAME,
      functionName: 'name-resolve',
      functionArgs: [bufferCVFromString(namespace), bufferCVFromString(name)],
      senderAddress: this.senderAddress,
      network: this.network,
    });

    return unwrapResolvedPrincipal(response, nameOrPrincipal);
  }
}

export class HiroBnsIdentityAdapter {
  constructor({
    network = 'testnet',
    apiBaseUrl,
    apiKey,
    fetchImpl = fetch,
  } = {}) {
    this.networkName = assertNetwork(network);
    this.apiBaseUrl = trimTrailingSlash(apiBaseUrl ?? HIRO_API_BASE_URLS[this.networkName]);
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async resolveIdentity(nameOrPrincipal) {
    if (!isBnsName(nameOrPrincipal)) {
      return normalizePrincipal(nameOrPrincipal);
    }

    const response = await this.fetchImpl(
      `${this.apiBaseUrl}/v1/names/${encodeURIComponent(nameOrPrincipal)}`,
      {
        headers: {
          accept: 'application/json',
          ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
        },
      }
    );

    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(
        data.error ||
          data.message ||
          `Failed to resolve BNS name ${nameOrPrincipal}: ${response.status}`
      );
    }

    if (typeof data.address !== 'string' || data.address.length === 0) {
      throw new Error(`BNS resolution for ${nameOrPrincipal} did not return an address`);
    }

    return normalizePrincipal(data.address);
  }
}

export class HybridBnsIdentityAdapter {
  constructor({
    primary = new StacksBnsIdentityAdapter(),
    fallback = new HiroBnsIdentityAdapter(),
  } = {}) {
    this.primary = primary;
    this.fallback = fallback;
  }

  async resolveIdentity(nameOrPrincipal) {
    if (!isBnsName(nameOrPrincipal)) {
      return normalizePrincipal(nameOrPrincipal);
    }

    try {
      return await this.primary.resolveIdentity(nameOrPrincipal);
    } catch {
      return this.fallback.resolveIdentity(nameOrPrincipal);
    }
  }
}

function parseContractId(contractId) {
  const parts = contractId.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid contract identifier: ${contractId}`);
  }
  return {
    contractAddress: parts[0],
    contractName: parts[1],
  };
}

function unwrapReadOnly(cv) {
  const json = cvToJSON(cv);
  if (json.success === false) {
    throw new Error(`Read-only call failed: ${JSON.stringify(json.value)}`);
  }
  return json.value;
}

function toReasoningHashBuffer(reasoningHash) {
  const buffer =
    typeof reasoningHash === 'string'
      ? Buffer.from(reasoningHash, 'hex')
      : Buffer.from(reasoningHash);
  buildSatFlowMemo(buffer);
  return buffer;
}

export class StacksVaultAdapter {
  constructor({
    contractId,
    senderAddress,
    senderKey,
    network = 'testnet',
    stacksNetwork,
    readOnly = fetchCallReadOnlyFunction,
    makeCall = makeContractCall,
    broadcast = broadcastTransaction,
  }) {
    this.contract = parseContractId(contractId);
    this.senderAddress = normalizePrincipal(senderAddress);
    this.senderKey = senderKey;
    this.networkName = assertNetwork(network);
    this.network = stacksNetwork ?? networkFromName(this.networkName);
    this.readOnly = readOnly;
    this.makeCall = makeCall;
    this.broadcast = broadcast;
  }

  async callReadOnly(functionName, functionArgs) {
    return this.readOnly({
      ...this.contract,
      functionName,
      functionArgs,
      senderAddress: this.senderAddress,
      network: this.network,
    });
  }

  async checkAllowance({ token, recipient }) {
    const normalizedToken = assertToken(token);
    const normalizedRecipient = normalizePrincipal(recipient);
    const clarityToken = TOKEN_TO_CLARITY[normalizedToken];

    const [remainingCv, resetAtCv, pausedCv, whitelistCv] = await Promise.all([
      this.callReadOnly('get-remaining-allowance', [uintCV(clarityToken)]),
      this.callReadOnly('get-reset-at-block', [uintCV(clarityToken)]),
      this.callReadOnly('is-paused', []),
      this.callReadOnly('is-recipient-whitelisted', [principalCV(normalizedRecipient)]),
    ]);

    const remaining = unwrapReadOnly(remainingCv);
    const resetAtBlock = unwrapReadOnly(resetAtCv);
    const isPaused = unwrapReadOnly(pausedCv);
    const isRecipientAllowed = unwrapReadOnly(whitelistCv);

    return {
      remaining: normalizeAmountString(remaining.value),
      reset_at_block: Number(resetAtBlock.value),
      is_paused: Boolean(isPaused.value),
      is_recipient_allowed: Boolean(isRecipientAllowed.value),
    };
  }

  async recordSpend({ token, amount, recipient, paymentTxId, reasoningHash }) {
    if (!this.senderKey) {
      throw new Error('senderKey is required for recordSpend');
    }

    const normalizedToken = assertToken(token);
    const normalizedAmount = normalizeAmountString(amount);
    const normalizedRecipient = normalizePrincipal(recipient);
    const paymentTxBuffer = decodeStacksTxId(paymentTxId);
    const reasoningHashBuffer = toReasoningHashBuffer(reasoningHash);

    const transaction = await this.makeCall({
      ...this.contract,
      functionName: 'record-spend',
      functionArgs: [
        uintCV(TOKEN_TO_CLARITY[normalizedToken]),
        uintCV(BigInt(normalizedAmount)),
        principalCV(normalizedRecipient),
        bufferCV(paymentTxBuffer),
        bufferCV(reasoningHashBuffer),
      ],
      senderKey: this.senderKey,
      network: this.network,
    });

    const result = await this.broadcast({
      transaction,
      network: this.network,
    });

    if (!result || typeof result.txid !== 'string') {
      const reason =
        result && typeof result.reason === 'string'
          ? result.reason
          : 'broadcast_failed';
      throw new Error(`recordSpend broadcast failed: ${reason}`);
    }

    return { ok: true, txid: result.txid };
  }

  async setAuthorizedAgent(agent) {
    if (!this.senderKey) {
      throw new Error('senderKey is required for admin calls');
    }

    const transaction = await this.makeCall({
      ...this.contract,
      functionName: 'set-authorized-agent',
      functionArgs: [principalCV(normalizePrincipal(agent))],
      senderKey: this.senderKey,
      network: this.network,
    });

    const result = await this.broadcast({
      transaction,
      network: this.network,
    });

    if (!result || typeof result.txid !== 'string') {
      const reason =
        result && typeof result.reason === 'string'
          ? result.reason
          : 'Failed to broadcast set-authorized-agent transaction';
      throw new Error(reason);
    }

    return { ok: true, txid: result.txid };
  }

  async setDailyCap({ token, cap }) {
    if (!this.senderKey) {
      throw new Error('senderKey is required for admin calls');
    }

    const normalizedToken = assertToken(token);
    const normalizedCap = normalizeAmountString(cap);
    const transaction = await this.makeCall({
      ...this.contract,
      functionName: 'set-daily-cap',
      functionArgs: [uintCV(TOKEN_TO_CLARITY[normalizedToken]), uintCV(BigInt(normalizedCap))],
      senderKey: this.senderKey,
      network: this.network,
    });

    const result = await this.broadcast({
      transaction,
      network: this.network,
    });

    if (!result || typeof result.txid !== 'string') {
      const reason =
        result && typeof result.reason === 'string'
          ? result.reason
          : 'Failed to broadcast set-daily-cap transaction';
      throw new Error(reason);
    }

    return { ok: true, txid: result.txid };
  }

  async setRecipientWhitelist({ recipient, allowed }) {
    if (!this.senderKey) {
      throw new Error('senderKey is required for admin calls');
    }

    const transaction = await this.makeCall({
      ...this.contract,
      functionName: 'set-recipient-whitelist',
      functionArgs: [principalCV(normalizePrincipal(recipient)), boolCV(!!allowed)],
      senderKey: this.senderKey,
      network: this.network,
    });

    const result = await this.broadcast({
      transaction,
      network: this.network,
    });

    if (!result || typeof result.txid !== 'string') {
      const reason =
        result && typeof result.reason === 'string'
          ? result.reason
          : 'Failed to broadcast set-recipient-whitelist transaction';
      throw new Error(reason);
    }

    return { ok: true, txid: result.txid };
  }
}
