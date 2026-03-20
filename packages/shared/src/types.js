import { NETWORKS, TOKENS } from './constants.js';

export function assertToken(token) {
  if (token !== TOKENS.STX && token !== TOKENS.USDCX) {
    throw new Error(`Unsupported token: ${token}`);
  }
  return token;
}

export function assertNetwork(network) {
  if (
    network !== NETWORKS.DEVNET &&
    network !== NETWORKS.TESTNET &&
    network !== NETWORKS.MAINNET
  ) {
    throw new Error(`Unsupported network: ${network}`);
  }
  return network;
}

export function normalizeAmountString(amount) {
  if (typeof amount !== 'string' || amount.length === 0) {
    throw new Error('Amount must be a non-empty string');
  }
  if (!/^\d+$/.test(amount)) {
    throw new Error(`Amount must be a base-unit integer string: ${amount}`);
  }
  return amount;
}

export function amountToBigInt(amount) {
  return BigInt(normalizeAmountString(amount));
}

export function normalizePrincipal(principal) {
  if (typeof principal !== 'string' || principal.length === 0) {
    throw new Error('Principal must be a non-empty string');
  }
  if (principal.includes('.btc')) {
    throw new Error('BNS names must be resolved before payment');
  }
  return principal;
}
