// get-today-events: ホーム画面「今日の予定」／予定一覧／ToDo・買い物メモを取得する。
//
// events / tasks の SELECT RLS は `to authenticated` のため、Supabase Authアカウントを持たない
// 本人(principal)端末（デバイストークンのみ）からはクライアント直接SELECTで0件になる。
// 本人がホーム画面で自分の予定を見られないのは利用上の致命的な支障になるため、
// service roleで読み出してprofile単位に絞って返す専用の読み取りFunctionを設ける。
// 予定一覧・ToDo・買い物メモも同じ制約を受けるため、Functionを増やさずこの1つに集約する。
//
// 呼び出し元は2種類（どちらかの認証が通ればよい）:
//   1. 本人端末 … x-device-token（対象profileはトークンから決まる）
//   2. 家族アカウント … Authorization: Bearer <JWT>（profile_membershipsで所属を確認する）
//
// リクエスト:
//   { profileId?: string, scope?: 'today' | 'events' | 'tasks',
//     action?: 'complete_task', taskId?: string }
//   - profileId は家族アカウントの場合は必須
//   - scope 省略時は 'today'（従来どおりの挙動）
// レスポンス:
//   scope='today'  … jsonSuccess({ events: [{ id, title, startsAt, category }] })（今日ぶん）
//   scope='events' … jsonSuccess({ events: [...] })（今日以降・最大30件）
//   scope='tasks'  … jsonSuccess({ tasks: [{ id, title, category, dueAt, status }] })（未完了のみ）
//   action='complete_task' … jsonSuccess({ task: { id, status } })

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext, getDeviceAuthContext, requireProfileMembership } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { todayJstDateString, jstDateToUtcIso } from '../_shared/datetime.ts'

/** 予定一覧（scope='events'）で一度に返す最大件数。 */
const UPCOMING_EVENTS_LIMIT = 30

/** JSTの今日 0:00 と 翌日 0:00 を、UTCのISO文字列で返す。 */
function todayRangeUtcIso(): { fromIso: string; toIso: string } {
  const today = todayJstDateString() // YYYY-MM-DD（JST基準）
  const [year, month, day] = today.split('-').map(Number)
  const startJst = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
  const endJst = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0))
  return { fromIso: jstDateToUtcIso(startJst), toIso: jstDateToUtcIso(endJst) }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  let body: { profileId?: unknown; scope?: unknown; action?: unknown; taskId?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    // ボディ無しでも本人端末なら成立するため、ここでは失敗させない。
  }

  // scope未指定は従来どおり「今日の予定」。未知の値は誤用を通さないためエラーにする。
  const scope = body.scope === undefined ? 'today' : body.scope
  if (scope !== 'today' && scope !== 'events' && scope !== 'tasks') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'scopeの指定が不正です', 400)
  }

  const isCompleteTask = body.action === 'complete_task'
  if (body.action !== undefined && !isCompleteTask) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'actionの指定が不正です', 400)
  }

  const supabase = createServiceRoleClient()

  // 1. 対象profileの決定と権限確認
  let profileId: string | null = null
  // 更新（完了チェック）は書き込み操作のため、閲覧のみ(viewer)の家族には許可しない。
  let canWrite = false

  const deviceAuth = req.headers.get('x-device-token')
    ? await getDeviceAuthContext(req, supabase)
    : null

  if (deviceAuth) {
    // 本人端末はトークンに紐づくprofileのみ参照できる（他profileの指定は無視する）。
    profileId = deviceAuth.profileId
    canWrite = true
  } else {
    const authContext = await getAuthContext(req)
    if (!authContext) {
      return jsonError(ErrorCode.UNAUTHENTICATED, '認証情報が無効です', 401)
    }
    if (typeof body.profileId !== 'string' || body.profileId === '') {
      return jsonError(ErrorCode.VALIDATION_ERROR, 'profileIdは必須です', 400)
    }
    const membership = await requireProfileMembership(supabase, authContext.authUserId, body.profileId)
    if (!membership) {
      return jsonError(ErrorCode.PROFILE_ACCESS_DENIED, 'このプロフィールを参照する権限がありません', 403)
    }
    profileId = body.profileId
    canWrite = membership.role === 'owner_admin'
  }

  // 2. 完了チェック（tasksのUPDATE）
  if (isCompleteTask) {
    if (typeof body.taskId !== 'string' || body.taskId === '') {
      return jsonError(ErrorCode.VALIDATION_ERROR, 'taskIdは必須です', 400)
    }
    if (!canWrite) {
      return jsonError(ErrorCode.ROLE_NOT_ALLOWED, 'この操作を行う権限がありません', 403)
    }

    const nowIso = new Date().toISOString()
    const { data, error } = await supabase
      .from('tasks')
      .update({ status: 'done', completed_at: nowIso })
      .eq('id', body.taskId)
      .eq('profile_id', profileId)
      .is('deleted_at', null)
      .eq('status', 'open')
      .select('id, status')
      .maybeSingle()

    if (error) {
      return jsonError(ErrorCode.INTERNAL_ERROR, '完了にできませんでした', 500, error.message)
    }
    if (!data) {
      // 既に完了済み・削除済み・他profileのタスクなど。
      return jsonError(ErrorCode.NOT_FOUND, '対象が見つかりませんでした', 404)
    }

    return jsonSuccess({ task: { id: data.id as string, status: data.status as string } })
  }

  // 3. 未完了タスク（ToDo・買い物メモ）
  if (scope === 'tasks') {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, category, due_at, status')
      .eq('profile_id', profileId)
      .is('deleted_at', null)
      .eq('status', 'open')
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })

    if (error) {
      return jsonError(ErrorCode.INTERNAL_ERROR, 'やることを取得できませんでした', 500, error.message)
    }

    const tasks = (data ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      category: row.category as string,
      dueAt: (row.due_at as string | null) ?? null,
      status: row.status as string,
    }))

    return jsonSuccess({ tasks })
  }

  // 4. 予定（scope='today' は今日ぶん、scope='events' は今日以降）
  const { fromIso, toIso } = todayRangeUtcIso()
  let query = supabase
    .from('events')
    .select('id, title, starts_at, category')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .neq('status', 'cancelled')
    .gte('starts_at', fromIso)

  query = scope === 'events' ? query.limit(UPCOMING_EVENTS_LIMIT) : query.lt('starts_at', toIso)

  const { data, error } = await query.order('starts_at', { ascending: true })

  if (error) {
    return jsonError(ErrorCode.INTERNAL_ERROR, '予定を取得できませんでした', 500, error.message)
  }

  const events = (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    startsAt: row.starts_at as string,
    category: row.category as string,
  }))

  return jsonSuccess({ events })
})
