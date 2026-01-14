import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { LatticeStoreService } from '../dist/sdk/Service.js';
import { KeyvUpstash } from 'keyv-upstash';

const IO_GB = 10 * 1024 * 1024 * 1024; // 10 GB in bytes

// function getRandomAuthToken() {
//   return crypto.randomUUID();
// }
// function emailIsValid(email) {
//   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
// }

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
  const ls = new LatticeStoreService(
    {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    },
    createAdapter,
  );
  c.set('lattice', ls);
  await next();
});
api.get('list', async c => {
  const ls = c.get('lattice');
  if (!ls) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const listAll = await ls.listAll();
  return c.json(listAll);
});

api.get('clearall', async c => {
  const ls = c.get('lattice');
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
  const ls = c.get('lattice');
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
  const ls = c.get('lattice');
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
  const ls = c.get('lattice');
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
  const ls = c.get('lattice');
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
  const ls = c.get('lattice');
  if (!ls) {
    return c.json({ ok: false, message: 'Service not initialized' }, 500);
  }
  const result = await ls.upload(headers, body);
  return c.json({ ok: result.ok, message: result.message, etag: result.etag }, result.statusCode);
  // const authTokenBearer = c.req.header('Authorization');
  // const providedAuthToken = authTokenBearer.split(' ')[1];
  // const userId = c.req.header('x-user-id');
  // if (!userId || !providedAuthToken) {
  //   return c.json({ ok: false, message: 'Missing user userId or auth token' }, 400);
  // }
  // const tokens = c.get('tokens');
  // const users = c.get('users');
  // const chunks = c.get('chunks');
  // const s3client = c.get('s3');
  // if (!tokens || !users || !chunks || !s3client) {
  //   return c.json({ ok: false, message: 'Keyvs or S3 client not initialized' }, 500);
  // }
  // // Verify auth token
  // const [existingUserToken, user] = await Promise.all([tokens.get(`user:${userId}`), users.get(`user:${userId}`)]);
  // if (!existingUserToken || existingUserToken !== providedAuthToken) {
  //   return c.json({ ok: false, message: 'Invalid user ID or auth token' }, 401);
  // }
  // if (!user) {
  //   return c.json({ ok: false, message: 'User not found' }, 404);
  // }
  // // Check if user is limited
  // if (user.limited) {
  //   return c.json(
  //     {
  //       ok: false,
  //       message: 'User storage limit exceeded. Cannot upload.',
  //       bytesUsed: user.bytesUsed,
  //       bytesLimit: user.bytesLimit,
  //       percentageUsed: user.percentageUsed,
  //       remainingBytes: user.remainingBytes,
  //       limited: true,
  //     },
  //     403,
  //   );
  // }
  // const body = await c.req.arrayBuffer();
  // const size = body.byteLength;
  // const contentDisposition = c.req.header('Content-Disposition');
  // const fileName = contentDisposition ? contentDisposition.split('filename=')[1].replace(/"/g, '') : 'unknown';
  // const lastEtag = c.req.header('If-Match') || null;
  // if (fileName === 'unknown') {
  //   return c.json({ ok: false, message: 'Missing filename in Content-Disposition header' }, 400);
  // }
  // const fullName = `${userId}/${fileName}`;
  // console.log('Full file name to upload:', fullName);
  // console.log('File size:', size);
  // console.log('Provided ETag for concurrency control:', lastEtag);
  // if (lastEtag !== null) {
  //   try {
  //     const currentEtag = await s3client.getEtag(fullName);
  //     if (lastEtag !== currentEtag) {
  //       return c.json(
  //         {
  //           ok: false,
  //           message: 'ETag mismatch. File has been modified meanwhile.',
  //           dataEtag: currentEtag,
  //         },
  //         409,
  //       );
  //     }
  //     // If ETag matches, proceed with upload
  //     const s3response = await s3client.putObject(fullName, Buffer.from(body));
  //     if (!s3response.ok) {
  //       return c.json({ ok: false, message: 'Error uploading file to S3' }, 500);
  //     }
  //     const newEtag = sanitizeETag(s3response.headers.get('etag'));
  //     // Update user's bytesUsed and percentageUsed
  //     let newBytesUsed = user.bytesUsed + size;
  //     let limited = false;
  //     if (newBytesUsed > user.bytesLimit) {
  //       newBytesUsed = user.bytesLimit;
  //       limited = true;
  //     }
  //     const newPercentageUsed = (newBytesUsed / user.bytesLimit) * 100;
  //     const newRemainingBytes = Math.max(0, user.bytesLimit - newBytesUsed);
  //     await users.set(`user:${userId}`, {
  //       ...user,
  //       bytesUsed: newBytesUsed,
  //       percentageUsed: newPercentageUsed,
  //       limited,
  //       remainingBytes: newRemainingBytes,
  //     });
  //     console.log('Uploading chunk for user:', userId, 'fileName:', fileName, 'size:', size, 'etag:', newEtag);
  //     return c.json(
  //       {
  //         ok: true,
  //         message: 'Chunk uploaded successfully',
  //         newEtag: newEtag,
  //         bytesUsed: newBytesUsed,
  //         bytesLimit: user.bytesLimit,
  //         percentageUsed: newPercentageUsed,
  //         remainingBytes: newRemainingBytes,
  //         limited,
  //       },
  //       200,
  //     );
  //   } catch (error) {
  //     return c.json({ ok: false, message: 'File not found for the provided ETag' }, 404);
  //   }
  // } else {
  //   // No ETag provided, proceed with upload without concurrency check
  //   const s3response = await s3client.putObject(fullName, Buffer.from(body));
  //   if (!s3response.ok) {
  //     return c.json({ ok: false, message: 'Error uploading file to S3' }, 500);
  //   }
  //   const newEtag = sanitizeETag(s3response.headers.get('etag'));
  //   // Update user's bytesUsed and percentageUsed
  //   let newBytesUsed = user.bytesUsed + size;
  //   let limited = false;
  //   if (newBytesUsed > user.bytesLimit) {
  //     newBytesUsed = user.bytesLimit;
  //     limited = true;
  //   }
  //   const newPercentageUsed = (newBytesUsed / user.bytesLimit) * 100;
  //   const newRemainingBytes = Math.max(0, user.bytesLimit - newBytesUsed);
  //   await users.set(`user:${userId}`, {
  //     ...user,
  //     bytesUsed: newBytesUsed,
  //     percentageUsed: newPercentageUsed,
  //     limited,
  //     remainingBytes: newRemainingBytes,
  //   });
  //   console.log('Uploading chunk for user:', userId, 'fileName:', fileName, 'size:', size, 'etag:', newEtag);
  //   return c.json(
  //     {
  //       ok: true,
  //       message: 'Chunk uploaded successfully',
  //       newEtag: newEtag,
  //       bytesUsed: newBytesUsed,
  //       bytesLimit: user.bytesLimit,
  //       percentageUsed: newPercentageUsed,
  //       remainingBytes: newRemainingBytes,
  //       limited,
  //     },
  //     200,
  //   );
  // }
  // console.log('Uploading chunk for user:', userId, 'fileName:', fileName, 'size:', size, 'etag:', lastEtag);
  // // save data via s3mini the most optimal way as fast as possible ...
  // return c.json({ ok: true, message: 'Chunk upload endpoint' }, 200);
});

