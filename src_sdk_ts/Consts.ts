declare const __brand: unique symbol;
export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'TEMP';
export type MemberStatus = 'ACTIVE' | 'INVITED' | 'REMOVED';
export type CollectionType = 'VFS' | 'KEYVALUE' | 'LIST' | 'CRDTLIST';
export type Brand<T, B> = T & { [__brand]: B };
export type Base64<T = unknown> = string & { readonly __base64: T };
export type Base64Encrypted<T = unknown> = string & { readonly __encrypted: T };
export type Timestamp = Brand<number, 'Timestamp'>;
export type Hex256 = Brand<string, 'Hex256'>;

// ID types
export type FileId = Brand<string, 'FileId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type CollectionId = Brand<string, 'CollectionId'>;
export type MemberId = Brand<string, 'MemberId'>;
export type ChunkId = Brand<string, 'ChunkId'>;
export type VaultId = Brand<string, 'VaultId'>;
export type VaultType = 'account' | 'team';

export const VAULTS_NAMESPACE = 'VAULTS';
export const NAME_MAPPING = 'NAME2ID';
export const RECOVERY_DEVICE_NAME = '__RECOVERY_DEVICE__';

export const VAULT_TYPE: Record<VaultType, VaultType> = Object.freeze({
  account: 'account',
  team: 'team',
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

export const TOKEN_NAMESPACE = 'TKN';

export const TIMESTAMP_TOLERANCE_MS = 1 * 60 * 1000; // 1 minute
export const TOKEN_EXPIRATION_SECONDS = 1000 * 60 * 60 * 6; // 6 hours

export const ETAG_TTL_SECONDS = 60 * 5; // 5 minutes

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
    requiredFields: ['payload', 'payloadHash', 'signerId', 'signature'] as const[],
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
    ] as const[],
  },
  vaultLoginBody: {
    requiredFields: ['payload', 'payloadHash', 'signerId', 'signature'],
  },
  vaultLoginPayload: {
    requiredFields: ['accountName', 'memberId', 'timestamp'],
  },
} as const;
