import { normalizeX402Challenge } from '../../shared/src/index.js';
import { networkFromName } from '@stacks/network';
import {
  AnchorMode,
  PostConditionMode,
  broadcastTransaction,
  makeContractCall,
  principalCV,
  uintCV,
} from '@stacks/transactions';
import {
  decodePaymentRequired,
  decodePaymentResponse,
  encodePaymentPayload,
  getDefaultUSDCxContract,
  privateKeyToAccount,
  X402_HEADERS,
} from 'x402-stacks';
import { generateNewAccount, generateWallet, getStxAddress } from '@stacks/wallet-sdk';
import {
  buildSatFlowMemo,
  createReasoningAudit,
  createX402Settlement,
  HybridBnsIdentityAdapter,
  HiroBnsIdentityAdapter,
  MemoryTokenAdapter,
  MemoryVaultAdapter,
  SatFlowClient,
  StacksSip10TokenAdapter,
  StacksStxTokenAdapter,
  StacksVaultAdapter,
  StaticIdentityAdapter,
  paymentRequirementsFromChallenge,
} from '../../sdk/src/index.js';

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function parseArgs(argv) {
  const positionals = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (typeof value === 'string' && value.startsWith('--')) {
      const key = value.slice(2);
      const next = argv[index + 1];
      if (typeof next === 'string' && !next.startsWith('--')) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = 'true';
      }
      continue;
    }
    positionals.push(value);
  }

  return { positionals, flags };
}