// api.get('download/:fileId', async c => {
//   const authTokenBearer = c.req.header('Authorization');
//   const providedAuthToken = authTokenBearer.split(' ')[1];
//   const userId = c.req.header('x-user-id');
//   const fileId = c.req.param('fileId');
//   if (!userId || !providedAuthToken) {
//     return c.json({ ok: false, message: 'Missing user userId or auth token' }, 400);
//   }
//   const tokens = c.get('tokens');
//   const chunks = c.get('chunks');
//   const s3client = c.get('s3');

//   if (!tokens || !chunks || !s3client) {
//     return c.json({ ok: false, message: 'Keyvs or S3 client not initialized' }, 500);
//   }
//   // Verify auth token
//   const existingUserToken = await tokens.get(`user:${userId}`);
//   if (!existingUserToken || existingUserToken !== providedAuthToken) {
//     return c.json({ ok: false, message: 'Invalid user ID or auth token' }, 401);
//   }
//   const fullName = `${userId}/${fileId}`;
//   try {
//     const s3response = await s3client.getObjectResponse(fullName);
//     if (!s3response.ok) {
//       return c.json({ ok: false, message: 'Error fetching file from S3' }, 500);
//     }
//     const responseAB = await s3response.arrayBuffer();
//     if (responseAB.byteLength === 0) {
//       return c.json({ ok: false, message: 'File not found in S3' }, 404);
//     }
//     const etag = sanitizeETag(s3response.headers.get('etag'));
//     return c.body(responseAB, 200, {
//       'Content-Type': 'application/octet-stream',
//       'Content-Disposition': `attachment; filename="${fileId}"`,
//       etag: etag,
//     });
//   } catch (error) {
//     return c.json({ ok: false, message: 'File not found' }, 404);
//   }
// });

// api.post('sse-updates', async c => {
//   return streamSSE(
//     c,
//     async stream => {
//       const authTokenBearer = c.req.header('Authorization');
//       const userId = c.req.header('x-user-id');
//       const { deviceName, etag } = await c.req.json();
//       const providedAuthToken = authTokenBearer.split(' ')[1];
//       console.log('SSE connection attempt for userId:', userId, 'device:', deviceName, 'etag:', etag);
//       if (!userId || !providedAuthToken || !deviceName) {
//         // return c.json({ ok: false, message: 'Missing user userId or auth token' }, 400);
//         await stream.writeSSE({
//           data: 'Missing user userId or auth token',
//           event: 'error',
//           code: 500,
//         });
//         stream.close();
//         return;
//       }
//       const tokens = c.get('tokens');
//       const users = c.get('users');
//       const chunks = c.get('chunks');
//       const s3client = c.get('s3');
//       if (!tokens || !users || !chunks || !s3client) {
//         await stream.writeSSE({
//           data: 'Keyv/S3 client not initialized',
//           event: 'error',
//           code: 500,
//         });
//         stream.close();
//         return;
//       }
//       // Verify auth token
//       const existingUserToken = await tokens.get(`user:${userId}`);
//       if (!existingUserToken || existingUserToken !== providedAuthToken) {
//         await stream.writeSSE({
//           data: 'Invalid user ID or auth token',
//           event: 'error',
//           code: 401,
//         });
//         stream.close();
//         return;
//       }

