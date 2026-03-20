import fs from 'node:fs';
import path from 'node:path';

import { loadDotEnv } from '../packages/cli/src/dotenv.js';

function getRequiredEnv(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function quoteTomlString(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

loadDotEnv();

const mnemonic = getRequiredEnv(process.env, 'SAT_FLOW_SEED_PHRASE');
const outputPath = path.join(
  process.cwd(),
  'packages',
  'contracts',
  'settings',
  'Testnet.toml'
);

const fileContents = `[network]
name = "testnet"

[accounts.deployer]
mnemonic = ${quoteTomlString(mnemonic)}
balance = 100_000_000_000_000
sbtc_balance = 1_000_000_000
`;

fs.writeFileSync(outputPath, fileContents, 'utf8');
process.stdout.write(`Wrote ${outputPath}\n`);
