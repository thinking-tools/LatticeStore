import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from 'hono/cloudflare-workers';

import { api } from './example.api.js';

const SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>
    <rect width='32' height='32' fill='#FF0000'/>
  </svg>`;

const app = new Hono({ strict: true });

app.use(
  secureHeaders({
    strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
    xFrameOptions: 'DENY',
    xXssProtection: '1',
  }),
);
app.use(
  csrf({
    origin: (origin, c) => {
      if (c.env.SERVICE_ENDPOINT === origin) {
        return origin;
      }
      throw new Error('Wrong CORS origin');
    },
  }),
);
app.use('api/*', async (c, next) => {
  const {
    BACKEND,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
    S3_ENDPOINT,
    S3_REGION,
    REDIS_URL,
    REDIS_TOKEN,
    SERVICE_NAME,
    SERVICE_ENDPOINT,
  } = c.env;

  if (
    !BACKEND ||
    !S3_ACCESS_KEY_ID ||
    !S3_SECRET_ACCESS_KEY ||
    !S3_ENDPOINT ||
    !S3_REGION ||
    !REDIS_URL ||
    !REDIS_TOKEN ||
    !SERVICE_NAME ||
    !SERVICE_ENDPOINT
  ) {
    return c.json({ ok: false, message: 'Missing environment variables, check README.md', status: 500 }, 500);
  }
  await next();
});
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      if (!origin) return ''; // Allow non-browser clients or no origin
      if (c.env.SERVICE_ENDPOINT === origin) {
        return origin;
      }
      throw new Error('Wrong CORS origin');
    },
    credentials: false,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    // allowHeaders: ['Content-Type', 'Authorization'],
    // exposeHeaders: ['Content-Length', 'ETag', 'X-Request-ID'], // Does not seem to work in some browsers? is is necessary?
    maxAge: 600, // Cache preflight for 10 minutes
  }),
);

app.use('*', logger());

app.use('/public/*', serveStatic({ root: './docs/public/' }));
app.get('/favicon.ico', c => {
  return c.body(SVG, 200, {
    'Content-Type': 'image/svg+xml',
  });
});

app.route('api/', api);

app.notFound(c => {
  return c.json({ ok: false, message: '404 Message' }, 404);
});

app.onError((err, c) => {
  console.error(`Error: ${err}`);
  return c.json({ ok: false, message: 'Error msg: ' + `${err}` }, 500);
});

app.get('/*', serveStatic({ path: './docs/index.html' }));

export default app;
