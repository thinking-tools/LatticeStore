import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { LatticeStoreService } from '../dist/service.mjs';
import { KeyvUpstash } from 'keyv-upstash';

const IO_GB = 10 * 1024 * 1024 * 1024; // 10 GB in bytes

// function getRandomAuthToken() {
//   return crypto.randomUUID();
// }
// function emailIsValid(email) {
//   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
// }
let ls = null;
const api = new Hono({ strict: false });
api.use('*', async (c, next) => {
  const { REDIS_URL, REDIS_TOKEN, USER_STORAGE_QUOTA, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT, S3_REGION } =
    c.env;

  if (!REDIS_URL || !REDIS_TOKEN || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_ENDPOINT || !S3_REGION) {
    return c.json({ ok: false, message: 'Missing environment vars', statusCode: 500 }, 500);
  }

  const bytesLimit = USER_STORAGE_QUOTA ? parseInt(USER_STORAGE_QUOTA) : IO_GB;
  c.set('bytesLimit', bytesLimit);
  const createAdapter = () =>
    new KeyvUpstash({
      url: REDIS_URL,
      token: REDIS_TOKEN,
      enableTelemetry: false,
      automaticDeserialization: false,
    });
  if (ls === null) {
    ls = new LatticeStoreService(
      {
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
        endpoint: S3_ENDPOINT,
        region: S3_REGION,
      },

      createAdapter,
    );
  }
  // c.set('lattice', ls);
  await next();
});
api.get('list', async c => {
  // const ls = c.get('lattice');
  if (!ls) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const listAll = await ls.listAll();
  return c.json(listAll);
});

api.get('clearall', async c => {
  // const ls = c.get('lattice');
  if (!ls) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const listAll = await ls.deleteAll();
  return c.json(listAll);
});

// TBD rework
api.post('login', async c => {
  const body = await c.req.json();
  // const headers = c.req.raw.headers;
  // const ls = c.get('lattice');
  if (!ls) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const loginResponse = await ls.login(body);
  // c.header('x-request-id', headers.get('x-request-id'));
  return c.json(loginResponse);
});

// TBD rework
api.post('register', async c => {
  const body = await c.req.json();
  // const headers = c.req.raw.headers;
  // console.log('Register headers: ', headers);
  // const ls = c.get('lattice');
  if (!ls) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const regResponse = await ls.register(body);
  console.log('Registration response: ', regResponse);
  // c.header('x-request-id', headers.get('x-request-id'));
  return c.json(regResponse);
});

api.post('check-updates', async c => {
  const body = await c.req.json();
  const headers = c.req.raw.headers;
  // const ls = c.get('lattice');
  if (!ls) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const regResponse = await ls.checkUpdates(headers, body);
  console.log('Check response: ', regResponse);
  return c.json(regResponse);
});

// api.post('logout', async c => {
//   const { userId } = await c.req.json();
//   const tokens = c.get('tokens');

//   if (!tokens) {
//     return c.json({ ok: false, message: 'Keyv not initialized' }, 500);
//   }

//   await tokens.delete(`user:${userId}`);

//   return c.json({ ok: true, message: 'Logout successful' });
// });

api.get('download', async c => {
  const headers = c.req.raw.headers;
  if (!ls) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const result = await ls.download(headers);
  if (!result.ok) {
    return c.json({ ok: false, message: result.message }, result.statusCode);
  }
  return c.body(result.data, result.statusCode, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${result.key}"`,
    etag: result.etag,
  });
});

api.put('upload', async c => {
  const body = await c.req.arrayBuffer();
  const headers = c.req.raw.headers;
  if (!ls) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const result = await ls.upload(headers, body);
  return c.json({ ok: result.ok, message: result.message, etag: result.etag }, result.statusCode);
});

api.post('reauth', async c => {
  const body = await c.req.json();
  if (!ls) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const reauthResponse = await ls.reauth(body);
  return c.json(reauthResponse, reauthResponse.statusCode);
});

api.delete('delete', async c => {
  const body = await c.req.json();
  const headers = c.req.raw.headers;
  if (!ls) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const deleteResponse = await ls.delete(headers, body);
  return c.json(deleteResponse, deleteResponse.statusCode);
});

export default api;
export { api };
