import express from 'express';
import { getPayment, paymentMiddleware } from 'x402-stacks';

import { createAccountFromEnv } from '../../cli/src/runtime.js';

function getEnv(env, key, fallback) {
  const value = env[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return fallback;
}

function parseTokenContract(tokenContract) {
  if (typeof tokenContract !== 'string' || tokenContract.length === 0) {
    return undefined;
  }

  const [address, name] = tokenContract.split('.');
  if (!address || !name) {
    throw new Error(`Invalid merchant token contract: ${tokenContract}`);
  }

  return { address, name };
}

export async function createMerchantConfig(env = process.env, overrides = {}) {
  const account = overrides.account ?? (await createAccountFromEnv(env, overrides.accountOptions));
  const network = overrides.network ?? account.network ?? getEnv(env, 'SAT_FLOW_NETWORK', 'testnet');
  const payTo = overrides.payTo ?? getEnv(env, 'MERCHANT_PAY_TO', account.address);
  const facilitatorUrl = overrides.facilitatorUrl ?? getEnv(env, 'SAT_FLOW_FACILITATOR_URL');
  if (typeof facilitatorUrl !== 'string' || facilitatorUrl.length === 0) {
    throw new Error('Missing required environment variable: SAT_FLOW_FACILITATOR_URL');
  }

  const bind = overrides.bind ?? getEnv(env, 'MERCHANT_BIND', '127.0.0.1');
  const portValue = overrides.port ?? getEnv(env, 'MERCHANT_PORT', '4021');
  const port = Number.parseInt(String(portValue), 10);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid merchant port: ${portValue}`);
  }

  const resourcePath = overrides.resourcePath ?? getEnv(env, 'MERCHANT_RESOURCE_PATH', '/api/premium-data');
  const resourceUrl =
    overrides.resourceUrl ??
    getEnv(env, 'MERCHANT_RESOURCE_URL', `http://${bind}:${port}${resourcePath}`);
  const amount = String(overrides.amount ?? getEnv(env, 'MERCHANT_PRICE_MICROSTX', '1000000'));
  const tokenType = overrides.tokenType ?? getEnv(env, 'MERCHANT_TOKEN_TYPE', 'STX');
  const tokenContract = parseTokenContract(
    overrides.tokenContract ?? getEnv(env, 'MERCHANT_TOKEN_CONTRACT', undefined)
  );
  const description =
    overrides.description ??
    getEnv(env, 'MERCHANT_DESCRIPTION', 'SAT-FLOW merchant premium data');
  const settlementTimeoutMs = Number.parseInt(
    String(overrides.settlementTimeoutMs ?? getEnv(env, 'MERCHANT_SETTLEMENT_TIMEOUT_MS', '5000')),
    10
  );
  if (!Number.isSafeInteger(settlementTimeoutMs) || settlementTimeoutMs <= 0) {
    throw new Error(`Invalid merchant settlement timeout: ${settlementTimeoutMs}`);
  }

  const simulationMode =
    overrides.simulationMode ?? getEnv(env, 'MERCHANT_SIMULATION_MODE', 'false') === 'true';

  return {
    bind,
    port,
    network,
    payTo,
    facilitatorUrl,
    resourcePath,
    resourceUrl,
    amount,
    tokenType,
    tokenContract,
    description,
    settlementTimeoutMs,
    simulationMode,
  };
}

export function createMerchantApp(config, overrides = {}) {
  const app = express();
  const paymentMiddlewareFactory = overrides.paymentMiddlewareFactory ?? paymentMiddleware;
  const middleware =
    overrides.paymentHandler ??
    paymentMiddlewareFactory({
      amount: BigInt(config.amount),
      address: config.payTo,
      payTo: config.payTo,
      network: config.network,
      facilitatorUrl: config.facilitatorUrl,
      resource: config.resourceUrl,
      description: config.description,
      tokenType: config.tokenType,
      tokenContract: config.tokenContract,
    });
  const getPaymentFromRequest = overrides.getPaymentFromRequest ?? getPayment;

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get(config.resourcePath, async (req, res, next) => {
    if (config.simulationMode) {
      res.json({
        ok: true,
        resource: config.resourceUrl,
        data: {
          report: 'Stacks x402 merchant control path is live.',
        },
        payment: {
          mode: 'simulation',
        },
      });
      return;
    }

    const hasPaymentSignature = typeof req.headers['payment-signature'] === 'string';
    if (!hasPaymentSignature) {
      middleware(req, res, next);
      return;
    }

    const middlewarePromise = new Promise((resolve, reject) => {
      middleware(req, res, error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Payment facilitator timed out')), config.settlementTimeoutMs);
    });

    try {
      await Promise.race([middlewarePromise, timeoutPromise]);
      if (res.headersSent) {
        return;
      }

      const payment = getPaymentFromRequest(req);
      res.json({
        ok: true,
        resource: config.resourceUrl,
        data: {
          report: 'Stacks x402 merchant control path is live.',
        },
        payment: payment
          ? {
              payer: payment.payer ?? null,
              transaction: payment.transaction ?? null,
              network: payment.network ?? config.network,
              asset: payment.asset ?? config.tokenType,
            }
          : null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `${JSON.stringify(
          {
            merchant_error: true,
            path: config.resourcePath,
            facilitator_url: config.facilitatorUrl,
            reason: message,
            has_payment_signature: hasPaymentSignature,
          },
          null,
          2
        )}\n`
      );

      if (res.headersSent) {
        return;
      }

      if (message === 'Payment facilitator timed out') {
        res.status(504).json({
          error: 'payment_facilitator_timeout',
          message,
        });
        return;
      }

      next(error);
    }
  });

  return app;
}

export async function startMerchantServer(env = process.env, overrides = {}) {
  const config = await createMerchantConfig(env, overrides);
  const app = createMerchantApp(config, overrides);
  const listen = overrides.listenImpl ?? app.listen.bind(app);

  return await new Promise((resolve, reject) => {
    let server;
    let ready = false;
    const onReady = () => {
      ready = true;
      if (server) {
        resolve({ app, server, config });
      }
    };
    server = listen(config.port, config.bind, onReady);
    server.once('error', reject);
    if (ready) {
      resolve({ app, server, config });
    }
  });
}
