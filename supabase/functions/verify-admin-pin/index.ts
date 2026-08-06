// verify-admin-pin: owner_adminのPINを検証し、pin_verification_sessionsを作成する。
// 呼び出し元: owner_admin。JWT必須。重要操作（register-device / update-family-permissions /
// delete-protected-resource 等）の前段で呼ばれる。
//
// 実行条件（正式確定仕様）:
//   1. 有効なSupabase Authセッションであり、JWTから session_id クレームを取得できること
//   2. 対象profileに対して owner_admin であること
//   3. PINが設定済みであり、ロック中でないこと
// PIN確認セッションは (auth_user_id, auth_session_id) 単位で10分間有効。
// 失敗は auth_user_id 単位でカウントし、5回連続失敗で15分ロックする
// （端末・セッションを変えてもロックは継続する）。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { requireAuthContextWithSession, requireProfileMembership } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { writeAuditLog } from '../_shared/audit.ts'
import { addMinutesIso, isExpired, nowUtcIso } from '../_shared/datetime.ts'
import { verifyPin } from '../_shared/pin.ts'

interface VerifyAdminPinRequest {
  profileId: string
  pin: string
}

/** PINは4桁数字（正式確定仕様） */
const PIN_RE = /^\d{4}$/
/** PIN確認セッションの有効時間（分） */
const PIN_SESSION_MINUTES = 10
/** ロックまでの連続失敗回数 */
const MAX_FAILED_ATTEMPTS = 5
/** ロック時間（分） */
const LOCK_MINUTES = 15

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: VerifyAdminPinRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.profileId || typeof body.profileId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'profileIdは必須です', 400)
  }
  if (!body.pin || typeof body.pin !== 'string' || !PIN_RE.test(body.pin)) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'pinは4桁の数字である必要があります', 400)
  }

  // 2. 認証確認（JWT検証 + session_id取得。session_idが無い場合はここで拒否される）
  const auth = await requireAuthContextWithSession(req)
  if (!auth.ok) return auth.response
  const { authUserId, authSessionId } = auth.context

  const supabase = createServiceRoleClient()

  // 3. profile_memberships確認（owner_adminのみ許可）
  const membership = await requireProfileMembership(supabase, authUserId, body.profileId, ['owner_admin'])
  if (!membership) {
    return jsonError(ErrorCode.PROFILE_ACCESS_DENIED, 'この操作を行う権限がありません', 403)
  }

  // 4. admin_pin_credentials 取得
  const { data: credential, error: fetchError } = await supabase
    .from('admin_pin_credentials')
    .select('auth_user_id, pin_hash, failed_attempts, locked_until')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (fetchError || !credential) {
    return jsonError(ErrorCode.PIN_NOT_SET, 'PINが設定されていません', 404)
  }

  // 5. ロック状態の確認（locked_untilが未来ならロック中。auth_user_id単位で継続する）
  const lockedUntil = credential.locked_until as string | null
  if (lockedUntil && !isExpired(lockedUntil)) {
    await writeAuditLog(supabase, {
      profileId: body.profileId,
      actorAuthUserId: authUserId,
      action: 'verify_admin_pin:locked',
      targetTable: 'admin_pin_credentials',
      targetId: authUserId,
      detail: { reason: 'locked', lockedUntil },
    })
    return jsonError(
      ErrorCode.PIN_LOCKED,
      'PINがロックされています。しばらく時間をおいて再試行してください',
      423,
      { lockedUntil },
    )
  }

  // 6. PIN照合（bcrypt + サーバー側pepper。PIN平文は保存・ログ出力しない）
  let isValid: boolean
  try {
    isValid = await verifyPin(body.pin, credential.pin_hash as string)
  } catch (e) {
    // PIN_PEPPER未設定等の構成不備。PIN平文は含めない。
    console.error('[verify-admin-pin] PIN照合に失敗しました', e instanceof Error ? e.message : e)
    return jsonError(ErrorCode.INTERNAL_ERROR, 'PINの照合に失敗しました', 500)
  }

  // 7-a. 照合失敗: failed_attemptsを加算し、上限到達でロックする
  if (!isValid) {
    const failedAttempts = ((credential.failed_attempts as number | null) ?? 0) + 1
    const shouldLock = failedAttempts >= MAX_FAILED_ATTEMPTS
    const newLockedUntil = shouldLock ? addMinutesIso(LOCK_MINUTES) : null

    const { error: updateError } = await supabase
      .from('admin_pin_credentials')
      .update({
        failed_attempts: failedAttempts,
        locked_until: newLockedUntil,
        updated_at: nowUtcIso(),
      })
      .eq('auth_user_id', authUserId)

    if (updateError) {
      console.error('[verify-admin-pin] failed_attempts更新に失敗しました', updateError.message)
    }

    await writeAuditLog(supabase, {
      profileId: body.profileId,
      actorAuthUserId: authUserId,
      action: shouldLock ? 'verify_admin_pin:locked' : 'verify_admin_pin:failed',
      targetTable: 'admin_pin_credentials',
      targetId: authUserId,
      detail: { failedAttempts, lockedUntil: newLockedUntil },
    })

    if (shouldLock) {
      return jsonError(
        ErrorCode.PIN_LOCKED,
        `PINを${MAX_FAILED_ATTEMPTS}回連続で間違えたため、${LOCK_MINUTES}分間ロックしました`,
        423,
        { lockedUntil: newLockedUntil },
      )
    }
    return jsonError(ErrorCode.PIN_INVALID, 'PINが正しくありません', 401, {
      remainingAttempts: MAX_FAILED_ATTEMPTS - failedAttempts,
    })
  }

  // 7-b. 照合成功: 失敗カウント・ロックをリセットし、PIN確認セッションを作成する
  const { error: resetError } = await supabase
    .from('admin_pin_credentials')
    .update({ failed_attempts: 0, locked_until: null, updated_at: nowUtcIso() })
    .eq('auth_user_id', authUserId)

  if (resetError) {
    return jsonError(ErrorCode.INTERNAL_ERROR, 'PIN状態の更新に失敗しました', 500, resetError.message)
  }

  const verifiedAt = nowUtcIso()
  const expiresAt = addMinutesIso(PIN_SESSION_MINUTES)

  const { error: upsertError } = await supabase.from('pin_verification_sessions').upsert(
    {
      auth_user_id: authUserId,
      auth_session_id: authSessionId,
      verified_at: verifiedAt,
      expires_at: expiresAt,
    },
    { onConflict: 'auth_user_id,auth_session_id' },
  )

  if (upsertError) {
    return jsonError(ErrorCode.INTERNAL_ERROR, 'PIN確認セッションの作成に失敗しました', 500, upsertError.message)
  }

  await writeAuditLog(supabase, {
    profileId: body.profileId,
    actorAuthUserId: authUserId,
    action: 'verify_admin_pin:success',
    targetTable: 'pin_verification_sessions',
    targetId: authUserId,
    detail: { verifiedAt, expiresAt },
  })

  return jsonSuccess({ verified: true, expiresAt })
})
