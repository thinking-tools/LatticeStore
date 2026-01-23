export async function sha256(message, encoding = 'arraybuffer') {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
  if (encoding === 'arraybuffer') return hashBuffer;
  const hashArray = new Uint8Array(hashBuffer);
  switch (encoding) {
    case 'uint8array':
      return hashArray;
    case 'hex':
      return Array.from(hashArray, b => b.toString(16).padStart(2, '0')).join('');
    case 'base64':
      return btoa(String.fromCharCode(...hashArray));
    default:
      throw new Error(`Unsupported encoding: ${encoding}`);
  }
}

export async function encryptData(data, key) {
  const cryptoKey = await importKey(key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, data);

  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv);
  result.set(new Uint8Array(encrypted), iv.length);
  return result;
}

export async function decryptData(data, key) {
  const cryptoKey = await importKey(key);
  const iv = data.slice(0, 12);
  const encrypted = data.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, encrypted);
  return new Uint8Array(decrypted);
}

async function importKey(keyData) {
  if (typeof keyData === 'string') {
    const encoder = new TextEncoder();
    const keyBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(keyData));
    return await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  return await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
