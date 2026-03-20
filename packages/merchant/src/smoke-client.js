#!/usr/bin/env node

import axios from 'axios';
import {
  decodePaymentResponse,
  decodePaymentRequired,
  encodePaymentPayload,
  X402_HEADERS,
} from 'x402-stacks';
import { networkFromName } from '@stacks/network';
import {
  AnchorMode,
  PostConditionMode,
  makeContractCall,
  makeSTXTokenTransfer,
  noneCV,
  principalCV,
  someCV,
  uintCV,
  bufferCVFromString,
} from '@stacks/transactions';

import { loadDotEnv } from '../../cli/src/dotenv.js';
import { createAccountFromEnv } from '../../cli/src/runtime.js';

function caip2ToNetwork(network) {
  if (network === 'stacks:1') {
    return 'mainnet';
  }
  return 'testnet';
}

async function signPayment({ account, accepted, fee }) {
  const network = networkFromName(caip2ToNetwork(accepted.network));
  const memo = `x402:${Date.now().toString(36)}`.slice(0, 34);
  let transaction;

  if (accepted.asset !== 'STX') {
    const [contractAddress, contractName] = String(accepted.asset).split('.');
    if (!contractAddress || !contractName) {
      throw new Error(`Unsupported SIP-010 asset identifier: ${accepted.asset}`);
    }

    transaction = await makeContractCall({
      contractAddress,
      contractName,
      functionName: 'transfer',
      functionArgs: [
        uintCV(BigInt(accepted.amount)),
        principalCV(account.address),
        principalCV(accepted.payTo),
        memo ? someCV(bufferCVFromString(memo)) : noneCV(),
      ],
      senderKey: account.privateKey,
      network,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Allow,
      fee: BigInt(fee),
    });
  } else {
    transaction = await makeSTXTokenTransfer({
      recipient: accepted.payTo,
      amount: BigInt(accepted.amount),
      senderKey: account.privateKey,
      network,
      memo,
      fee: BigInt(fee),
      anchorMode: AnchorMode.Any,
    });
  }

  const serialized = transaction.serialize();
  return typeof serialized === 'string' ? serialized : Buffer.from(serialized).toString('hex');
}

export async function runMerchantSmoke(env = process.env, overrides = {}) {
  const account =
    overrides.account ??
    (await createAccountFromEnv({
      ...env,
      ...(typeof env.MERCHANT_SMOKE_PRIVATE_KEY === 'string' &&
      env.MERCHANT_SMOKE_PRIVATE_KEY.length > 0
        ? { SAT_FLOW_AGENT_KEY: env.MERCHANT_SMOKE_PRIVATE_KEY }
        : {}),
    }, overrides.accountOptions));
  const baseUrl = overrides.baseUrl ?? env.MERCHANT_BASE_URL ?? 'http://127.0.0.1:4021';
  const resourcePath = overrides.resourcePath ?? env.MERCHANT_RESOURCE_PATH ?? '/api/premium-data';
  const api =
    overrides.api ??
    axios.create({
      baseURL: baseUrl,
      timeout: 60000,
      validateStatus: () => true,
    });
  const fee = overrides.fee ?? env.MERCHANT_SMOKE_FEE_MICROSTX ?? '2000';
  const signPaymentImpl = overrides.signPayment ?? signPayment;

  const initialResponse = await api.get(resourcePath);
  let response = initialResponse;

  if (initialResponse.status === 402) {
    const paymentRequiredHeader = initialResponse.headers?.[X402_HEADERS.PAYMENT_REQUIRED];
    const paymentRequired = decodePaymentRequired(paymentRequiredHeader);
    if (!paymentRequired?.accepts?.length) {
      throw new Error('Merchant did not return a valid x402 payment request');
    }

    const accepted = paymentRequired.accepts[0];
    const signedTransaction = await signPaymentImpl({
      account,
      accepted,
      fee,
    });
    const paymentPayload = encodePaymentPayload({
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted,
      payload: {
        transaction: signedTransaction,
      },
    });

    response = await api.get(resourcePath, {
      headers: {
        [X402_HEADERS.PAYMENT_SIGNATURE]: paymentPayload,
      },
    });
  }

  if (response.status >= 400) {
    const errorBody =
      typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    throw new Error(`Merchant request failed with ${response.status}: ${errorBody}`);
  }

  const paymentHeader = response.headers?.[X402_HEADERS.PAYMENT_RESPONSE];

  return {
    ok: true,
    url: new URL(resourcePath, `${baseUrl}/`).toString(),
    payer: account.address,
    status: response.status,
    payment_response:
      typeof paymentHeader === 'string' ? decodePaymentResponse(paymentHeader) : null,
    data: response.data,
  };
}

loadDotEnv();

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  runMerchantSmoke()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
