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
import { jstDateToUtcIso, todayJstDateString } from '../_shared/datetime.ts'

interface ExecuteConfirmedActionRequest {
  voiceRequestId: string
  confirmed: boolean
}

// process-voice-input が書き込む interpreted_payload の形。
//   { payload: { title, date, time }, confirmationPrompt }
interface InterpretedPayload {
  payload?: { title?: unknown; date?: unknown; time?: unknown } | null
  confirmationPrompt?: unknown
}

interface ExecutionResult {
  executed: boolean
  reason?: string
  table?: string
  recordId?: string
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * JSTの日付(YYYY-MM-DD)・時刻(HH:MM)を、DB保存用のUTC ISO文字列へ変換する。
 * 時刻がnullの場合は「時刻の指定なし」を表す 00:00 JST として扱う
 * （events.starts_at / tasks.due_at は timestamptz のみで、時刻未指定を表す列が無いため）。
 * 日付・時刻の形式が不正な場合はnullを返す。
 */
function jstDateTimeToUtcIso(date: string, time: string | null): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!dateMatch) return null

  let hour = 0
  let minute = 0
  if (time !== null) {
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time)
    if (!timeMatch) return null
    hour = Number(timeMatch[1])
    minute = Number(timeMatch[2])
    if (hour > 23 || minute > 59) return null
  }

  // Date.UTC でJSTの壁時計をいったんUTCとして組み立て、jstDateToUtcIso で9時間戻して実UTCにする。
  const jstWallClock = new Date(
    Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), hour, minute, 0, 0),
  )
  if (Number.isNaN(jstWallClock.getTime())) return null
  return jstDateToUtcIso(jstWallClock)
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
  //   - create_event … events へINSERT（starts_at は NOT NULL のため必ず値を作る）
  //   - create_task  … tasks へINSERT（due_at は NULL許容のため日付が無ければnull）
  //   - unknown / ambiguous … 何が正解か確定していないため書き込まず failed に遷移する
  // category / status は実マイグレーションのCHECK制約付きデフォルト（events: 'other'/'active'、
  // tasks: 'other'/'open'）に委ねるため、ここでは指定しない。
  const interpreted = (voiceRequest.interpreted_payload ?? null) as InterpretedPayload | null
  const payload = interpreted?.payload ?? null
  const title = asNullableString(payload?.title)
  const date = asNullableString(payload?.date)
  const time = asNullableString(payload?.time)
  const intent = voiceRequest.interpreted_intent as string | null

  // 本人はSupabase Authアカウントを持たないため、記録者としてデバイス登録者(owner_admin)を残す。
  const createdByAuthUserId = deviceAuth.registeredByAuthUserId ?? null

  let executionResult: ExecutionResult = { executed: false, reason: 'unsupported_intent' }

  if (intent !== 'create_event' && intent !== 'create_task') {
    // unknown / ambiguous / 未設定。書き込まずにfailedへ。
    executionResult = { executed: false, reason: 'unsupported_intent' }
  } else if (!title) {
    executionResult = { executed: false, reason: 'missing_title' }
  } else if (intent === 'create_event') {
    // 日付が読み取れなかった場合は、確認済みの内容を失わせないためJSTの今日として登録する。
    const startsAt =
      jstDateTimeToUtcIso(date ?? todayJstDateString(), time) ??
      jstDateTimeToUtcIso(todayJstDateString(), null)

    if (!startsAt) {
      executionResult = { executed: false, reason: 'invalid_datetime' }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('events')
        .insert({
          profile_id: voiceRequest.profile_id,
          title,
          starts_at: startsAt,
          created_by_auth_user_id: createdByAuthUserId,
        })
        .select('id')
        .single()

      executionResult =
        insertError || !inserted
          ? { executed: false, reason: 'insert_failed', table: 'events' }
          : { executed: true, table: 'events', recordId: inserted.id as string }
      if (insertError) console.error('[execute-confirmed-action] events insert failed:', insertError)
    }
  } else {
    // create_task。due_at はNULL許容のため、日付が読み取れなければ期限なしとして登録する。
    const dueAt = date ? jstDateTimeToUtcIso(date, time) : null

    const { data: inserted, error: insertError } = await supabase
      .from('tasks')
      .insert({
        profile_id: voiceRequest.profile_id,
        title,
        due_at: dueAt,
        created_by_auth_user_id: createdByAuthUserId,
      })
      .select('id')
      .single()

    executionResult =
      insertError || !inserted
        ? { executed: false, reason: 'insert_failed', table: 'tasks' }
        : { executed: true, table: 'tasks', recordId: inserted.id as string }
    if (insertError) console.error('[execute-confirmed-action] tasks insert failed:', insertError)
  }

  const executionSucceeded = executionResult.executed

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