//       console.log('SSE connection established for user:', userId, 'device:', deviceName);
//       // get etag either from cache or from s3 ...
//       const rootfiles = c.get('rootfiles');
//       let userRootFileEtag = await rootfiles.get(`user:${userId}:etag`);
//       if (!userRootFileEtag) {
//         try {
//           const headResp = await s3client.getEtag(`user:${userId}.rf`);
//           userRootFileEtag = sanitizeETag(headResp);
//           await rootfiles.set(`user:${userId}:etag`, userRootFileEtag);
//         } catch (error) {
//           console.error('Error fetching root file ETag from S3:', error);
//           await stream.writeSSE({
//             data: 'Error fetching root file ETag from S3',
//             event: 'error',
//             code: 500,
//           });
//           stream.close();
//           return;
//         }
//       }
//       console.log('Using root file ETag for user:', userId, 'etag:', userRootFileEtag);
//       await stream.writeSSE({ data: userRootFileEtag, event: 'open', code: 200 });
//       rootfiles.hooks.addHandler(KeyvHooks.HOOK_AFTER_SET, async (key, value) => {
//         if (key === `user:${userId}`) {
//           console.log('Detected root file change for user:', userId);
//           // get new etag
//           let newEtag = await rootfiles.get(`user:${userId}:etag`);
//           if (!newEtag) {
//             try {
//               const headResp = await s3client.getEtag(`user:${userId}.rf`);
//               newEtag = sanitizeETag(headResp);
//               await rootfiles.set(`user:${userId}:etag`, newEtag);
//             } catch (error) {
//               console.error('Error fetching updated root file ETag from S3:', error);
//               return;
//             }
//           }
//           if (newEtag !== userRootFileEtag) {
//             userRootFileEtag = newEtag;
//             console.log('Sending updated ETag to client for user:', userId, 'etag:', userRootFileEtag);
//             await stream.writeSSE({ data: userRootFileEtag, event: 'update', code: 200 });
//           }
//         }
//       });
//       while (true) {
//         await stream.sleep(10 * 1000);
//         await stream.writeSSE({ data: 'ping ' + Date.now(), event: 'keepalive', code: 200 });
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

// api.put('update-rootfile', async c => {
//   const authTokenBearer = c.req.header('Authorization');
//   const providedAuthToken = authTokenBearer.split(' ')[1];
//   const userId = c.req.header('x-user-id');
//   const lastEtag = c.req.header('If-Match');
//   if (!userId || !providedAuthToken) {
//     return c.json({ ok: false, message: 'Missing user userId or auth token' }, 400);
//   }
//   const users = c.get('users');
//   const rootfiles = c.get('rootfiles');
//   const tokens = c.get('tokens');
//   const s3client = c.get('s3');
//   if (!users || !rootfiles || !tokens || !s3client) {
//     return c.json({ ok: false, message: 'Keyvs not initialized or S3 client not available' }, 500);
//   }
//   let [existingUserToken, newRootfileDataString, userRootFileEtag] = await Promise.all([
//     tokens.get(`user:${userId}`),
//     c.req.text(),
//     rootfiles.get(`user:${userId}:etag`),
//   ]);
//   if (!existingUserToken || existingUserToken !== providedAuthToken) {
//     return c.json({}, 401);
//   }
//   if (!userRootFileEtag) {
//     try {
//       const etag = await s3client.getEtag(`user:${userId}.rf`);
//       userRootFileEtag = etag;
//     } catch (error) {
//       console.error('Error fetching root file from S3:', error);
//       return c.json({ ok: false, message: 'Error fetching root file from S3' }, 500);
//     }
//   }
//   if (lastEtag !== userRootFileEtag) {
//     return c.json(
//       {
//         ok: false,
//         message: 'ETag mismatch. Root file has been modified meanwhile.',
//         dataEtag: userRootFileEtag,
//       },
//       409,
//     );
//   }
//   const s3response = await s3client.putObject(`user:${userId}.rf`, newRootfileDataString);
//   if (!s3response.ok) {
//     return c.json({ ok: false, message: 'Error updating root file in S3' }, 500);
//   }
//   const newEtag = sanitizeETag(s3response.headers.get('etag'));
//   c.waitUntil(
//     Promise.all([
//       rootfiles.set(`user:${userId}`, newRootfileDataString),
//       rootfiles.set(`user:${userId}:etag`, newEtag),
//     ]),
//   );
//   console.log('Updated root file for user:', userId, 'new etag:', newEtag);
//   return c.json({ ok: true, message: 'Root file updated successfully', dataEtag: newEtag });
// });

export default api;
export { api };
