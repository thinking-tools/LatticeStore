import { ml_dsa44 } from '@noble/post-quantum/ml-dsa';
import { randomBytes } from 'node:crypto';

const keys = ml_dsa44.keygen(randomBytes(32));
const secretKey = keys.secretKey;
const publicKey = keys.publicKey;

const msg = randomBytes(128);
const sig = ml_dsa44.sign(secretKey, msg);
const isValid = ml_dsa44.verify(publicKey, msg, sig);

if (!isValid) {
  throw new Error('Signature verification failed');
}

// convert keys to hex format
const secretKeyHex = Buffer.from(secretKey).toString('hex');
const publicKeyHex = Buffer.from(publicKey).toString('hex');
console.log('==========================');
console.log('Secret Key (HEX):\n', secretKeyHex);
console.log('==========================');
console.log('Public Key (HEX):\n', publicKeyHex);
