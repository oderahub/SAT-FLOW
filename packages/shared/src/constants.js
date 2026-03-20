export const TOKENS = Object.freeze({
  STX: 'STX',
  USDCX: 'USDCX',
});

export const NETWORKS = Object.freeze({
  DEVNET: 'devnet',
  TESTNET: 'testnet',
  MAINNET: 'mainnet',
});

export const TOKEN_TO_CLARITY = Object.freeze({
  STX: 0n,
  USDCX: 1n,
});

export const MEMO_PREFIX_HEX = '5346';
export const MEMO_PREFIX_BYTES = Buffer.from(MEMO_PREFIX_HEX, 'hex');
export const MEMO_TOTAL_BYTES = 34;
export const REASONING_HASH_BYTES = 32;
export const ROLLING_DAILY_RESET_BLOCKS = 144;
