declare const __brand: unique symbol;
export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'TEMP';
export type MemberStatus = 'ACTIVE' | 'INVITED' | 'REMOVED';
export type CollectionType = 'VFS' | 'KV' | 'LIST' | 'CRDTLIST';
export type Brand<T, B> = T & { [__brand]: B };
export type Base64<T = unknown> = string & { readonly __base64: T };
export type Base64Encrypted<T = unknown> = string & { readonly __encrypted: T };
export type Timestamp = Brand<number, 'Timestamp'>;
export type ISOTimestamp = Brand<string, 'ISOTimestamp'>;
export type Hex256 = Brand<string, 'Hex256'>;
type BinaryData = ArrayBuffer | Uint8Array;

type MaybeBuffer = typeof globalThis extends { Buffer?: infer B }
  ? B extends new (...a: unknown[]) => unknown
    ? InstanceType<B> | BinaryData
    : BinaryData
  : BinaryData;

export type DataSource = ArrayBuffer | File | Blob;
export type DataInput = string | MaybeBuffer | ReadableStream | File | Blob;

// ID types
export type FileId = Brand<string, 'FileId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type CollectionId = Brand<string, 'CollectionId'>;
export type MemberId = Brand<string, 'MemberId'>;
export type ChunkId = Brand<string, 'ChunkId'>;
export type VaultId = Brand<string, 'VaultId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type VaultType = 'a' | 't';

export type AuthHeaders = {
  authToken: string;
  memberId: MemberId;
  vaultId: VaultId;
};

export type AuthResult =
  | { ok: false; statusCode: number; message: string }
  | { ok: true; auth: { authToken: string; memberId: MemberId; vaultId: VaultId; role: MemberRole } };

export const VAULTS_NAMESPACE = 'V';
export const CHUNKS_NAMESPACE = 'C';
export const TOKEN_NAMESPACE = 'T';
export const NAME_MAPPING = 'N';
export const REAUTH_NAMESPACE = 'R';

export const RECOVERY_DEVICE_NAME = '__RECOVERY__';

export const COLLECTION_TYPES: Record<CollectionType, CollectionType> = Object.freeze({
  VFS: 'VFS',
  KV: 'KV',
  LIST: 'LIST',
  CRDTLIST: 'CRDTLIST',
});

export const VAULT_TYPE: Record<string, VaultType> = Object.freeze({
  account: 'a',
  team: 't',
});

export const MEMBER_STATUS: Record<MemberStatus, MemberStatus> = Object.freeze({
  ACTIVE: 'ACTIVE',
  INVITED: 'INVITED',
  REMOVED: 'REMOVED',
});
export const ROLE: Record<MemberRole, MemberRole> = Object.freeze({
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
  TEMP: 'TEMP',
});
export const PERMISSIONS: Record<MemberRole, Set<string>> = Object.freeze({
  OWNER: new Set(['read', 'write', 'manage', 'delete_vault']),
  ADMIN: new Set(['read', 'write', 'manage']),
  MEMBER: new Set(['read', 'write']),
  VIEWER: new Set(['read']),
  TEMP: new Set(['read']),
});

export const IS_MANAGER_ROLE = (role: MemberRole): boolean => {
  if (!(role in PERMISSIONS)) {
    throw new Error(`Invalid member role: ${role}`);
  }
  if (PERMISSIONS[role].has('manage')) {
    return true;
  }
  return false;
};

export const RESERVED_USERNAMES = [
  RECOVERY_DEVICE_NAME,
  // System & Admin
  'admin',
  'administrator',
  'root',
  'system',
  'sysadmin',
  'moderator',
  'mod',
  'superuser',
  'operator',
  'webmaster',
  'host',
  'owner',
  'founder',
  'creator',

  // Official/Support
  'support',
  'help',
  'helpdesk',
  'service',
  'customer-service',
  'staff',
  'team',
  'official',
  'verified',
  'info',
  'contact',

  // Security-sensitive
  'security',
  'abuse',
  'noreply',
  'no-reply',
  'postmaster',
  'hostmaster',
  'privacy',
  'legal',
  'dmca',
  'copyright',

  // Platform Collections
  'api',
  'www',
  'mail',
  'ftp',
  'smtp',
  'pop',
  'imap',
  'login',
  'logout',
  'register',
  'signup',
  'signin',
  'auth',
  'oauth',
  'settings',
  'account',
  'profile',
  'dashboard',
  'home',
  'search',
  'discover',

  // Deceptive/Confusing
  'everyone',
  'all',
  'none',
  'null',
  'undefined',
  'anonymous',
  'guest',
  'user',
  'test',
  'demo',
  'example',
  'sample',

  // Your app name variants
  'latticestore',
  'lattice-store',
  'lattice',
  'latticeapp',

  // Common scam patterns
  'notification',
  'notifications',
  'alert',
  'alerts',
  'message',
  'messages',
  'payment',
  'billing',
  'invoice',
  'receipt',
];

