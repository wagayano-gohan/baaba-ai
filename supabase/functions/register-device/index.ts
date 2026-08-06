// register-device: 本人(principal)デバイスの登録。
// 呼び出し元: owner_admin（JWT必須）。実マイグレーションの registered_devices.registered_by_auth_user_id
// が auth.users を参照しており、registered_devicesへのINSERT RLSポリシーもowner_admin限定であることから、
// 「owner_adminがデバイスを登録し、生成された生トークンをそのデバイスに一度だけ渡す（QRコード等）」
// という設計であると判断した。デバイス自身がペアリングコードを提示する方式ではない。
// 発行したトークンは以降 process-voice-input / execute-confirmed-action 等で
// x-device-token ヘッダとして提示され、デバイスセッションとして扱われる。

// 実行条件（正式確定仕様）:
//   1. 有効なowner_adminのSupabase Authセッションであること（JWT確認 + session_idクレーム取得）
//   2. 対象profileに対して owner_admin 権限を持つこと（profile_memberships確認）
//   3. 管理者PIN確認（verify-admin-pin）の成功から10分以内であること
//   4. そのPIN確認が「同じauth_user_id・同じauth_session_id」で行われ、失効していないこと
//   条件を満たさない場合は PIN_REQUIRED で登録を拒否する。
//   Supabase Authの再認証(reauthenticate)を条件とする旧方式（admin_reauth_sessions /
//   hasFreshReauth / RECENT_REAUTH_REQUIRED）は廃止し、管理者PIN確認セッションに一本化した。
//   判定は pin_verification_sessions（auth_user_id + auth_session_idキー、expires_atは
//   PIN確認成功時に +10分 で確定）を _shared/auth.ts の hasValidPinSession が参照して行う。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { requireAuthContextWithSession, requireProfileMembership, hasValidPinSession } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { writeAuditLog } from '../_shared/audit.ts'
import { nowUtcIso } from '../_shared/datetime.ts'
import { generateDeviceToken, sha256Hex } from '../_shared/crypto.ts'
import type { RegistrationSource } from '../_shared/types.ts'

interface RegisterDeviceRequest {
  profileId: string
  deviceName?: string
}

// このFunctionは常にowner_admin起点での登録のみを扱う（system/migration/testは別経路の想定）。
const REGISTRATION_SOURCE: RegistrationSource = 'owner_admin'

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: RegisterDeviceRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.profileId || typeof body.profileId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'profileIdは必須です', 400)
  }

  // 2. 認証確認（JWT検証 + session_id取得。session_idが無い場合はここで拒否される）
  const auth = await requireAuthContextWithSession(req)
  if (!auth.ok) return auth.response
  const authContext = auth.context

  const supabase = createServiceRoleClient()

  // 3. profile_memberships確認（owner_adminのみ許可）
  const membership = await requireProfileMembership(supabase, authContext.authUserId, body.profileId, [
    'owner_admin',
  ])
  if (!membership) {
    return jsonError(ErrorCode.PROFILE_ACCESS_DENIED, 'この操作を行う権限がありません', 403)
  }

  // 4. 管理者PIN確認セッションの確認（同一auth_user_id・同一auth_session_idで10分以内・未失効）
  const pinVerified = await hasValidPinSession(supabase, authContext.authUserId, authContext.authSessionId)
  if (!pinVerified) {
    return jsonError(
      ErrorCode.PIN_REQUIRED,
      'この操作には管理者PINの確認が必要です。PIN確認後10分以内に再度実行してください',
      403,
    )
  }

  // 5. デバイストークンの生成・ハッシュ化（生トークンはDBに保存しない）
  const deviceToken = generateDeviceToken()
  const deviceTokenHash = await sha256Hex(deviceToken)

  // 6. アプリケーション層での入力検証（DBトリガーとは別に二重に担保する）:
  //    registration_source='owner_admin'の場合、registered_by_auth_user_idは必須。
  //    system/migration/testの場合のみnullを許容する（実マイグレーションのCHECK/トリガー制約と同一の不変条件）。
  //    このFunctionはowner_admin起点の登録のみを扱うため、registeredByAuthUserIdは
  //    JWT検証済みのauthContext.authUserIdを使用し、欠落があれば明示的にエラーを返す。
  const registeredByAuthUserId: string | null = authContext.authUserId
  if (REGISTRATION_SOURCE === 'owner_admin' && !registeredByAuthUserId) {
    return jsonError(
      ErrorCode.VALIDATION_ERROR,
      'registration_source=owner_adminの場合、registered_by_auth_user_idは必須です',
      400,
    )
  }

  // 7. registered_devices へ挿入
  const { data: device, error: insertError } = await supabase
    .from('registered_devices')
    .insert({
      profile_id: body.profileId,
      device_name: body.deviceName ?? null,
      device_token_hash: deviceTokenHash,
      registered_by_auth_user_id: registeredByAuthUserId,
      registration_source: REGISTRATION_SOURCE,
      created_at: nowUtcIso(),
    })
    .select('id')
    .single()

  if (insertError || !device) {
    return jsonError(ErrorCode.INTERNAL_ERROR, 'デバイス登録に失敗しました', 500, insertError?.message)
  }

  // 8. audit_logs記録（登録操作の主体はowner_admin）
  await writeAuditLog(supabase, {
    profileId: body.profileId,
    actorAuthUserId: authContext.authUserId,
    action: 'register_device',
    targetTable: 'registered_devices',
    targetId: device.id as string,
    detail: { deviceName: body.deviceName ?? null, registrationSource: REGISTRATION_SOURCE },
  })

  // 9. 生トークンはこのレスポンスでのみ返却する（以後は再取得不可。紛失時はreset-principal-deviceで再発行）
  return jsonSuccess({ deviceId: device.id, profileId: body.profileId, deviceToken }, 201)
})
