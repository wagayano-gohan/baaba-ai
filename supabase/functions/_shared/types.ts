// Edge Functions共通の型定義

/** profile_memberships.role （家族側のみ。本人(principal)はSupabase Authのroleを持たない） */
export type MembershipRole = 'owner_admin' | 'viewer'

/** JWT検証済みの家族アカウント（owner_admin / viewer）の認証コンテキスト */
export interface AuthContext {
  authUserId: string
  /**
   * pin_verification_sessions のキーに使用するセッション識別子。
   * Supabase Auth の JWT ペイロードの session_id クレーム（= auth.sessions.id）。
   * クレームが取得できない場合は null になる（authUserId で代用してはならない）。
   */
  authSessionId: string | null
  email: string | null
}

/** registered_devices.registration_source */
export type RegistrationSource = 'owner_admin' | 'system' | 'migration' | 'test'

/** register-device で払い出したデバイス資格情報による認証コンテキスト（本人=principal用） */
export interface DeviceAuthContext {
  deviceId: string
  profileId: string
  /**
   * registered_devices.registered_by_auth_user_id（このデバイスを登録したowner_admin）。
   * voice_requests.source='principal_voice'ではcreated_by_device_idのみが必須で、
   * created_by_auth_user_idはnull許容（本人=principalはSupabase Authアカウントを持たないため）。
   * 取得できれば付加情報としてcreated_by_auth_user_idに設定するが、必須ではない。
   * 登録者アカウントが削除されている場合や特定できない場合はnullになり得る（on delete set null）。
   */
  registeredByAuthUserId: string | null
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export interface ApiSuccessBody<T> {
  data: T
}
