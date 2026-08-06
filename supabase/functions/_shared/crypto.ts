// デバイストークンのハッシュ化ユーティリティ。
// registered_devices.device_token_hash は生トークンを保存しない方針のため、
// register-device / reset-principal-device での発行時と、デバイス認証時の照合の両方で
// このハッシュ関数を使い、生トークンはレスポンスでのみ一度返す。

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** デバイストークン生成（register-device / reset-principal-deviceで使用） */
export function generateDeviceToken(): string {
  return crypto.randomUUID() + crypto.randomUUID()
}
