// 本人(principal)端末のデバイストークン管理ユーティリティ。
// register-device Edge Functionが発行した生トークンは、このレスポンスでのみ受け取れる
// （以後は再取得不可）ため、端末側でlocalStorageに保存して使い回す。
// 保存先のprofileIdも併せて保持し、どのprofileに紐づく端末なのかを呼び出し側が判断できるようにする。

const DEVICE_TOKEN_STORAGE_KEY = 'baba-ai:device-token'
const DEVICE_PROFILE_ID_STORAGE_KEY = 'baba-ai:device-profile-id'

export interface StoredDeviceCredential {
  deviceToken: string
  profileId: string
}

/** register-device成功時に発行された生トークンと対象profileIdを保存する。 */
export function saveDeviceCredential(deviceToken: string, profileId: string): void {
  localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, deviceToken)
  localStorage.setItem(DEVICE_PROFILE_ID_STORAGE_KEY, profileId)
}

/** 保存済みの生デバイストークンを取得する。未登録端末ではnull。 */
export function getDeviceToken(): string | null {
  return localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY)
}

/** 保存済みデバイストークンが紐づくprofileIdを取得する。未登録端末ではnull。 */
export function getDeviceProfileId(): string | null {
  return localStorage.getItem(DEVICE_PROFILE_ID_STORAGE_KEY)
}

/** 保存済みのデバイス資格情報（トークン+profileId）をまとめて取得する。未登録端末ではnull。 */
export function getStoredDeviceCredential(): StoredDeviceCredential | null {
  const deviceToken = getDeviceToken()
  const profileId = getDeviceProfileId()
  if (!deviceToken || !profileId) return null
  return { deviceToken, profileId }
}

/** この端末がデバイス登録済みかどうか。 */
export function hasRegisteredDevice(): boolean {
  return getStoredDeviceCredential() !== null
}

/** デバイス資格情報を端末から削除する（登録解除・再ペアリング前のリセット用）。 */
export function clearDeviceCredential(): void {
  localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY)
  localStorage.removeItem(DEVICE_PROFILE_ID_STORAGE_KEY)
}
