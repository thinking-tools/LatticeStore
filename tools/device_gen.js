import { arrayBufferToHexString, uint8ArrayToHexString } from '../src/client/_helpers.js';
import {
  CRYPTO_SUBTLE,
  generateNewDeviceCredential,
  buildDeviceEnvelopes,
  getMasterKeyFromEnvelopes,
  aes256gcmEncryptToBase64,
  aes256gcmDecryptFromBase64,
  randomBytes,
} from '../src/client/_crypto.js';

(async () => {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    throw new Error('Web Crypto API is not available in this environment.');
  }

  let recoverySeed = 'testabc123'; // randomBytes(64);
  let userSeed = ''; //
  // if (!(recoverySeed instanceof Uint8Array) && recoverySeed.byteLength !== 64) {
  //   throw new Error('Recovery seed must be a Uint8Array of length 64.');
  // }
  // this is the new/current master key used to enc/dec indexFile and deviceList
  let masterKey = randomBytes(32); // generate a random 256-bit master key
  // generate a random account ID
  let accountId = arrayBufferToHexString(randomBytes(32).buffer);
  // generate credentials for recovery and this device
  let [recoveryDevice, thisDevice] = await Promise.all([
    generateNewDeviceCredential(recoverySeed),
    generateNewDeviceCredential(userSeed),
  ]);

  const deviceList = [
    {
      deviceId: recoveryDevice.deviceId,
      pubKeyHex: uint8ArrayToHexString(recoveryDevice.pubKey),
    },
    {
      deviceId: thisDevice.deviceId,
      pubKeyHex: uint8ArrayToHexString(thisDevice.pubKey),
    },
  ];
  // log the generated credentials
  console.log('Account ID:', accountId);
  console.log('Master Key:', uint8ArrayToHexString(masterKey));
  console.log('Recovery Device ID:', recoveryDevice.deviceId);
  console.log('This Device ID:', thisDevice.deviceId);
  if (thisDevice.secretKey) thisDevice.secretKey.fill(0);
  if (recoveryDevice.secretKey) recoveryDevice.secretKey.fill(0);
  const envelopes = await buildDeviceEnvelopes(masterKey, deviceList);
  const encMasterKey = await CRYPTO_SUBTLE.importKey('raw', masterKey, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  masterKey.fill(0); // clear the master key for security
  const encryptedDeviceList = await aes256gcmEncryptToBase64(JSON.stringify(deviceList), encMasterKey);
  // this plus encrypted device list is uploaded to server
  console.log('Device Envelopes:', envelopes);
  console.log('Encrypted Device List:', encryptedDeviceList);
  // encrypted device list is uploaded to server, and envelopes are used to decrypt it

  // NEW DEVICE DECRYPTION
  // this part of example showcase how existing device decryption works from knowledge of recovery seed
  const recoveryDeviceCredentials = await generateNewDeviceCredential(recoverySeed);
  const decryptedEncryptionMasterKey = await getMasterKeyFromEnvelopes(recoveryDeviceCredentials, envelopes);
  console.log('Decrypted Master Key:', uint8ArrayToHexString(decryptedEncryptionMasterKey));
  const encMasterKey2 = await CRYPTO_SUBTLE.importKey('raw', decryptedEncryptionMasterKey, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  const decryptedDeviceList = await aes256gcmDecryptFromBase64(encryptedDeviceList, encMasterKey2);
  let decryptedDeviceListString = new TextDecoder().decode(decryptedDeviceList);
  console.log('Decrypted Device List:', JSON.parse(decryptedDeviceListString));
})();
