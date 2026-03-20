#!/usr/bin/env node

import { loadDotEnv } from './dotenv.js';
import { printJson, runCli } from './runtime.js';

loadDotEnv();

runCli(process.argv).then(printJson).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
