import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { streamSSE } from 'hono/streaming';

import { shared } from '../shared.hono.js';

import { Redis } from '@upstash/redis/cloudflare';
import { KeyvUpstash } from 'keyv-upstash';

import { LatticeStoreService } from '../../dist/lattice-service.js';

const app = new Hono({ strict: false });

app.use(
  '*',
  cors({
    origin: '*', // TODO: Allow all origins in development
    credentials: false,
  }),
);
app.use('*', logger());
app.use('*', async (c, next) => {
  // Middleware to set up S3 client
  // This is a simple example, in production you might want to use a more robust solution
  const {
    NODE_ENV,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
    S3_ENDPOINT,
    S3_REGION,
    REDIS_URL,
    REDIS_TOKEN,
    SERVICE_NAME,
    SERVICE_ENDPOINT,
    SERVICE_PUBLIC_KEY_HEX,
    SERVICE_SECRET_KEY_HEX,
  } = c.env;
  if (
    !S3_ACCESS_KEY_ID ||
    !S3_SECRET_ACCESS_KEY ||
    !S3_ENDPOINT ||
    !S3_REGION ||
    !REDIS_URL ||
    !REDIS_TOKEN ||
    !SERVICE_NAME ||
    !SERVICE_ENDPOINT ||
    !SERVICE_PUBLIC_KEY_HEX ||
    !SERVICE_SECRET_KEY_HEX
  ) {
    return c.json({ ok: false, message: 'Missing environment variables, check README.md', status: 500 }, 500);
  }
  const upstashRedis = new Redis({
    url: REDIS_URL,
    token: REDIS_TOKEN,
    enableTelemetry: false,
    automaticDeserialization: false,
  });
  const LSS = new LatticeStoreService({
    env: NODE_ENV || 'dev',
    serviceName: SERVICE_NAME,
    serviceDescription: 'Example Service',
    serviceEndpoint: SERVICE_ENDPOINT,
    servicePublicKeyHex: SERVICE_PUBLIC_KEY_HEX,
    serviceSecretKeyHex: SERVICE_SECRET_KEY_HEX,
    s3config: {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    },
    kvStoreAdapter: new KeyvUpstash({ upstashRedis }),
  });
  c.set('LSS', LSS);
  await next();
});
app.route('/', shared);

app.notFound(c => {
  return c.json({ ok: false, message: '404 Message' }, 404);
});
app.onError((err, c) => {
  console.error(`${err}`);
  return c.json({ ok: false, message: 'Error msg: ' + `${err}` }, 500);
});
console.log(`🟢🏃 Provider API Listening on http://localhost:8787 ??`);
export default app;
