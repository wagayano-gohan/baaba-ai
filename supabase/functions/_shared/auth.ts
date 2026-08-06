import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createRequestScopedClient } from './supabaseClient.ts'
import { sha256Hex } from './crypto.ts'
import { jsonError, ErrorCode } from './errors.ts'
import type { AuthContext, DeviceAuthContext, MembershipRole } from './types.ts'

/**
 * Bearerトークン(JWT)のペイロード部(2番目のセグメント)をbase64urlデコードしてJSONとして返す。
 * 署名検証はここでは行わない（有効性の検証は必ず Supabase Auth の getUser() に委ねる）。
 * この関数は「検証済みJWTから session_id クレームを取り出す」用途に限定して使うこと。
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const segments = jwt.split('.')
  if (segments.length !== 3) return null

  try {
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** Authorizationヘッダから Bearer トークン本体を取り出す（形式不正ならnull） */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

/**
 * Authorizationヘッダ(Bearer JWT)を検証し、家族アカウント(owner_admin/viewer)のAuthContextを返す。
 * 本人(principal)はメール・パスワード・PINを一切使わずデバイスセッションで利用するため、
 * この関数の対象外（principal向けは getDeviceAuthContext を使用すること）。
 *
 * authSessionId は「検証に成功したJWTのペイロードの session_id クレーム」から取得する
 * （= auth.sessions.id。pin_verification_sessions.auth_session_id のFK先と一致する）。
 * クレームが存在しない場合は null を返し、user.id での代用は行わない
 * （user.id で代用すると同一ユーザーの全セッションでPIN確認状態が共有されてしまうため）。
 */
export async function getAuthContext(req: Request): Promise<AuthContext | null> {
  const token = extractBearerToken(req)
  if (!token) return null

  // 有効性の検証は Supabase Auth に委ねる（自前で署名検証は行わない）
  const requestClient = createRequestScopedClient(req)
  const { data, error } = await requestClient.auth.getUser()
  if (error || !data.user) return null

  const payload = decodeJwtPayload(token)
  const sessionIdClaim = payload?.session_id
  const authSessionId = typeof sessionIdClaim === 'string' && sessionIdClaim.length > 0 ? sessionIdClaim : null

  return {
    authUserId: data.user.id,
    authSessionId,
    email: data.user.email ?? null,
  }
}

/**
 * PIN確認セッション(pin_verification_sessions)を扱うFunctionが共通で使う認証入口。
 * JWTが有効であることに加えて、session_id クレームが取得できることまでを必須条件とする。
 * 取得できない場合は AUTH_SESSION_ID_MISSING として処理自体を拒否する（代用値は使わない）。
 */
export async function requireAuthContextWithSession(
  req: Request,
): Promise<
  | { ok: true; context: AuthContext & { authSessionId: string } }
  | { ok: false; response: Response }
> {
  const context = await getAuthContext(req)
  if (!context) {
    return { ok: false, response: jsonError(ErrorCode.UNAUTHENTICATED, '認証情報が無効です', 401) }
  }
  if (!context.authSessionId) {
    return {
      ok: false,
      response: jsonError(
        ErrorCode.AUTH_SESSION_ID_MISSING,
        'セッション識別子を取得できませんでした。再ログインしてから再試行してください',
        401,
      ),
    }
  }

  return { ok: true, context: { ...context, authSessionId: context.authSessionId } }
}

/**
 * profile_memberships を確認し、対象profileへのアクセス権とroleを検証する。
 * allowedRoles を指定した場合、role不一致であれば null を返す（呼び出し側で FORBIDDEN を返すこと）。
 * 注意: profile_memberships の主キーは `membership_id`（`id`カラムは存在しない。実マイグレーション準拠）。
 */
export async function requireProfileMembership(
  serviceClient: SupabaseClient,
  authUserId: string,
  profileId: string,
  allowedRoles?: MembershipRole[],
): Promise<{ membershipId: string; role: MembershipRole } | null> {
  const { data, error } = await serviceClient
    .from('profile_memberships')
    .select('membership_id, role')
    .eq('auth_user_id', authUserId)
    .eq('profile_id', profileId)
    .maybeSingle()

  if (error || !data) return null
  if (allowedRoles && !allowedRoles.includes(data.role as MembershipRole)) return null

  return { membershipId: data.membership_id as string, role: data.role as MembershipRole }
}

/**
 * 本人デバイスの認証。register-device（owner_adminが発行）で払い出した生トークンを
 * リクエストヘッダ(x-device-token)で受け取り、SHA-256ハッシュ化した上で
 * registered_devices.device_token_hash（unique/not null）と照合する。
 * revoked_at が設定されているデバイスは無効として扱う（実マイグレーション準拠。
 * pairing_code/is_active/device_secret_hash 等のカラムは存在しない）。
 * 認証成功時は last_seen_at を更新する。
 */
export async function getDeviceAuthContext(
  req: Request,
  serviceClient: SupabaseClient,
): Promise<DeviceAuthContext | null> {
  const deviceToken = req.headers.get('x-device-token')
  if (!deviceToken) return null

  const tokenHash = await sha256Hex(deviceToken)

  const { data, error } = await serviceClient
    .from('registered_devices')
    .select('id, profile_id, revoked_at, registered_by_auth_user_id')
    .eq('device_token_hash', tokenHash)
    .maybeSingle()

  if (error || !data || data.revoked_at !== null) return null

  // last_seen_at 更新（失敗しても認証自体は成立させる。ログ用途のため主処理をブロックしない）
  await serviceClient
    .from('registered_devices')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', data.id)

  return {
    deviceId: data.id as string,
    profileId: data.profile_id as string,
    registeredByAuthUserId: (data.registered_by_auth_user_id as string | null) ?? null,
  }
}

/**
 * pin_verification_sessions を確認し、重要操作に必要な直近PIN確認が有効かを判定する。
 * verify-admin-pin で作成された10分間有効なセッションを想定。
 */
export async function hasValidPinSession(
  serviceClient: SupabaseClient,
  authUserId: string,
  authSessionId: string,
): Promise<boolean> {
  const { data, error } = await serviceClient
    .from('pin_verification_sessions')
    .select('expires_at')
    .eq('auth_user_id', authUserId)
    .eq('auth_session_id', authSessionId)
    .maybeSingle()

  if (error || !data) return false
  return new Date(data.expires_at as string).getTime() > Date.now()
}
