// execute-confirmed-action: ユーザー確認後の実際の書き込み実行、audit_logs記録。
// 呼び出し元: 本人(principal)のデバイス。process-voice-inputで生成された確認待ちアクションを
// ユーザーが承認/却下した結果を受けて実行する。デバイス認証(x-device-token)を使用しJWTは使用しない。
//
// 実マイグレーション準拠:
//   - status は 'received' -> (却下:'rejected' / 承認:'confirmed' -> 実行成功:'executed' / 実行失敗:'failed')
//     の遷移とする（'pending_confirmation'/'cancelled'は存在しない）。
//   - interpreted_intent / interpreted_payload（parsed_actionは存在しない）。
//   - handled_at カラムは存在しないため更新しない。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getDeviceAuthContext } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { writeAuditLog } from '../_shared/audit.ts'

interface ExecuteConfirmedActionRequest {
  voiceRequestId: string
  confirmed: boolean
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: ExecuteConfirmedActionRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.voiceRequestId || typeof body.voiceRequestId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'voiceRequestIdは必須です', 400)
  }
  if (typeof body.confirmed !== 'boolean') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'confirmedは必須です', 400)
  }

  const supabase = createServiceRoleClient()

  // 2. 認証確認（デバイスセッション検証）
  const deviceAuth = await getDeviceAuthContext(req, supabase)
  if (!deviceAuth) {
    return jsonError(ErrorCode.DEVICE_AUTH_INVALID, 'デバイス認証に失敗しました', 401)
  }

  // 3. 対象voice_requestsの取得・状態確認
  const { data: voiceRequest, error: fetchError } = await supabase
    .from('voice_requests')
    .select('id, profile_id, status, interpreted_intent, interpreted_payload')
    .eq('id', body.voiceRequestId)
    .eq('profile_id', deviceAuth.profileId)
    .maybeSingle()

  if (fetchError || !voiceRequest) {
    return jsonError(ErrorCode.VOICE_REQUEST_NOT_FOUND, '対象の音声リクエストが見つかりません', 404)
  }
  if (voiceRequest.status !== 'received') {
    return jsonError(ErrorCode.VOICE_REQUEST_ALREADY_HANDLED, 'このリクエストは既に処理済みです', 409)
  }

  // 4. 却下された場合は'rejected'として記録して終了
  if (!body.confirmed) {
    await supabase.from('voice_requests').update({ status: 'rejected' }).eq('id', voiceRequest.id)

    return jsonSuccess({ status: 'rejected' })
  }

  // 5. 承認: まず'confirmed'に遷移
  await supabase.from('voice_requests').update({ status: 'confirmed' }).eq('id', voiceRequest.id)

  // 6. アクション種別に応じた書き込み実行
  // TODO: interpreted_intent / interpreted_payload に応じて実際のテーブル(tasks/events/contacts等)へ
  //   書き込む処理を実装する。
  //   例:
  //     switch (voiceRequest.interpreted_intent) {
  //       case 'create_task': ... insert into tasks ...
  //       case 'create_event': ... insert into events ...
  //       default: ... 未対応のアクション種別としてfailedに遷移 ...
  //     }
  const executionSucceeded = false // プレースホルダー。実装時に実処理の成否を反映する。
  const executionResult = { executed: executionSucceeded, reason: 'not_implemented' }

  // 7. voice_requestsのステータスを最終状態(executed/failed)に更新
  const finalStatus = executionSucceeded ? 'executed' : 'failed'
  const { error: updateError } = await supabase
    .from('voice_requests')
    .update({ status: finalStatus })
    .eq('id', voiceRequest.id)

  if (updateError) {
    return jsonError(ErrorCode.INTERNAL_ERROR, 'リクエストの更新に失敗しました', 500, updateError.message)
  }

  // 8. audit_logs記録（本人デバイスによる操作のためactorAuthUserIdはnull、actorDeviceIdを設定）
  await writeAuditLog(supabase, {
    profileId: voiceRequest.profile_id as string,
    actorAuthUserId: null,
    actorDeviceId: deviceAuth.deviceId,
    action: 'execute_confirmed_action',
    targetTable: 'voice_requests',
    targetId: voiceRequest.id as string,
    detail: {
      interpretedIntent: voiceRequest.interpreted_intent,
      interpretedPayload: voiceRequest.interpreted_payload,
      executionResult,
    },
  })

  return jsonSuccess({ status: finalStatus, executionResult })
})
