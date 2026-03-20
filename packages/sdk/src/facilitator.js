import { assertNetwork, assertToken } from '../../shared/src/index.js';
import { X402PaymentVerifier as UpstreamX402PaymentVerifier } from 'x402-stacks';

const NETWORK_TO_CAIP2 = {
  devnet: 'stacks:2147483648',
  testnet: 'stacks:2147483648',
  mainnet: 'stacks:1',
};

function trimTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

function assertChallenge(challenge) {
  if (!challenge || typeof challenge !== 'object') {
    throw new Error('x402 challenge must be an object');
  }
  assertToken(challenge.token);
  assertNetwork(challenge.network);
  if (typeof challenge.recipient !== 'string' || challenge.recipient.length === 0) {
    throw new Error('x402 challenge recipient is required');
  }
  if (typeof challenge.amount !== 'string' || challenge.amount.length === 0) {
    throw new Error('x402 challenge amount is required');
  }
  if (typeof challenge.facilitatorUrl !== 'string' || challenge.facilitatorUrl.length === 0) {
    throw new Error('x402 challenge facilitatorUrl is required');
  }
}

function pickRawPaymentRequirement(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  if (raw.accepted && typeof raw.accepted === 'object') {
    return raw.accepted;
  }

  if (raw.paymentRequirements && typeof raw.paymentRequirements === 'object') {
    return raw.paymentRequirements;
  }

  if (Array.isArray(raw.accepts) && raw.accepts.length > 0 && raw.accepts[0] && typeof raw.accepts[0] === 'object') {
    return raw.accepts[0];
  }

  return raw;
}

export function assetFromChallenge(challenge) {
  const rawPaymentRequirement = pickRawPaymentRequirement(challenge.raw);
  const rawAsset = rawPaymentRequirement.asset;

  if (typeof rawAsset === 'string' && rawAsset.length > 0) {
    return rawAsset;
  }

  return challenge.token;
}

export function paymentRequirementsFromChallenge(challenge) {
  assertChallenge(challenge);

  const rawPaymentRequirement = pickRawPaymentRequirement(challenge.raw);

  return {
    scheme:
      typeof rawPaymentRequirement.scheme === 'string' && rawPaymentRequirement.scheme.length > 0
        ? rawPaymentRequirement.scheme
        : 'exact',
    network: NETWORK_TO_CAIP2[challenge.network],
    amount: challenge.amount,
    asset: assetFromChallenge(challenge),
    payTo: challenge.recipient,
    maxTimeoutSeconds:
      typeof rawPaymentRequirement.maxTimeoutSeconds === 'number'
        ? rawPaymentRequirement.maxTimeoutSeconds
        : 300,
    ...(rawPaymentRequirement.extra && typeof rawPaymentRequirement.extra === 'object'
      ? { extra: rawPaymentRequirement.extra }
      : {}),
  };
}

export function createPaymentPayload({ signedTransaction, challenge }) {
  if (typeof signedTransaction !== 'string' || signedTransaction.length === 0) {
    throw new Error('signedTransaction is required');
  }

  const paymentRequirements = paymentRequirementsFromChallenge(challenge);
  const payload = UpstreamX402PaymentVerifier.createPaymentPayload(
    signedTransaction,
    paymentRequirements
  );

  if (typeof challenge.url === 'string' && challenge.url.length > 0) {
    payload.resource = { url: challenge.url };
  }

  return payload;
}

export class X402FacilitatorClient {
  constructor({
    createVerifier = facilitatorUrl => new UpstreamX402PaymentVerifier(facilitatorUrl),
  } = {}) {
    this.createVerifier = createVerifier;
    this.verifiers = new Map();
  }

  async verify({ signedTransaction, challenge }) {
    const paymentRequirements = paymentRequirementsFromChallenge(challenge);
    const paymentPayload = createPaymentPayload({ signedTransaction, challenge });
    const verifier = this.#getVerifier(challenge.facilitatorUrl);
    return verifier.verify(paymentPayload, { paymentRequirements });
  }

  async settle({ signedTransaction, challenge }) {
    const paymentRequirements = paymentRequirementsFromChallenge(challenge);
    const paymentPayload = createPaymentPayload({ signedTransaction, challenge });
    const verifier = this.#getVerifier(challenge.facilitatorUrl);
    const response = await verifier.settle(paymentPayload, { paymentRequirements });
    if (!response.success) {
      throw new Error(response.errorReason || 'x402 settlement failed');
    }
    if (typeof response.transaction !== 'string' || response.transaction.length === 0) {
      throw new Error('x402 settlement response did not include a transaction id');
    }
    return {
      txId: response.transaction,
      payer: response.payer,
      network: response.network,
    };
  }

  #getVerifier(facilitatorUrl) {
    const baseUrl = trimTrailingSlash(facilitatorUrl);
    if (!this.verifiers.has(baseUrl)) {
      this.verifiers.set(baseUrl, this.createVerifier(baseUrl));
    }
    return this.verifiers.get(baseUrl);
  }
}

export function createX402Settlement({ client = new X402FacilitatorClient() } = {}) {
  return async ({ signedTransaction, challenge }) => client.settle({ signedTransaction, challenge });
}