function getRequiredEnv(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function createMemoryDemoClient() {
  const vault = new MemoryVaultAdapter();
  const recipient = 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P';
  vault.allowRecipient(recipient);
  vault.setAllowance('USDCX', '50000000');
  vault.setAllowance('STX', '1000000');

  return new SatFlowClient({
    vaultAdapter: vault,
    tokenAdapters: {
      USDCX: new MemoryTokenAdapter({ txId: 'ef'.repeat(32) }),
      STX: new MemoryTokenAdapter({ txId: '12'.repeat(32) }),
    },
    identityAdapter: new StaticIdentityAdapter(),
  });
}

function inferTokenFromAsset(asset) {
  if (typeof asset !== 'string' || asset.length === 0) {
    throw new Error('Merchant 402 response did not specify an asset');
  }

  if (asset === 'STX') {
    return 'STX';
  }

  if (
    asset === 'USDCX' ||
    asset.toLowerCase().endsWith('.usdcx') ||
    asset.toLowerCase().endsWith('.mock-usdcx')
  ) {
    return 'USDCX';
  }

  throw new Error(`Unsupported merchant x402 asset: ${asset}`);
}

function createMerchantChallenge({ paymentRequired, facilitatorUrl }) {
  if (!paymentRequired?.accepts?.length) {
    throw new Error('Merchant did not return any accepted payment requirements');
  }

  const accepted = paymentRequired.accepts[0];
  return normalizeX402Challenge({
    url: paymentRequired.resource?.url ?? '',
    amount: accepted.amount,
    token: inferTokenFromAsset(accepted.asset),
    recipient: accepted.payTo,
    facilitatorUrl,
    network: accepted.network,
    accepted,
  });
}

function encodeStxMerchantMemo(memo) {
  const memoHex = Buffer.from(memo).toString('hex');
  return `satf1:${memoHex.slice(0, 28)}`;
}

async function readFetchJson(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

export async function runMerchantPaymentLive({
  client,
  resourceUrl,
  justification,
  facilitatorUrl,
  fetchImpl = global.fetch,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for pay-merchant-live');
  }

  const initialResponse = await fetchImpl(resourceUrl);
  if (initialResponse.status !== 402) {
    throw new Error(`Merchant did not return 402 Payment Required: ${initialResponse.status}`);
  }

  const paymentRequiredHeader = initialResponse.headers.get(X402_HEADERS.PAYMENT_REQUIRED);
  const paymentRequired = decodePaymentRequired(paymentRequiredHeader);
  if (!paymentRequired?.accepts?.length) {
    throw new Error('Merchant did not return a valid x402 payment request');
  }

  const challenge = createMerchantChallenge({ paymentRequired, facilitatorUrl });
  const allowance = await client.checkAllowance({
    vault: 'live',
    token: challenge.token,
    recipient: challenge.recipient,
  });

  if (allowance.is_paused) {
    return {
      challenge: paymentRequired,
      result: {
        payment_status: 'failed',
        accounting_status: 'skipped',
        audit_hash: '',
        error: 'vault_paused',
      },
    };
  }

  if (!allowance.is_recipient_allowed) {
    return {
      challenge: paymentRequired,
      result: {
        payment_status: 'failed',
        accounting_status: 'skipped',
        audit_hash: '',
        error: 'recipient_not_whitelisted',
      },
    };
  }

  if (BigInt(allowance.remaining) < BigInt(challenge.amount)) {
    return {
      challenge: paymentRequired,
      result: {
        payment_status: 'failed',
        accounting_status: 'skipped',
        audit_hash: '',
        error: 'allowance_exhausted',
      },
    };
  }

  const audit = createReasoningAudit(justification);
  const memo = buildSatFlowMemo(audit.reasoningHash);
  const tokenAdapter = client.tokenAdapters[challenge.token];
  if (!tokenAdapter || typeof tokenAdapter.signPayment !== 'function') {
    throw new Error(`Missing signable token adapter for ${challenge.token}`);
  }

  const { signedTransaction } = await tokenAdapter.signPayment({ challenge, memo });
  const accepted = paymentRequired.accepts[0];
  const paymentSignature = encodePaymentPayload({
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted,
    payload: {
      transaction: signedTransaction,
    },
  });

  const merchantResponse = await fetchImpl(resourceUrl, {
    headers: {
      [X402_HEADERS.PAYMENT_SIGNATURE]: paymentSignature,
    },
  });

  if (merchantResponse.status >= 400) {
    const errorBody = await readFetchJson(merchantResponse);
    return {
      challenge: paymentRequired,
      result: {
        payment_status: 'failed',
        accounting_status: 'skipped',
        audit_hash: audit.auditHash,
        error:
          typeof errorBody === 'string'
            ? errorBody
            : JSON.stringify(errorBody),
      },
    };
  }

  const paymentResponseHeader = merchantResponse.headers.get(X402_HEADERS.PAYMENT_RESPONSE);
  const paymentResponse =
    typeof paymentResponseHeader === 'string' ? decodePaymentResponse(paymentResponseHeader) : null;
  if (!paymentResponse?.transaction) {
    throw new Error('Merchant did not return a valid x402 payment response');
  }

  const merchantData = await readFetchJson(merchantResponse);

  try {
    await client.vaultAdapter.recordSpend({
      token: challenge.token,
      amount: challenge.amount,
      recipient: challenge.recipient,
      paymentTxId: paymentResponse.transaction,
      reasoningHash: audit.reasoningHash,
    });

    return {
      challenge: paymentRequired,
      payment_response: paymentResponse,
      merchant_data: merchantData,
      result: {
        payment_status: 'success',
        accounting_status: 'recorded',
        tx_id: paymentResponse.transaction,
        audit_hash: audit.auditHash,
      },
    };
  } catch (error) {
    return {
      challenge: paymentRequired,
      payment_response: paymentResponse,
      merchant_data: merchantData,
      result: {
        payment_status: 'success',
        accounting_status: 'failed',
        tx_id: paymentResponse.transaction,
        audit_hash: audit.auditHash,
        error: error instanceof Error ? error.message : 'record_spend_failed',
      },
    };
  }
}

function normalizeLiveNetwork(envNetwork) {
  return envNetwork ?? 'testnet';
}

function parseAccountIndex(value) {
  if (value === undefined) {
    return 0;
  }

  const index = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(`Invalid SAT_FLOW_ACCOUNT_INDEX: ${value}`);
  }

  return index;
}

async function createAccountFromMnemonic(env, network) {
  const secretKey = getRequiredEnv(env, 'SAT_FLOW_SEED_PHRASE').trim();
  const password = env.SAT_FLOW_WALLET_PASSWORD ?? 'SAT-FLOW';
  const accountIndex = parseAccountIndex(env.SAT_FLOW_ACCOUNT_INDEX);

  let wallet = await generateWallet({ secretKey, password });
  for (let index = 0; index <= accountIndex; index += 1) {
    wallet = generateNewAccount(wallet);
  }

  const account = wallet.accounts[accountIndex];
  const upstreamAccount = privateKeyToAccount(account.stxPrivateKey, network);
  return {
    ...upstreamAccount,
    address: getStxAddress({ account, network }),
  };
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

async function callPublicContract({
  contractId,
  functionName,
  functionArgs,
  senderKey,
  network,
  makeCall = makeContractCall,
  broadcast = broadcastTransaction,
}) {
  const contract = parseContractId(contractId);
  const transaction = await makeCall({
    ...contract,
    functionName,
    functionArgs,
    senderKey,
    network: networkFromName(network),
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  });

  const response = await broadcast({
    transaction,
    network: networkFromName(network),
  });
  const txid = response?.txid || response?.txId;
  if (typeof txid !== 'string' || txid.length === 0) {
    throw new Error(`Broadcast failed: ${JSON.stringify(response)}`);
  }

  return { ok: true, txid };
}

export async function createAccountFromEnv(env, overrides = {}) {
  if (overrides.account) {
    return overrides.account;
  }

  const network = normalizeLiveNetwork(env.SAT_FLOW_NETWORK);
  if (typeof env.SAT_FLOW_AGENT_KEY === 'string' && env.SAT_FLOW_AGENT_KEY.length > 0) {
    return privateKeyToAccount(env.SAT_FLOW_AGENT_KEY, network);
  }

  if (typeof env.SAT_FLOW_SEED_PHRASE === 'string' && env.SAT_FLOW_SEED_PHRASE.trim().length > 0) {
    return createAccountFromMnemonic(env, network);
  }

  throw new Error(
    'Missing required environment variable: SAT_FLOW_AGENT_KEY or SAT_FLOW_SEED_PHRASE'
  );
}

export function resolveUsdcxContract(env, account, overrides = {}) {
  if (typeof overrides.usdcxContract === 'string' && overrides.usdcxContract.length > 0) {
    return overrides.usdcxContract;
  }
  if (typeof env.SAT_FLOW_USDCX_CONTRACT === 'string' && env.SAT_FLOW_USDCX_CONTRACT.length > 0) {
    return env.SAT_FLOW_USDCX_CONTRACT;
  }

  const upstreamDefault = getDefaultUSDCxContract(account.network);
  return `${upstreamDefault.address}.${upstreamDefault.name}`;
}

export async function createLiveClientFromEnv(env, overrides = {}) {
  const account = await createAccountFromEnv(env, overrides);
  const network = account.network ?? normalizeLiveNetwork(env.SAT_FLOW_NETWORK);
  const senderAddress = account.address;
  const senderKey = account.privateKey;
  const vaultContractId = getRequiredEnv(env, 'SAT_FLOW_VAULT_CONTRACT');
  const usdcxContract = resolveUsdcxContract(env, account, overrides);

  const identityAdapter =
    overrides.identityAdapter ??
    new HybridBnsIdentityAdapter({
      primary: overrides.primaryIdentityAdapter,
      fallback: new HiroBnsIdentityAdapter({
        network,
        apiBaseUrl: env.SAT_FLOW_HIRO_API_BASE_URL,
        apiKey: env.SAT_FLOW_HIRO_API_KEY,
        fetchImpl: overrides.fetchImpl,
      }),
    });

  const vaultAdapter =
    overrides.vaultAdapter ??
    new StacksVaultAdapter({
      contractId: vaultContractId,
      senderAddress,
      senderKey,
      network,
      readOnly: overrides.readOnly,
      makeCall: overrides.makeCall,
      broadcast: overrides.broadcast,
    });

  const settle =
    overrides.settle ??
    createX402Settlement({
      client: overrides.facilitatorClient,
    });

  const tokenAdapters = {
    USDCX:
      overrides.usdcxAdapter ??
      new StacksSip10TokenAdapter({
        senderKey,
        senderAddress,
        network,
        tokenContract: usdcxContract,
        makeCall: overrides.makeTokenCall,
        settle,
      }),
    STX:
      overrides.stxAdapter ??
      new StacksStxTokenAdapter({
        senderKey,
        network,
        makeTransfer: overrides.makeTransfer,
        settle,
        memoEncoder:
          overrides.memoEncoder ??
          (() => {
            throw new Error(
              'STX live demo requires an explicit memoEncoder strategy; the current @stacks/transactions builder only supports UTF-8 string memos'
            );
          }),
      }),
  };

  return new SatFlowClient({
    vaultAdapter,
    tokenAdapters,
    identityAdapter,
  });
}

export function createSelectedChallenge({
  token,
  amount,
  recipient,
  facilitatorUrl,
  network = 'testnet',
  url = 'https://merchant.test/invoice',
  asset,
  maxTimeoutSeconds = 300,
}) {
  const accepted = {
    scheme: 'exact',
    asset: asset ?? token,
    payTo: recipient,
    maxTimeoutSeconds,
  };

  return normalizeX402Challenge({
    url,
    amount,
    token,
    recipient,
    facilitatorUrl,
    network,
    accepted,
  });
}

export async function runCli(argv, env = process.env, overrides = {}) {
  const command = argv[2];
  const { positionals, flags } = parseArgs(argv.slice(3));

  switch (command) {
    case 'check-allowance': {
      const client = createMemoryDemoClient();
      const token = positionals[0] ?? 'USDCX';
      const recipient = positionals[1] ?? 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P';
      return client.checkAllowance({ vault: 'local', token, recipient });
    }
    case 'pay-demo': {
      const client = createMemoryDemoClient();
      const token = positionals[0] ?? 'USDCX';
      const recipient = positionals[1] ?? 'ST2J8EVYHPN63M8C9D6ZJZV3QK6A6X0WQ2M3Z0S1P';
      const challenge = createSelectedChallenge({
        token,
        amount: token === 'USDCX' ? '1050000' : '1000',
        recipient,
        facilitatorUrl: 'https://facilitator.test',
      });
      return client.payBill({
        amount: challenge.amount,
        recipient: challenge.recipient,
        justification: 'Need the premium dataset to finish the report.',
        x402Challenge: challenge,
      });
    }
    case 'resolve-identity': {
      const live = flags.live === 'true';
      const input = positionals[0];
      if (!input) {
        throw new Error('Usage: resolve-identity <name-or-principal> [--live]');
      }
      const client = live
        ? overrides.liveClient ?? (await createLiveClientFromEnv(env, overrides.liveClientOptions))
        : overrides.memoryClient ?? createMemoryDemoClient();
      return {
        input,
        resolved: await client.resolveIdentity(input),
      };
    }
    case 'show-account-live': {
      const account = await createAccountFromEnv(env, overrides.liveClientOptions);
      return {
        address: account.address,
        network: account.network,
        signer_source:
          typeof env.SAT_FLOW_AGENT_KEY === 'string' && env.SAT_FLOW_AGENT_KEY.length > 0
            ? 'private-key'
            : 'seed-phrase',
        account_index:
          typeof env.SAT_FLOW_ACCOUNT_INDEX === 'string' && env.SAT_FLOW_ACCOUNT_INDEX.length > 0
            ? Number.parseInt(env.SAT_FLOW_ACCOUNT_INDEX, 10)
            : 0,
      };
    }
    case 'check-allowance-live': {
      const token = positionals[0] ?? 'USDCX';
      const recipientInput = positionals[1] ?? getRequiredEnv(env, 'SAT_FLOW_RECIPIENT');
      const client =
        overrides.liveClient ?? (await createLiveClientFromEnv(env, overrides.liveClientOptions));
      const recipient = await client.resolveIdentity(recipientInput);
      return client.checkAllowance({
        vault: env.SAT_FLOW_VAULT_CONTRACT,
        token,
        recipient,
      });
    }
    case 'faucet-mock-usdcx-live': {
      const amount = positionals[0] ?? getRequiredEnv(env, 'SAT_FLOW_AMOUNT');
      const account = await createAccountFromEnv(env, overrides.liveClientOptions);
      const contractId = getRequiredEnv(env, 'SAT_FLOW_USDCX_CONTRACT');
      return callPublicContract({
        contractId,
        functionName: 'faucet',
        functionArgs: [uintCV(BigInt(amount))],
        senderKey: account.privateKey,
        network: account.network,
        makeCall: overrides.makeTokenCall,
        broadcast: overrides.broadcast,
      });
    }
    case 'mint-mock-usdcx-live': {
      const amount = positionals[0] ?? getRequiredEnv(env, 'SAT_FLOW_AMOUNT');
      const recipientInput = positionals[1] ?? getRequiredEnv(env, 'SAT_FLOW_RECIPIENT');
      const account = await createAccountFromEnv(env, overrides.liveClientOptions);
      const client =
        overrides.liveClient ?? (await createLiveClientFromEnv(env, overrides.liveClientOptions));
      const recipient = await client.resolveIdentity(recipientInput);
      const contractId = getRequiredEnv(env, 'SAT_FLOW_USDCX_CONTRACT');
      return callPublicContract({
        contractId,
        functionName: 'mint',
        functionArgs: [uintCV(BigInt(amount)), principalCV(recipient)],
        senderKey: account.privateKey,
        network: account.network,
        makeCall: overrides.makeTokenCall,
        broadcast: overrides.broadcast,
      });
    }
    case 'set-authorized-agent-live': {
      const agentInput = positionals[0] ?? getRequiredEnv(env, 'SAT_FLOW_AGENT_PRINCIPAL');
      const client =
        overrides.liveClient ?? (await createLiveClientFromEnv(env, overrides.liveClientOptions));
      const agent = await client.resolveIdentity(agentInput);
      const vaultAdapter = overrides.vaultAdapter ?? client.vaultAdapter;
      return vaultAdapter.setAuthorizedAgent(agent);
    }
    case 'set-daily-cap-live': {
      const token = positionals[0] ?? 'USDCX';
      const cap = positionals[1] ?? getRequiredEnv(env, 'SAT_FLOW_DAILY_CAP');
      const client =
        overrides.liveClient ?? (await createLiveClientFromEnv(env, overrides.liveClientOptions));
      const vaultAdapter = overrides.vaultAdapter ?? client.vaultAdapter;
      return vaultAdapter.setDailyCap({ token, cap });
    }
    case 'set-recipient-whitelist-live': {
      const recipientInput = positionals[0] ?? getRequiredEnv(env, 'SAT_FLOW_RECIPIENT');
      const allowed = (positionals[1] ?? flags.allowed ?? 'true') === 'true';
      const client =
        overrides.liveClient ?? (await createLiveClientFromEnv(env, overrides.liveClientOptions));
      const recipient = await client.resolveIdentity(recipientInput);
      const vaultAdapter = overrides.vaultAdapter ?? client.vaultAdapter;
      return vaultAdapter.setRecipientWhitelist({ recipient, allowed });
    }
    case 'pay-live': {
      const token = positionals[0] ?? 'USDCX';
      const amount = positionals[1] ?? getRequiredEnv(env, 'SAT_FLOW_AMOUNT');
      const recipientInput = positionals[2] ?? getRequiredEnv(env, 'SAT_FLOW_RECIPIENT');
      const justification =
        positionals[3] ??
        env.SAT_FLOW_JUSTIFICATION ??
        'Need the premium dataset to finish the report.';
      const resourceUrl =
        positionals[4] ?? env.SAT_FLOW_RESOURCE_URL ?? 'https://merchant.test/invoice';
      const facilitatorUrl = env.SAT_FLOW_FACILITATOR_URL
        ? getRequiredEnv(env, 'SAT_FLOW_FACILITATOR_URL')
        : 'https://facilitator.test';
      const client =
        overrides.liveClient ?? (await createLiveClientFromEnv(env, overrides.liveClientOptions));
      const recipient = await client.resolveIdentity(recipientInput);
      const liveAccount = await createAccountFromEnv(env, overrides.liveClientOptions);
      const asset =
        token === 'USDCX'
          ? resolveUsdcxContract(env, liveAccount, overrides.liveClientOptions)
          : 'STX';
      const challenge = createSelectedChallenge({
        token,
        amount,
        recipient,
        facilitatorUrl,
        network: env.SAT_FLOW_NETWORK ?? 'testnet',
        url: resourceUrl,
        asset,
      });

      return {
        challenge: paymentRequirementsFromChallenge(challenge),
        result: await client.payBill({
          amount: challenge.amount,
          recipient: challenge.recipient,
          justification,
          x402Challenge: challenge,
        }),
      };
    }
    case 'pay-merchant-live': {
      const resourceUrl =
        positionals[0] ?? env.SAT_FLOW_RESOURCE_URL ?? 'http://127.0.0.1:4021/api/premium-data';
      const justification =
        positionals[1] ??
        env.SAT_FLOW_JUSTIFICATION ??
        'Need the premium dataset to finish the report.';
      const facilitatorUrl = getRequiredEnv(env, 'SAT_FLOW_FACILITATOR_URL');
      const client =
        overrides.liveClient ??
        (await createLiveClientFromEnv(env, {
          ...overrides.liveClientOptions,
          memoEncoder:
            overrides.liveClientOptions?.memoEncoder ?? encodeStxMerchantMemo,
        }));

      return runMerchantPaymentLive({
        client,
        resourceUrl,
        justification,
        facilitatorUrl,
        fetchImpl: overrides.fetchImpl,
      });
    }
    default:
      return {
        commands: [
          'check-allowance <TOKEN> [RECIPIENT]',
          'pay-demo <TOKEN> [RECIPIENT]',
          'show-account-live',
          'resolve-identity <name-or-principal> [--live]',
          'check-allowance-live <TOKEN> [RECIPIENT]',
          'faucet-mock-usdcx-live <AMOUNT>',
          'mint-mock-usdcx-live <AMOUNT> <RECIPIENT>',
          'set-authorized-agent-live <AGENT_PRINCIPAL_OR_BNS>',
          'set-daily-cap-live <TOKEN> <CAP>',
          'set-recipient-whitelist-live <RECIPIENT_PRINCIPAL_OR_BNS> [true|false]',
          'pay-live <TOKEN> <AMOUNT> <RECIPIENT> [JUSTIFICATION] [RESOURCE_URL]',
          'pay-merchant-live <RESOURCE_URL> [JUSTIFICATION]',
        ],
      };
  }
}