export const KV_KEY_SIZE_LIMIT_BYTES = 64;

export const WATCH_POLL_INTERVAL = 3_000; // 3 seconds
export const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB
export const TIMESTAMP_TOLERANCE_MS = 1 * 60 * 1000; // 1 minute
export const TOKEN_EXPIRATION_MS = 1000 * 60 * 60 * 2; // 2 hours

export const CHUNK_TTL_SECONDS = 60 * 15; // 15 minutes
export const ETAG_TTL_SECONDS = 60 * 5; // 5 minutes

export const SYNC_DEBOUNCE_MS = 810;

export const KEM_KEY_LENGTH_BYTES = 64;
export const DSA_KEY_LENGTH_BYTES = 32;
export const TOKEN_LENGTH_BYTES = 64;

export const DEFAULT_AEAD_KEY_LENGTH_BYTES = 32;
export const DEFAULT_SEED_LENGTH_BYTES = 32;

export const CUSTOM_KEM_STRING = '*incredibly_unique-custom_string_for_KEM&LatticeStore*';
export const CUSTOM_DSA_STRING = '*incredibly_unique-custom_string_for_ML-DSA&LatticeStore*';

export const MEMBER_ID_STRING = '*incredibly_unique-custom_string_for_MEMBER_ID&LatticeStore*';
// export const CUSTOM_SUBKEY_ROLE_STRING = '*incredibly_unique-custom_string_for_SUBKEY_ROLE&LatticeStore*';
export const CUSTOM_MANAGER_KEY_STRING = '*incredibly_unique-custom_string_for_MANAGER_KEY&LatticeStore*';
export const CUSTOM_COLLECTION_LIST_STRING =
  '*incredibly_unique-custom_string_for_COLLECTIONS_LISTcrypt0&LatticeStore*';

export const VALIDATION_RULES = {
  accountName: {
    minLength: 5,
    maxLength: 256,
    pattern: /^[a-zA-Z0-9_-]+$/,
    description: 'Alphanumeric, underscore, and hyphen only',
  },
  email: {
    minLength: 6,
    maxLength: 256,
    pattern:
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/,
    description: 'Standard email format',
  },
  vaultName: {
    minLength: 3,
    maxLength: 128,
    pattern: /^[\x20-\x7E]+$/,
    description: 'Printable ASCII characters',
  },
  accountId: {
    exactLength: 64,
    pattern: /^[a-f0-9]{64}$/,
    description: '64 hex characters (lowercase)',
  },
  collectionName: {
    minLength: 1,
    maxLength: 64,
    pattern: /^[a-zA-Z0-9_-]+$/,
    description: 'Alphanumeric, underscore, and hyphen only',
  },
  signedHeaders: {
    requiredFields: ['content-sha256', 'x-timestamp', 'x-request-id', 'x-signer-id', 'x-signature'],
  },
  vaultMemberSlots: {
    minCount: 1,
    requiredFields: [
      'memberId',
      'memberRole',
      'memberStatus',
      'memberKemCiphertext',
      'memberVaultKeyWrapped',
      'memberDsaPubkey',
      'createdAt',
      'updatedAt',
    ],
  },
  vaultManifestBody: {
    requiredFields: ['payload', 'payloadHash', 'signerId', 'signature'],
  },
  vaultManifestPayload: {
    requiredFields: [
      'version',
      'name',
      'type',
      'id',
      'dsaPubkey',
      'kemPubkey',
      'memberSlots',
      'managerOnlyMemberList',
      'managerOnlyArea',
      'keyEpoch',
      'createdAt',
      'updatedAt',
    ],
  },
  vaultLoginBody: {
    requiredFields: ['payload', 'payloadHash', 'signerId', 'signature'],
  },
  vaultLoginPayload: {
    requiredFields: ['accountName', 'memberId', 'timestamp'],
  },
};
