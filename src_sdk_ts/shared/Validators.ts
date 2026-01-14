import { sha256 } from '../crypto/CryptoUtils';
import { CryptoPQ, ML_DSA_PUBLIC_KEY_SIZE, ML_DSA_SIGNATURE_SIZE } from '../crypto/CryptoPQ';
import { base64ToUint8Array, generateCanonicalJSON, now } from './Helpers';
import {
  VALIDATION_RULES as C,
  RESERVED_USERNAMES,
  ROLE,
  VAULT_TYPE,
  TIMESTAMP_TOLERANCE_MS,
  COLLECTION_TYPES,
} from './Consts';

import type { LoginRequest } from '../client/ApiClient';
import type { MemberSlot } from '../client/Members.js';
import type { Vault } from '../client/Vault.js';
import type { CollectionType, VaultType } from './Consts.js';

const _isTimestampValid = (clientTime: number): boolean => {
  const serverTime = now();
  const timeDiff = Math.abs(serverTime - clientTime);
  if (timeDiff > TIMESTAMP_TOLERANCE_MS) {
    return false;
  }
  return true;
};

const _validateFields = (body: any, requiredFields: readonly string[]): boolean => {
  for (const field of requiredFields) {
    if (!(field in body)) {
      console.warn(`Missing required field: ${field}`);
      return false;
    }
  }
  return true;
};

const _isValidVault = (body: Vault): boolean => {
  if (
    _validateFields(body, C.vaultManifestBody.requiredFields) &&
    _validateFields(body.payload, C.vaultManifestPayload.requiredFields) &&
    _validateAccountId(body.payload.id) &&
    (body.payload.type === VAULT_TYPE.account
      ? _validateAccountName(body.payload.name)
      : _validateVaultName(body.payload.name)) &&
    _validateVaultMemberSlots(body.payload.memberSlots)
  ) {
    return true;
  }
  return false;
};

const _isMatchingManagerSigner = (body: Vault): boolean => {
  const signerId = body.signerId;
  const members = body.payload.memberSlots || ([] as MemberSlot[]);
  const member = getMemberFromMemberSlots(members, signerId as string);
  if (!member) return false;
  return member.memberRole === ROLE.OWNER || member.memberRole === ROLE.ADMIN;
};

const _isValidSignature = (messageString: string, signatureString: string, member: MemberSlot): boolean => {
  if ([messageString, signatureString].some(v => !v?.trim()) || !member) {
    throw new Error('Missing or malformed signature components');
  }
  const signatureBytes = base64ToUint8Array(signatureString);
  if (signatureBytes.length !== ML_DSA_SIGNATURE_SIZE) {
    throw new Error('Invalid signature length');
  }

  const memberPublicKey = base64ToUint8Array(member.memberDsaPubkey);
  if (memberPublicKey.length !== ML_DSA_PUBLIC_KEY_SIZE) {
    throw new Error('Invalid member public key length');
  }
  const hashUint8 = base64ToUint8Array(messageString as string);
  return CryptoPQ.verifySignature(memberPublicKey, hashUint8, signatureBytes);
};

const _isAccountNameReserved = (accountName: string): boolean => {
  const normalized = accountName.toLowerCase().trim();

  // Direct match
  if (RESERVED_USERNAMES.includes(normalized)) return true;

  // Starts with reserved terms
  const reservedPrefixes = ['admin', 'mod', 'support', 'staff', 'system', 'official'];
  if (reservedPrefixes.some(prefix => normalized.startsWith(prefix))) return true;

  // Contains "official" or "verified" anywhere
  if (/(official|verified|staff|support|admin)/i.test(normalized)) return true;

  return false;
};

const _validateAccountName = (accountName: string): boolean => {
  if (typeof accountName !== 'string') return false;
  if (_isAccountNameReserved(accountName)) return false;
  const rules = C.accountName;
  return (
    accountName.length >= rules.minLength && accountName.length <= rules.maxLength && rules.pattern.test(accountName)
  );
};

const _validateVaultName = (vaultName: string): boolean => {
  if (typeof vaultName !== 'string') return false;
  const trimmed = vaultName.trim();
  const rules = C.vaultName;
  return trimmed.length >= rules.minLength && trimmed.length <= rules.maxLength && rules.pattern.test(trimmed);
};

const _validateAccountId = (accountId: string): boolean => {
  return typeof accountId === 'string' && C.accountId.pattern.test(accountId);
};

const _validateVaultMemberSlots = (memberSlots: MemberSlot[]): boolean => {
  const rules = C.vaultMemberSlots;
  if (!Array.isArray(memberSlots) || memberSlots.length < rules.minCount) return false;
  return memberSlots.every(
    env =>
      env &&
      typeof env === 'object' &&
      rules.requiredFields.every(
        field => (field in env && typeof env[field] === 'string') || typeof env[field] === 'number',
      ),
  );
};

export const getMemberFromMemberSlots = (memberSlots: MemberSlot[], memberId: string): MemberSlot | null => {
  for (const member of memberSlots) {
    if (member.memberId === memberId) {
      return member;
    }
  }
  return null;
};

const _isValidLoginPayload = (body: LoginRequest): boolean => {
  for (const field of C.vaultLoginBody.requiredFields) {
    if (!(field in body)) {
      return false;
    }
  }
  for (const field of C.vaultLoginPayload.requiredFields) {
    if (!(field in body.payload)) {
      return false;
    }
  }
  if (!_validateAccountName(body.payload.accountName)) return false;
  return true;
};
export const validateRegistrationRequest = async (body: Vault): Promise<boolean> => {
  return isValidVaultManifest(body, VAULT_TYPE.account as VaultType);
};

export const validateLoginRequest = async (body: LoginRequest, vaultManifest: Vault): Promise<boolean> => {
  if (_isValidLoginPayload(body)) {
    const calculatedSha256 = await sha256(generateCanonicalJSON(body.payload), 'base64');
    if (calculatedSha256 === body.payloadHash) {
      const memberSlot = getMemberFromMemberSlots(vaultManifest.payload.memberSlots, body.payload.memberId);
      if (memberSlot && _isTimestampValid(body.payload.timestamp)) {
        return _isValidSignature(body.payloadHash, body.signature, memberSlot);
      }
    }
  }
  return false;
};

export const isValidCollectionName = (collectionName: string): boolean => {
  if (typeof collectionName !== 'string') return false;
  const trimmed = collectionName.trim();
  const rules = C.collectionName;
  return trimmed.length >= rules.minLength && trimmed.length <= rules.maxLength && rules.pattern.test(trimmed);
};
export const isValidCollectionType = (collectionType: CollectionType): boolean => {
  return Object.values(COLLECTION_TYPES).includes(collectionType as CollectionType);
};

export const isValidVaultManifest = async (vaultManifest: Vault, expectedType: VaultType): Promise<boolean> => {
  if (
    _isValidVault(vaultManifest) &&
    _isMatchingManagerSigner(vaultManifest) &&
    vaultManifest.payload.type === expectedType
  ) {
    const calculatedSha256 = await sha256(generateCanonicalJSON(vaultManifest.payload), 'base64');
    const memberSlot = getMemberFromMemberSlots(vaultManifest.payload.memberSlots, vaultManifest.signerId);
    if (memberSlot) {
      return (
        calculatedSha256 === vaultManifest.payloadHash &&
        _isValidSignature(vaultManifest.payloadHash, vaultManifest.signature, memberSlot)
      );
    }
  }
  return false;
};
