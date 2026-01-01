import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

const shared = new Hono({ strict: false });

shared.get('/', c => {
  const LSS = c.get('LSS');
  const credentials = LSS.getCredentials();
  return c.json({ ok: true, code: 200, ...credentials });
});

shared.get('/health', async c => {
  const LSS = c.get('LSS');
  const healthStatus = await LSS.healthCheck();
  return c.json(healthStatus);
});

// TODO Remove laster
shared.get('/cleanupall', async c => {
  const LSS = c.get('LSS');
  const result = await LSS.cleanup();
  return c.json(result);
});

// TODO Remove later
shared.get('/listallkv', async c => {
  const LSS = c.get('LSS');
  const kvList = await LSS.listAllKVStore();
  return c.json(kvList);
});

shared.post('/register-account', async c => {
  // TODO: Implement registration logic
  const LSS = c.get('LSS');
  if (!LSS) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const body = await c.req.json();
  const result = await LSS.registerNewAccount(body);
  return c.json(result, result.code);
});

// polling for updates
shared.post('/check-updates', async c => {
  const LSS = c.get('LSS');
  if (!LSS) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const body = await c.req.json();
  const result = await LSS.checkForUpdates(body);
  return c.json(result, result.code);
});

shared.post('/sse-updates', async c => {
  return streamSSE(
    c,
    async stream => {
      const LSS = c.get('LSS');
      if (!LSS) {
        await stream.writeSSE({
          data: 'Service not initialized',
          event: 'error',
          code: 500,
        });
        stream.close();
        return;
      }
      const body = await c.req.json();
      let continueStream = true;
      while (continueStream) {
        const result = await LSS.checkForUpdates(body, { skipAuth: true });
        if (result.code !== 200) {
          continueStream = false;
          await stream.writeSSE({
            data: result.message,
            event: 'error',
            code: result.code,
          });
          stream.close();
          return;
        } else {
          const hasChanges = result.changes && result.changes.length > 0;
          if (!hasChanges) {
            continue;
          } else {
            await stream.writeSSE({
              data: JSON.stringify(result.changes),
              event: 'update',
              code: result.code,
            });
          }
        }
        await stream.sleep(2300);
      }
    },
    (error, stream) => {
      console.error('SSE stream error:', error);
      stream.writeSSE({
        data: 'Stream closed due to error',
        event: 'error',
        code: 500,
      });
      stream.close();
    },
  );
});

// Testing purpose only
// app.post('/sse', async c => {
//   return streamSSE(
//     c,
//     async stream => {
//       // const LSS = c.get('LSS');
//       // if (!LSS) {
//       //   await stream.writeSSE({
//       //     data: 'Service not initialized',
//       //     event: 'error',
//       //     code: 500,
//       //   });
//       //   stream.close();
//       //   return;
//       // }
//       const body = await c.req.json();
//       console.log('SSE request body:', body);
//       let continueStream = true;
//       while (continueStream) {
//         // const result = await LSS.checkForUpdates(body, { skipAuth: true });
//         // if (result.code !== 200) {
//         //   continueStream = false;
//         //   await stream.writeSSE({
//         //     data: result.message,
//         //     event: 'error',
//         //     code: result.code,
//         //   });
//         //   stream.close();
//         //   return;
//         // } else {
//         //   const hasChanges = result.changes && result.changes.length > 0;
//         //   if (!hasChanges) {
//         //     continue;
//         //   } else {
//         //     await stream.writeSSE({
//         //       data: JSON.stringify(result.changes),
//         //       event: 'update',
//         //       code: result.code,
//         //     });
//         //   }
//         // }
//         await stream.writeSSE({
//           data: JSON.stringify('Hello SSE!'),
//           event: 'update',
//           code: 200,
//         });
//         await stream.sleep(500);
//       }
//     },
//     (error, stream) => {
//       console.error('SSE stream error:', error);
//       stream.writeSSE({
//         data: 'Stream closed due to error',
//         event: 'error',
//         code: 500,
//       });
//       stream.close();
//     },
//   );
// });
// testing purpose only

shared.post('/upload-chunk', async c => {
  const body = await c.req.blob();
  return c.json({ ok: true, message: 'Chunk upload endpoint' }, 200);
});

shared.post('/upload-file', async c => {
  const LSS = c.get('LSS');
  if (!LSS) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const body = await c.req.json();
  const result = await LSS.uploadFile(body);
  return c.json(result, result.code);
});

shared.post('/login', async c => {
  // TODO: Implement login logic
  const LSS = c.get('LSS');
  if (!LSS) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const body = await c.req.json();

  const result = await LSS.login(body);
  return c.json(result, result.code);
});

shared.notFound(c => {
  return c.json({ ok: false, message: '404 Message' }, 404);
});
shared.onError((err, c) => {
  console.error(`${err}`);
  return c.json({ ok: false, message: 'Error msg: ' + `${err}` }, 500);
});

export default shared;
export { shared };
