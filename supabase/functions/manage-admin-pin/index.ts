// manage-admin-pin: owner_adminのPIN設定・変更・再設定。
// 呼び出し元: owner_admin。JWT必須。operation: 'set' | 'change' | 'reset'
//
// 実行条件（正式確定仕様）:
//   set    … Authログイン済み + owner_admin + PIN未設定。new_pin === confirm_pin。
//   change … 上記に加えて「有効な管理者PIN確認セッション（10分以内）」が必要。current_pin照合も行う。
//   reset  … PINを忘れた場合の再設定。Edge Function内でアカウントパスワードを再照合する。
//            照合には専用の一時Supabase Authクライアントを使い、取得したセッションは
//            現在の管理者セッションとして保存・返却・置換しない（照合後に必ず破棄する）。
//            成功時はそのauth_user_idの既存PIN確認セッションをすべて失効させる。
//
// PIN平文・account_password は DB・audit_logs・ログ出力のいずれにも絶対に残さない。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import {
  requireAuthContextWithSession,
  requireProfileMembership,
  hasValidPinSession,
} from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { writeAuditLog } from '../_shared/audit.ts'
import { nowUtcIso } from '../_shared/datetime.ts'
import { hashPin, verifyPin } from '../_shared/pin.ts'

type PinOperation = 'set' | 'change' | 'reset'

interface ManageAdminPinRequest {
  /** owner_admin権限確認の対象profile（audit_logs記録にも使用する） */
  profileId: string
  operation: PinOperation
  new_pin: string
  confirm_pin: string
  /** operation='change' のとき必須 */
  current_pin?: string
  /** operation='reset' のとき必須。ログイン中ユーザーのアカウントパスワード */
  account_password?: string
}

/** PINは4桁数字（正式確定仕様） */
const PIN_RE = /^\d{4}$/
const OPERATIONS: PinOperation[] = ['set', 'change', 'reset']

/**
 * パスワード再照合専用の一時Authクライアント。
 * createRequestScopedClient（呼び出し元JWTを引き継ぐ）や service role クライアントは流用しない。
 * persistSession=false のため、ここで得たセッションはどこにも保存されない。
 */
function createTemporaryAuthClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY が設定されていません')
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: ManageAdminPinRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.profileId || typeof body.profileId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'profileIdは必須です', 400)
  }
  if (!OPERATIONS.includes(body.operation)) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'operationはset/change/resetのいずれかである必要があります', 400)
  }
  if (!body.new_pin || typeof body.new_pin !== 'string' || !PIN_RE.test(body.new_pin)) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'new_pinは4桁の数字である必要があります', 400)
  }
  if (!body.confirm_pin || typeof body.confirm_pin !== 'string' || !PIN_RE.test(body.confirm_pin)) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'confirm_pinは4桁の数字である必要があります', 400)
  }
  if (body.new_pin !== body.confirm_pin) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'new_pinとconfirm_pinが一致しません', 400)
  }
  if (body.operation === 'change' && (!body.current_pin || !PIN_RE.test(body.current_pin))) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'changeにはcurrent_pin（4桁の数字）が必要です', 400)
  }
  if (
    body.operation === 'reset' &&
    (!body.account_password || typeof body.account_password !== 'string')
  ) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'resetにはaccount_passwordが必要です', 400)
  }

  // 2. 認証確認（JWT検証 + session_id取得）
  const auth = await requireAuthContextWithSession(req)
  if (!auth.ok) return auth.response
  const { authUserId, authSessionId, email } = auth.context

  const supabase = createServiceRoleClient()

  // 3. profile_memberships確認（owner_adminのみ許可。主キーはmembership_id）
  const membership = await requireProfileMembership(supabase, authUserId, body.profileId, ['owner_admin'])
  if (!membership) {
    return jsonError(ErrorCode.PROFILE_ACCESS_DENIED, 'この操作を行う権限がありません', 403)
  }

  // 4. 既存のadmin_pin_credentials取得
  const { data: credential } = await supabase
    .from('admin_pin_credentials')
    .select('auth_user_id, pin_hash')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (body.operation === 'set' && credential) {
    return jsonError(ErrorCode.ALREADY_EXISTS, '既にPINが設定されています。変更はchangeを使用してください', 409)
  }
  if ((body.operation === 'change' || body.operation === 'reset') && !credential) {
    return jsonError(ErrorCode.PIN_NOT_SET, 'PINが設定されていません', 404)
  }

  // 5. operationごとの本人確認
  if (body.operation === 'change') {
    // 5-a. 有効な管理者PIN確認セッション（verify-admin-pinで作成、10分間有効）が必須
    const pinVerified = await hasValidPinSession(supabase, authUserId, authSessionId)
    if (!pinVerified) {
      return jsonError(ErrorCode.PIN_REQUIRED, 'この操作にはPIN確認が必要です', 403)
    }

    // 5-b. 現在のPINを照合
    let isCurrentValid: boolean
    try {
      isCurrentValid = await verifyPin(body.current_pin as string, credential!.pin_hash as string)
    } catch (e) {
      console.error('[manage-admin-pin] PIN照合に失敗しました', e instanceof Error ? e.message : e)
      return jsonError(ErrorCode.INTERNAL_ERROR, 'PINの照合に失敗しました', 500)
    }
    if (!isCurrentValid) {
      await writeAuditLog(supabase, {
        profileId: body.profileId,
        actorAuthUserId: authUserId,
        action: 'manage_admin_pin:change_failed',
        targetTable: 'admin_pin_credentials',
        targetId: authUserId,
        detail: { reason: 'current_pin_mismatch' },
      })
      return jsonError(ErrorCode.PIN_INVALID, '現在のPINが正しくありません', 401)
    }
  }

  if (body.operation === 'reset') {
    // 5-c. アカウントパスワードによる本人確認。
    //      一時クライアントで signInWithPassword し、成功可否のみを判定する。
    //      取得したセッションは現在の管理者セッションとして保存・返却・置換しない。
    if (!email) {
      return jsonError(ErrorCode.UNAUTHENTICATED, 'アカウントのメールアドレスを取得できませんでした', 401)
    }

    let passwordVerified = false
    let temporaryClient: ReturnType<typeof createTemporaryAuthClient> | null = null
    try {
      temporaryClient = createTemporaryAuthClient()
      const { data: signInData, error: signInError } = await temporaryClient.auth.signInWithPassword({
        email,
        password: body.account_password as string,
      })
      passwordVerified = !signInError && !!signInData?.user && signInData.user.id === authUserId
    } catch (e) {
      // パスワードは絶対にログに出さない
      console.error('[manage-admin-pin] パスワード再照合に失敗しました', e instanceof Error ? e.message : e)
      passwordVerified = false
    } finally {
      // 一時セッションは必ず破棄する。scope:'local' により、この一時クライアントのセッションのみを
      // 失効させる（'global'は同一ユーザーの全セッション＝現在の管理者セッションまで失効させるため使わない）。
      if (temporaryClient) {
        try {
          await temporaryClient.auth.signOut({ scope: 'local' })
        } catch {
          // 破棄失敗は主処理をブロックしない（persistSession=falseのためセッションは保持されない）
        }
        temporaryClient = null
      }
    }

    if (!passwordVerified) {
      await writeAuditLog(supabase, {
        profileId: body.profileId,
        actorAuthUserId: authUserId,
        action: 'manage_admin_pin:reset_failed',
        targetTable: 'admin_pin_credentials',
        targetId: authUserId,
        detail: { reason: 'account_password_mismatch' },
      })
      return jsonError(ErrorCode.UNAUTHENTICATED, 'アカウントパスワードが正しくありません', 401)
    }
  }

  // 6. 新PINのハッシュ化・保存（failed_attempts/locked_untilもリセットする）
  let newPinHash: string
  try {
    newPinHash = await hashPin(body.new_pin)
  } catch (e) {
    console.error('[manage-admin-pin] PINハッシュ化に失敗しました', e instanceof Error ? e.message : e)
    return jsonError(ErrorCode.INTERNAL_ERROR, 'PINの保存に失敗しました', 500)
  }

  const { error: upsertError } = await supabase.from('admin_pin_credentials').upsert(
    {
      auth_user_id: authUserId,
      pin_hash: newPinHash,
      failed_attempts: 0,
      locked_until: null,
      updated_at: nowUtcIso(),
    },
    { onConflict: 'auth_user_id' },
  )

  if (upsertError) {
    return jsonError(ErrorCode.INTERNAL_ERROR, 'PINの保存に失敗しました', 500, upsertError.message)
  }

  // 7. reset時は既存のPIN確認セッションをすべて失効させる（PINを知らない者による継続利用を防ぐ）
  if (body.operation === 'reset') {
    const { error: deleteError } = await supabase
      .from('pin_verification_sessions')
      .delete()
      .eq('auth_user_id', authUserId)

    if (deleteError) {
      console.error('[manage-admin-pin] PIN確認セッションの失効に失敗しました', deleteError.message)
    }
  }

  // 8. audit_logs記録（PIN平文・パスワードはdetailに含めない）
  await writeAuditLog(supabase, {
    profileId: body.profileId,
    actorAuthUserId: authUserId,
    action: `manage_admin_pin:${body.operation}`,
    targetTable: 'admin_pin_credentials',
    targetId: authUserId,
    detail: { operation: body.operation, updatedAt: nowUtcIso() },
  })

  return jsonSuccess({ operation: body.operation, updated: true })
})
