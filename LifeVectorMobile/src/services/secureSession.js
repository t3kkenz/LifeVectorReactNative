import AsyncStorage from '@react-native-async-storage/async-storage';
import {Buffer} from '@craftzdog/react-native-buffer';
import QuickCrypto from 'react-native-quick-crypto';
import DeviceInfo from 'react-native-device-info';

const PUBLIC_KEY_STORAGE = 'public_key';
const PRIVATE_KEY_STORAGE = 'private_key';
const AES_KEY_STORAGE = 'AES_key';
const AES_IV_STORAGE = 'AES_iv';

function generateRsaKeyPair() {
  return new Promise((resolve, reject) => {
    QuickCrypto.generateKeyPair(
      'rsa',
      {
        modulusLength: 2048,
        publicKeyEncoding: {type: 'spki', format: 'pem'},
        privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
      },
      (error, publicKey, privateKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({publicKey, privateKey});
      },
    );
  });
}

export async function getOrCreateIdentity() {
  const [storedPublicKey, storedPrivateKey, deviceId] = await Promise.all([
    AsyncStorage.getItem(PUBLIC_KEY_STORAGE),
    AsyncStorage.getItem(PRIVATE_KEY_STORAGE),
    DeviceInfo.getUniqueId(),
  ]);

  if (storedPublicKey && storedPrivateKey) {
    return {
      publicKey: storedPublicKey,
      privateKey: storedPrivateKey,
      deviceId,
    };
  }

  const {publicKey, privateKey} = await generateRsaKeyPair();
  await AsyncStorage.multiSet([
    [PUBLIC_KEY_STORAGE, publicKey],
    [PRIVATE_KEY_STORAGE, privateKey],
  ]);

  return {publicKey, privateKey, deviceId};
}

export async function getStoredSessionKeys() {
  const values = await AsyncStorage.multiGet([
    AES_KEY_STORAGE,
    AES_IV_STORAGE,
  ]);
  const stored = Object.fromEntries(values);
  if (!stored[AES_KEY_STORAGE] || !stored[AES_IV_STORAGE]) {
    return null;
  }
  return {key: stored[AES_KEY_STORAGE], iv: stored[AES_IV_STORAGE]};
}

export async function openSessionEnvelope(value, privateKey) {
  const plaintext = QuickCrypto.privateDecrypt(
    {
      key: privateKey,
      padding: QuickCrypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(value),
  ).toString('utf8');

  const key = plaintext.match(/\[key:\](.*)\[iv:\]/s)?.[1];
  const iv = plaintext.match(/\[iv:\](.*)/s)?.[1];
  if (!key || !iv) {
    throw new Error('The LifePi returned an invalid secure-session envelope.');
  }

  await AsyncStorage.multiSet([
    [AES_KEY_STORAGE, key],
    [AES_IV_STORAGE, iv],
  ]);
  return {key, iv};
}

export function encryptSessionMessage(text, session) {
  const cipher = QuickCrypto.createCipheriv(
    'aes-128-ctr',
    Buffer.from(session.key, 'base64'),
    Buffer.from(session.iv, 'base64'),
  );
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(text, 'utf8')),
    cipher.final(),
  ]);
  return `[Len:${Buffer.byteLength(text, 'utf8')}]${encrypted.toString('base64')}`;
}

export function decryptSessionMessage(value, session) {
  const decipher = QuickCrypto.createDecipheriv(
    'aes-128-ctr',
    Buffer.from(session.key, 'base64'),
    Buffer.from(session.iv, 'base64'),
  );
  return Buffer.concat([
    decipher.update(Buffer.from(value)),
    decipher.final(),
  ]).toString('utf8');
}

export function formatProtocolMessage(text, deviceId) {
  const continuationSize = 475;
  let remaining = `${deviceId}:[START]${text}`;
  let formatted = remaining.slice(0, 512);
  remaining = remaining.slice(512);

  while (remaining.length > 0) {
    formatted += `${deviceId}:${remaining.slice(0, continuationSize)}`;
    remaining = remaining.slice(continuationSize);
  }

  return `${formatted}[END]`;
}

export function toByteArray(text) {
  return Array.from(Buffer.from(text, 'utf8'));
}
