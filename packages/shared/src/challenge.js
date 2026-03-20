import { NETWORKS, TOKENS } from './constants.js';
import {
  assertNetwork,
  assertToken,
  normalizeAmountString,
  normalizePrincipal,
} from './types.js';

export function normalizeNetwork(network) {
  if (network === 'stacks:1' || network === 'mainnet') {
    return NETWORKS.MAINNET;
  }
  if (network === 'stacks:2147483648' || network === 'testnet') {
    return NETWORKS.TESTNET;
  }
  if (network === 'devnet') {
    return NETWORKS.DEVNET;
  }
  throw new Error(`Unsupported upstream network: ${network}`);
}

export function normalizeX402Challenge(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Challenge payload must be an object');
  }

  const amount =
    typeof raw.amount === 'string'
      ? raw.amount
      : typeof raw.maxAmountRequired === 'string'
        ? raw.maxAmountRequired
        : undefined;
  const token =
    raw.token ?? raw.tokenType ?? raw.asset ?? TOKENS.STX;
  const recipient = raw.recipient ?? raw.payTo;
  const facilitatorUrl = raw.facilitatorUrl ?? raw.facilitator_url ?? raw.facilitator;
  const url = raw.url ?? raw.resource ?? '';
  const network = raw.network;

  return {
    url,
    amount: normalizeAmountString(amount),
    token: assertToken(
      typeof token === 'string' ? token.toUpperCase() : token
    ),
    recipient: normalizePrincipal(recipient),
    facilitatorUrl:
      typeof facilitatorUrl === 'string' && facilitatorUrl.length > 0
        ? facilitatorUrl
        : '',
    network: assertNetwork(normalizeNetwork(network)),
    raw,
  };
}
