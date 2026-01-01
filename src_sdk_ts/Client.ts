'use strict';

import { makeRequest } from './ApiClient';
import { generateRandomBytes, sha256 } from './CryptoUtils';
import { AEAD } from './CryptoAEAD';
import { CryptoPQ } from './CryptoPQ';
import { buildMember, createNewCredentials, encryptMemberList, getManagerKey } from './Members';
import { ROLE, VAULT_TYPE } from './Consts.js';
import { loginAccount } from './Account';
import { uint8ArrayToBase64, now, generateCanonicalJSON } from './Helpers';
import { DEFAULT_SEED_LENGTH_BYTES, RECOVERY_DEVICE_NAME } from './Consts';
// import { VaultController } from './Vault';

import type { VaultId, Base64, Base64Encrypted } from './Consts.js';
import type { VaultRegistrationPayload, Vault } from './Vault';

const _verifySecurityContext = async () => {
  const checks = {
    crossOriginIsolated: window.crossOriginIsolated,
    secureContext: window.isSecureContext,
    https: location.protocol === 'https:',
  };

  console.log('Security Context:', checks);

  if (!checks.crossOriginIsolated) {
    console.warn('⚠️ Not cross-origin isolated - vulnerable config');
    console.warn('Check COOP/COEP headers are set correctly');
  }

  if (!checks.secureContext) {
    console.error('❌ Not a secure context - WebCrypto limited');
  }
  return checks;
};

export class LatticeStoreClient {
  private _serviceUrl: string;
  constructor(serviceUrl: string) {
    _verifySecurityContext();
    this._serviceUrl = serviceUrl;
  }
  public async register(
    accountName: string,
    deviceName: string,
    deviceSeed?: Uint8Array,
    service: string = this._serviceUrl,
  ) {
    try {
      // this device seed is either provided by user or randomly generated
      const thisDeviceSeed = deviceSeed ?? generateRandomBytes(DEFAULT_SEED_LENGTH_BYTES);

      // Generate recovery seeds
      const recoverySeed = generateRandomBytes(DEFAULT_SEED_LENGTH_BYTES);

      const masterKey = AEAD.generateRawAEADKeyData();

      const [thisDeviceCredentials, recoveryDeviceCredentials] = await Promise.all([
        createNewCredentials(deviceName.trim(), ROLE.ADMIN, masterKey, thisDeviceSeed),
        createNewCredentials(RECOVERY_DEVICE_NAME, ROLE.OWNER, masterKey, recoverySeed),
      ]);

      const accountSeed = generateRandomBytes(DEFAULT_SEED_LENGTH_BYTES);
      const accountMember = buildMember(accountSeed);

      const managersKey = await getManagerKey(masterKey);
      masterKey.fill(0);

      const encryptedAccountSeed = uint8ArrayToBase64(
        await AEAD.encrypt(managersKey, accountMember.memberSeed as Uint8Array<ArrayBuffer>),
      ) as Base64Encrypted<Uint8Array>;
      const encryptedMemberList = await encryptMemberList(
        [thisDeviceCredentials.memberEncryptedDetail, recoveryDeviceCredentials.memberEncryptedDetail],
        managersKey,
      );
      const timestamp = now();

      const registerPayload: VaultRegistrationPayload = {
        version: 1,
        name: accountName.trim(),
        type: VAULT_TYPE.personal,
        id: accountMember.memberId as VaultId,
        dsaPubkey: uint8ArrayToBase64(accountMember.dsaKeys.publicKey) as Base64<Uint8Array>,
        kemPubkey: uint8ArrayToBase64(accountMember.kemKeys.publicKey) as Base64<Uint8Array>,
        memberSlots: [thisDeviceCredentials.memberSlot, recoveryDeviceCredentials.memberSlot],
        managerOnlyMemberList: encryptedMemberList,
        managerOnlyArea: encryptedAccountSeed,
        // featuresEncrypted: '' as Base64Encrypted<Feature[]>, // empty features list for now
        keyEpoch: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      // cleanup here
      accountMember.kemKeys.secretKey.fill(0);
      accountMember.dsaKeys.secretKey.fill(0);
      accountMember.memberSeed.fill(0);
      accountSeed.fill(0);

      const payloadSha256uint8Array = (await sha256(
        generateCanonicalJSON(registerPayload),
        'uint8array',
      )) as Uint8Array;
      const registerBody = {
        payload: registerPayload,
        payloadHash: uint8ArrayToBase64(payloadSha256uint8Array),
        signerId: recoveryDeviceCredentials.memberSlot.memberId,
        signature: uint8ArrayToBase64(
          CryptoPQ.sign(recoveryDeviceCredentials.__secrets.dsaSecretKey, payloadSha256uint8Array),
        ),
      } as Vault;

      const response = await makeRequest(`${service}/register`, 'POST', registerBody);
      if (!response.ok) {
        throw new Error(response.message || 'Registration failed');
      }
      return {
        ok: response.ok,
        deviceCredentials: thisDeviceCredentials,
        recoveryDeviceCredentials: recoveryDeviceCredentials,
        recoverySeed: recoverySeed,
        thisDeviceSeed: thisDeviceSeed,
      };
    } catch (error) {
      throw error;
    }
  }

  public async login(accountName: string, deviceSeed: Uint8Array, service: string = this._serviceUrl) {
    try {
      // TODO implement switch later
      const persistentConnection = true;
      const account = await loginAccount(service, accountName, deviceSeed, persistentConnection);
      console.log('Logged in account:', account);
      return account;
    } catch (error) {
      throw error;
    }
  }

  // Not implemented yet
  // public async addNewDeviceViaRecovery(
  //   accountName: string,
  //   recoverySeed: Uint8Array,
  //   serviceUrl: string = this._serviceUrl,
  //   deviceSeed: Uint8Array,
  //   deviceName: string,
  // ) {
  //   throw new Error('Not implemented yet');
  //   const persistentConnection = false;

  //   const memberBasics = buildMember(recoverySeed);
  //   const vault = await VaultController.init(serviceUrl, accountName, memberBasics, persistentConnection);
  //   // TODO
  //   // const account = await loginAccount(service, accountName, recoverySeed, persistentConnection);
  // }
}
