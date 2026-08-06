// setup-principal-account: 本人(principal)用の profiles 初期設定を行う。
// 呼び出し元: owner_admin（オンボーディング時に家族が実施）。JWT必須。
//
// 注意（実マイグレーション準拠）: registered_devices にはpairing_code等のカラムは存在せず、
// device_token_hash が NOT NULL/UNIQUE のため「未登録の仮デバイス行」を作る設計にはできない。
// 実際のデバイス登録（トークン発行）は register-device Edge Function（owner_adminが実行）に
// 完全に分離されている。そのため本Functionはprofiles/profile_membershipsの作成のみを担い、
// デバイス登録は呼び出し元が続けてregister-deviceを呼ぶ運用とする。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { writeAuditLog } from '../_shared/audit.ts'
import { nowUtcIso } from '../_shared/datetime.ts'

interface SetupPrincipalAccountRequest {
  principalName: string
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: SetupPrincipalAccountRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.principalName || typeof body.principalName !== 'string' || body.principalName.trim() === '') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'principalNameは必須です', 400)
  }

  // 2. 認証確認（JWT検証） - この時点では対象profileがまだ存在しないためmembership確認は不要
  const authContext = await getAuthContext(req)
  if (!authContext) {
    return jsonError(ErrorCode.UNAUTHENTICATED, '認証情報が無効です', 401)
  }

  const supabase = createServiceRoleClient()

  // 3. profiles 作成（実カラムはfull_name。nameカラムは存在しない）
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .insert({ full_name: body.principalName.trim(), created_at: nowUtcIso() })
    .select('id')
    .single()

  if (profileError || !profile) {
    return jsonError(ErrorCode.INTERNAL_ERROR, 'profileの作成に失敗しました', 500, profileError?.message)
  }

  // 4. 作成者を owner_admin として profile_memberships に登録
  const { error: membershipError } = await supabase.from('profile_memberships').insert({
    profile_id: profile.id,
    auth_user_id: authContext.authUserId,
    role: 'owner_admin',
    created_at: nowUtcIso(),
  })

  if (membershipError) {
    return jsonError(ErrorCode.INTERNAL_ERROR, 'メンバーシップの作成に失敗しました', 500, membershipError.message)
  }

  // 5. audit_logs記録
  await writeAuditLog(supabase, {
    profileId: profile.id as string,
    actorAuthUserId: authContext.authUserId,
    action: 'setup_principal_account',
    targetTable: 'profiles',
    targetId: profile.id as string,
  })

  // 6. 本人デバイスの登録は別途 register-device を呼び出す運用（このFunctionでは行わない）
  return jsonSuccess({ profileId: profile.id, nextStep: 'register-device' }, 201)
})
