export async function userLogin(userId, userPasswordHash, deviceName, email, endpoint) {
  const response = await fetch(`${endpoint}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, userPasswordHash, deviceName, email }),
  });
  const data = await response.json();
  return data;
}

export async function userRegister(userId, userPasswordHash, deviceName, email, endpoint, initData = null) {
  const response = await fetch(`${endpoint}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, userPasswordHash, deviceName, email, initData }),
  });
  const data = await response.json();
  return data;
}

export async function userLogout(userId, endpoint) {
  const response = await fetch(`${endpoint}/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId }),
  });
  const data = await response.json();
  return data;
}

// export async function updateRootFile(userId, authToken, lastEtag, endpoint, rootfileData) {
//   const response = await fetch(`${endpoint}/update-rootfile`, {
//     method: 'PUT',
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: `Bearer ${authToken}`,
//       'X-User-Id': userId,
//       'If-Match': lastEtag,
//     },
//     body: rootfileData,
//   });
//   const data = await response.json();
//   return data;
// }

// export async function userStreamListener(
//   userId,
//   deviceName,
//   authToken,
//   endpoint,
//   onMessage,
//   onError,
//   onOpen,
//   abortSignal,
// ) {
//   fetch(`${endpoint}/sse-updates`, {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'text/event-stream',
//       Authorization: `Bearer ${authToken}`,
//       'X-User-Id': userId,
//       'Cache-Control': 'no-cache',
//       Connection: 'keep-alive',
//     },
//     body: JSON.stringify({ deviceName }),
//     signal: abortSignal,
//   });
// }
