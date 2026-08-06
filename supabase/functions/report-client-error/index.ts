// report-client-error: client_error_logs への冪等記録。
// 呼び出し元: 任意のクライアント（RLS拒否時等、認証状態が不安定な場面でも呼ばれ得るため、
// JWT検証は「取得できれば使う」ベストエフォートとし、失敗しても記録自体は継続する）。
// 冪等性は request_id のUNIQUE制約により担保する（同一request_idの再送は成功として扱う）。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { nowUtcIso } from '../_shared/datetime.ts'

interface ReportClientErrorRequest {
  requestId: string
  errorCode: string
  errorMessage: string
  profileId?: string
  /** principalデバイス起点のエラー報告の場合、クライアントが自己申告するdevice_id（相関用途。認証には使わない） */
  deviceId?: string
  context?: Record<string, unknown>
}

// Postgresの一意制約違反
const POSTGRES_UNIQUE_VIOLATION = '23505'

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: ReportClientErrorRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.requestId || typeof body.requestId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'requestIdは必須です（冪等性キーのため）', 400)
  }
  if (!body.errorCode || typeof body.errorCode !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'errorCodeは必須です', 400)
  }
  if (!body.errorMessage || typeof body.errorMessage !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'errorMessageは必須です', 400)
  }

  // 2. 認証確認（ベストエフォート。認証エラー自体を報告するケースがあるため未認証でも継続する）
  const authContext = await getAuthContext(req)

  const supabase = createServiceRoleClient()

  // 3. client_error_logs へ挿入（request_idのUNIQUE制約による冪等性を利用）
  const { error: insertError } = await supabase.from('client_error_logs').insert({
    request_id: body.requestId,
    profile_id: body.profileId ?? null,
    auth_user_id: authContext?.authUserId ?? null,
    device_id: body.deviceId ?? null,
    error_code: body.errorCode,
    error_message: body.errorMessage,
    context: body.context ?? null,
    created_at: nowUtcIso(),
  })

  if (insertError) {
    // 4. 一意制約違反(同一request_idの再送)は冪等成功として扱う
    if ((insertError as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) {
      return jsonSuccess({ recorded: true, deduplicated: true })
    }
    return jsonError(ErrorCode.INTERNAL_ERROR, 'エラーログの記録に失敗しました', 500, insertError.message)
  }

  // client_error_logs自体がログ機能のため、audit_logsへの二重記録は行わない。
  return jsonSuccess({ recorded: true, deduplicated: false }, 201)
})
