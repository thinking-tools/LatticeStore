import { resolve } from 'path';

export type TestEnv = {
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  REDIS_URL: string;
  REDIS_TOKEN: string;

  SERVICE_NAME: string;
  SERVICE_ENDPOINT: string;
  NODE_ENV: string;

  WRANGLER_SEND_METRICS?: boolean;
  UPSTASH_DISABLE_TELEMETRY?: boolean;
};

const target = process.env.E2E_TARGET ?? 'local';
const envPath = resolve(import.meta.dirname, `../../infra/.env.${target}`);

process.loadEnvFile(envPath);

export const env: TestEnv = {
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID!,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY!,
  S3_ENDPOINT: process.env.S3_ENDPOINT!,
  S3_REGION: process.env.S3_REGION!,
  S3_BUCKET: process.env.S3_BUCKET!,
  REDIS_URL: process.env.REDIS_URL!,
  REDIS_TOKEN: process.env.REDIS_TOKEN!,
  SERVICE_ENDPOINT: target === 'local' ? 'http://localhost:8787/api' : process.env.API_ENDPOINT!,
  SERVICE_NAME: process.env.SERVICE_NAME!,
  NODE_ENV: process.env.NODE_ENV || 'development',
  WRANGLER_SEND_METRICS: !!process.env.WRANGLER_SEND_METRICS || false,
  UPSTASH_DISABLE_TELEMETRY: process.env.UPSTASH_DISABLE_TELEMETRY === 'true' ? true : false,
};
