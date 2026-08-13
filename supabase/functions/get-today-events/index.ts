// get-today-events: ばーばAIの画面データ入出力を一手に引き受ける読み書きゲートウェイ。
//
// 各テーブルの RLS は `to authenticated` のため、Supabase Authアカウントを持たない
// 本人(principal)端末（デバイストークンのみ）からはクライアント直接SELECT/INSERTが通らない。
// ご本人がホーム画面で自分の予定・お薬・荷物を見られないのは利用上の致命的な支障になるため、
// service roleで読み書きし、profile単位に絞って返す専用Functionを設ける。
// Functionを増やさず、このひとつに全スコープ・全アクションを集約する。
//
// 呼び出し元は2種類（どちらかの認証が通ればよい）:
//   1. 本人端末 … x-device-token（対象profileはトークンから決まる）
//   2. 家族アカウント … Authorization: Bearer <JWT>（profile_membershipsで所属を確認する）
//
// リクエスト: { profileId?, scope?, action?, ...パラメータ }
//   - profileId は家族アカウントの場合は必須
//   - scope 省略時は 'today'（従来どおりの挙動）
//   - action を指定した場合は書き込み操作。owner_admin または本人端末のみ実行できる。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext, getDeviceAuthContext, requireProfileMembership } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { todayJstDateString, jstDateToUtcIso } from '../_shared/datetime.ts'

/** 予定一覧（scope='events'）で一度に返す最大件数。 */
const UPCOMING_EVENTS_LIMIT = 30
/** お薬の予定を一度に作る最大日数。 */
const MEDICATION_MAX_DAYS = 90

const READ_SCOPES = [
  'today',
  'home',
  'events',
  'tasks',
  'medications',
  'deliveries',
  'contacts',
  'locations',
  'notes',
  'settings',
] as const
type ReadScope = (typeof READ_SCOPES)[number]

const WRITE_ACTIONS = [
  'complete_task',
  'add_task',
  'delete_task',
  'add_event',
  'delete_event',
  'take_medication',
  'add_medication',
  'delete_medication',
  'receive_delivery',
  'add_delivery',
  'delete_delivery',
  'add_contact',
  'delete_contact',
  'add_location',
  'delete_location',
  'add_note',
  'delete_note',
  'save_settings',
] as const
/** 読み取り専用（viewerでも実行できる）アクション。 */
const READ_ONLY_ACTIONS = ['note_image_url'] as const
type Action = (typeof WRITE_ACTIONS)[number] | (typeof READ_ONLY_ACTIONS)[number]

/** JSTの今日 0:00 と 翌日 0:00 を、UTCのISO文字列で返す。 */
function todayRangeUtcIso(): { fromIso: string; toIso: string } {
  const today = todayJstDateString() // YYYY-MM-DD（JST基準）
  const [year, month, day] = today.split('-').map(Number)
  const startJst = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
  const endJst = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0))
  return { fromIso: jstDateToUtcIso(startJst), toIso: jstDateToUtcIso(endJst) }
}

/** JSTの「今日+offsetDays」の0:00と、その日の終わりをUTCのISO文字列で返す。 */
function dayRangeUtcIso(offsetDays: number): { fromIso: string; toIso: string } {
  const [year, month, day] = todayJstDateString().split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, day + offsetDays, 0, 0, 0))
  const end = new Date(Date.UTC(year, month - 1, day + offsetDays + 1, 0, 0, 0))
  return { fromIso: jstDateToUtcIso(start), toIso: jstDateToUtcIso(end) }
}

/** JSTの曜日番号（日曜=0）を返す。offsetDaysで翌日以降も取れる。 */
function jstWeekday(offsetDays = 0): number {
  const [year, month, day] = todayJstDateString().split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).getUTCDay()
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** profiles.memo に格納したアプリ設定（ゴミの日など）を安全に読み出す。 */
interface AppSettings {
  /** 曜日番号(0=日)→ゴミの種類。空文字・未設定は「収集なし」。 */
  garbage: Record<string, string>
}

function parseSettings(memo: unknown): AppSettings {
  const empty: AppSettings = { garbage: {} }
  if (typeof memo !== 'string' || memo.trim() === '') return empty
  try {
    const parsed = JSON.parse(memo)
    if (!parsed || typeof parsed !== 'object') return empty
    const garbage = (parsed as { garbage?: unknown }).garbage
    if (!garbage || typeof garbage !== 'object') return empty
    const result: Record<string, string> = {}
    for (const key of ['0', '1', '2', '3', '4', '5', '6']) {
      const value = (garbage as Record<string, unknown>)[key]
      if (typeof value === 'string' && value.trim() !== '') result[key] = value.trim()
    }
    return { garbage: result }
  } catch {
    return empty
  }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) ?? {}
  } catch {
    // ボディ無しでも本人端末なら成立するため、ここでは失敗させない。
  }

  // scope未指定は従来どおり「今日の予定」。未知の値は誤用を通さないためエラーにする。
  const scope = (body.scope === undefined ? 'today' : body.scope) as ReadScope
  if (!READ_SCOPES.includes(scope)) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'scopeの指定が不正です', 400)
  }

  const action = body.action as Action | undefined
  const isWriteAction = action !== undefined && (WRITE_ACTIONS as readonly string[]).includes(action)
  const isReadOnlyAction =
    action !== undefined && (READ_ONLY_ACTIONS as readonly string[]).includes(action)
  if (action !== undefined && !isWriteAction && !isReadOnlyAction) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'actionの指定が不正です', 400)
  }

  const supabase = createServiceRoleClient()

  // 1. 対象profileの決定と権限確認
  let profileId = ''
  // 書き込みは閲覧のみ(viewer)の家族には許可しない。
  let canWrite = false
  let actorAuthUserId: string | null = null

  const deviceAuth = req.headers.get('x-device-token')
    ? await getDeviceAuthContext(req, supabase)
    : null

  if (deviceAuth) {
    // 本人端末はトークンに紐づくprofileのみ参照できる（他profileの指定は無視する）。
    profileId = deviceAuth.profileId
    canWrite = true
    actorAuthUserId = deviceAuth.registeredByAuthUserId
  } else {
    const authContext = await getAuthContext(req)
    if (!authContext) {
      return jsonError(ErrorCode.UNAUTHENTICATED, '認証情報が無効です', 401)
    }
    if (typeof body.profileId !== 'string' || body.profileId === '') {
      return jsonError(ErrorCode.VALIDATION_ERROR, 'profileIdは必須です', 400)
    }
    const membership = await requireProfileMembership(
      supabase,
      authContext.authUserId,
      body.profileId,
    )
    if (!membership) {
      return jsonError(
        ErrorCode.PROFILE_ACCESS_DENIED,
        'このプロフィールを参照する権限がありません',
        403,
      )
    }
    profileId = body.profileId
    canWrite = membership.role === 'owner_admin'
    actorAuthUserId = authContext.authUserId
  }

  if (isWriteAction && !canWrite) {
    return jsonError(ErrorCode.ROLE_NOT_ALLOWED, 'この操作を行う権限がありません', 403)
  }

  const nowIso = new Date().toISOString()

  // ---------------------------------------------------------------
  // 2. 書き込み・単発アクション
  // ---------------------------------------------------------------
  if (action) {
    switch (action) {
      case 'complete_task':
      case 'delete_task': {
        const taskId = str(body.taskId)
        if (!taskId) return jsonError(ErrorCode.VALIDATION_ERROR, 'taskIdは必須です', 400)

        const patch =
          action === 'complete_task'
            ? { status: 'done', completed_at: nowIso }
            : { deleted_at: nowIso }

        let query = supabase
          .from('tasks')
          .update(patch)
          .eq('id', taskId)
          .eq('profile_id', profileId)
          .is('deleted_at', null)
        if (action === 'complete_task') query = query.eq('status', 'open')

        const { data, error } = await query.select('id, status').maybeSingle()
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '更新できませんでした', 500, error.message)
        }
        if (!data) return jsonError(ErrorCode.NOT_FOUND, '対象が見つかりませんでした', 404)
        return jsonSuccess({ task: { id: data.id as string, status: data.status as string } })
      }

      case 'add_task': {
        const title = str(body.title)
        if (!title) return jsonError(ErrorCode.VALIDATION_ERROR, '内容を入力してください', 400)
        const category = str(body.category) ?? 'other'
        if (!['shopping', 'errand', 'other'].includes(category)) {
          return jsonError(ErrorCode.VALIDATION_ERROR, 'categoryの指定が不正です', 400)
        }
        const { data, error } = await supabase
          .from('tasks')
          .insert({
            profile_id: profileId,
            title,
            category,
            due_at: str(body.dueAt),
            created_by_auth_user_id: actorAuthUserId,
          })
          .select('id')
          .single()
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '登録できませんでした', 500, error.message)
        }
        return jsonSuccess({ id: data.id as string })
      }

      case 'add_event': {
        const title = str(body.title)
        const startsAt = str(body.startsAt)
        if (!title) return jsonError(ErrorCode.VALIDATION_ERROR, '予定の内容を入力してください', 400)
        if (!startsAt) return jsonError(ErrorCode.VALIDATION_ERROR, '日付を選んでください', 400)
        const category = str(body.category) ?? 'other'
        if (!['hospital', 'pickup', 'meal', 'visit', 'other'].includes(category)) {
          return jsonError(ErrorCode.VALIDATION_ERROR, 'categoryの指定が不正です', 400)
        }
        const { data, error } = await supabase
          .from('events')
          .insert({
            profile_id: profileId,
            title,
            category,
            starts_at: startsAt,
            location_text: str(body.locationText),
            created_by_auth_user_id: actorAuthUserId,
          })
          .select('id')
          .single()
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '登録できませんでした', 500, error.message)
        }
        return jsonSuccess({ id: data.id as string })
      }

      case 'delete_event': {
        const eventId = str(body.eventId)
        if (!eventId) return jsonError(ErrorCode.VALIDATION_ERROR, 'eventIdは必須です', 400)
        const { data, error } = await supabase
          .from('events')
          .update({ deleted_at: nowIso })
          .eq('id', eventId)
          .eq('profile_id', profileId)
          .is('deleted_at', null)
          .select('id')
          .maybeSingle()
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '削除できませんでした', 500, error.message)
        }
        if (!data) return jsonError(ErrorCode.NOT_FOUND, '対象が見つかりませんでした', 404)
        return jsonSuccess({ id: data.id as string })
      }

      case 'take_medication': {
        const id = str(body.medicationLogId)
        if (!id) return jsonError(ErrorCode.VALIDATION_ERROR, 'medicationLogIdは必須です', 400)
        const { data, error } = await supabase
          .from('medication_logs')
          .update({ status: 'taken', taken_at: nowIso })
          .eq('id', id)
          .eq('profile_id', profileId)
          .is('deleted_at', null)
          .select('id, status')
          .maybeSingle()
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '記録できませんでした', 500, error.message)
        }
        if (!data) return jsonError(ErrorCode.NOT_FOUND, '対象が見つかりませんでした', 404)
        return jsonSuccess({ medication: { id: data.id as string, status: data.status as string } })
      }

      case 'add_medication': {
        const name = str(body.medicationName)
        if (!name) return jsonError(ErrorCode.VALIDATION_ERROR, 'お薬の名前を入力してください', 400)
        const rawTimes = Array.isArray(body.times) ? body.times : []
        const times = rawTimes
          .map((t) => str(t))
          .filter((t): t is string => Boolean(t && /^\d{1,2}:\d{2}$/.test(t)))
        if (times.length === 0) {
          return jsonError(ErrorCode.VALIDATION_ERROR, '飲む時間を選んでください', 400)
        }
        const days = Math.min(Math.max(num(body.days) ?? 30, 1), MEDICATION_MAX_DAYS)
        const dosage = str(body.dosage)

        const [year, month, day] = todayJstDateString().split('-').map(Number)
        const rows: Record<string, unknown>[] = []
        for (let offset = 0; offset < days; offset++) {
          for (const time of times) {
            const [hour, minute] = time.split(':').map(Number)
            const jstWall = new Date(Date.UTC(year, month - 1, day + offset, hour, minute, 0))
            const scheduledAt = jstDateToUtcIso(jstWall)
            // 今日ぶんで既に過ぎた時刻は作らない（開始直後に「飲み忘れ」が並ぶのを避ける）。
            if (offset === 0 && scheduledAt < nowIso) continue
            rows.push({
              profile_id: profileId,
              medication_name: name,
              dosage,
              scheduled_at: scheduledAt,
              status: 'scheduled',
            })
          }
        }
        if (rows.length === 0) {
          return jsonError(ErrorCode.VALIDATION_ERROR, '登録できる予定がありませんでした', 400)
        }
        const { error } = await supabase.from('medication_logs').insert(rows)
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '登録できませんでした', 500, error.message)
        }
        return jsonSuccess({ created: rows.length })
      }

      case 'delete_medication': {
        // まだ飲んでいない予定だけを取り消す（過去の服薬記録は残す）。
        const name = str(body.medicationName)
        if (!name) return jsonError(ErrorCode.VALIDATION_ERROR, 'medicationNameは必須です', 400)
        const { error } = await supabase
          .from('medication_logs')
          .update({ deleted_at: nowIso })
          .eq('profile_id', profileId)
          .eq('medication_name', name)
          .eq('status', 'scheduled')
          .gte('scheduled_at', nowIso)
          .is('deleted_at', null)
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '削除できませんでした', 500, error.message)
        }
        return jsonSuccess({ deleted: true })
      }

      case 'receive_delivery': {
        const id = str(body.deliveryId)
        if (!id) return jsonError(ErrorCode.VALIDATION_ERROR, 'deliveryIdは必須です', 400)
        const { data, error } = await supabase
          .from('deliveries')
          .update({ status: 'delivered', delivered_at: nowIso })
          .eq('id', id)
          .eq('profile_id', profileId)
          .is('deleted_at', null)
          .select('id, status')
          .maybeSingle()
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '記録できませんでした', 500, error.message)
        }
        if (!data) return jsonError(ErrorCode.NOT_FOUND, '対象が見つかりませんでした', 404)
        return jsonSuccess({ delivery: { id: data.id as string, status: data.status as string } })
      }

      case 'add_delivery': {
        const itemName = str(body.itemName)
        if (!itemName) return jsonError(ErrorCode.VALIDATION_ERROR, '荷物の名前を入力してください', 400)
        const { data, error } = await supabase
          .from('deliveries')
          .insert({
            profile_id: profileId,
            item_name: itemName,
            carrier: str(body.carrier),
            tracking_number: str(body.trackingNumber),
            expected_at: str(body.expectedAt),
            memo: str(body.memo),
          })
          .select('id')
          .single()
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '登録できませんでした', 500, error.message)
        }
        return jsonSuccess({ id: data.id as string })
      }

      case 'delete_delivery': {
        const id = str(body.deliveryId)
        if (!id) return jsonError(ErrorCode.VALIDATION_ERROR, 'deliveryIdは必須です', 400)
        const { error } = await supabase
          .from('deliveries')
          .update({ deleted_at: nowIso })
          .eq('id', id)
          .eq('profile_id', profileId)
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '削除できませんでした', 500, error.message)
        }
        return jsonSuccess({ deleted: true })
      }

      case 'add_contact': {
        const name = str(body.name)
        if (!name) return jsonError(ErrorCode.VALIDATION_ERROR, '名前を入力してください', 400)
        const { data, error } = await supabase
          .from('contacts')
          .insert({
            profile_id: profileId,
            name,
            relationship: str(body.relationship),
            phone_number: str(body.phoneNumber),
            is_favorite: body.isFavorite === true,
            memo: str(body.memo),
          })
          .select('id')
          .single()
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '登録できませんでした', 500, error.message)
        }
        return jsonSuccess({ id: data.id as string })
      }

      case 'delete_contact': {
        const id = str(body.contactId)
        if (!id) return jsonError(ErrorCode.VALIDATION_ERROR, 'contactIdは必須です', 400)
        const { error } = await supabase
          .from('contacts')
          .update({ deleted_at: nowIso })
          .eq('id', id)
          .eq('profile_id', profileId)
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '削除できませんでした', 500, error.message)
        }
        return jsonSuccess({ deleted: true })
      }

      case 'add_location': {
        const name = str(body.name)
        if (!name) return jsonError(ErrorCode.VALIDATION_ERROR, '場所の名前を入力してください', 400)
        const category = str(body.category) ?? 'other'
        if (!['home', 'hospital', 'store', 'family', 'other'].includes(category)) {
          return jsonError(ErrorCode.VALIDATION_ERROR, 'categoryの指定が不正です', 400)
        }
        // 自宅は天気の取得地点にも使うため、1件だけになるよう既存の自宅は置き換える。
        if (category === 'home') {
          await supabase
            .from('locations')
            .update({ deleted_at: nowIso })
            .eq('profile_id', profileId)
            .eq('category', 'home')
            .is('deleted_at', null)
        }
        const { data, error } = await supabase
          .from('locations')
          .insert({
            profile_id: profileId,
            name,
            category,
            address: str(body.address),
            latitude: num(body.latitude),
            longitude: num(body.longitude),
            memo: str(body.memo),
          })
          .select('id')
          .single()
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '登録できませんでした', 500, error.message)
        }
        return jsonSuccess({ id: data.id as string })
      }

      case 'delete_location': {
        const id = str(body.locationId)
        if (!id) return jsonError(ErrorCode.VALIDATION_ERROR, 'locationIdは必須です', 400)
        const { error } = await supabase
          .from('locations')
          .update({ deleted_at: nowIso })
          .eq('id', id)
          .eq('profile_id', profileId)
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '削除できませんでした', 500, error.message)
        }
        return jsonSuccess({ deleted: true })
      }

      case 'add_note': {
        const title = str(body.title)
        const noteBody = str(body.body)
        if (!title && !noteBody) {
          return jsonError(ErrorCode.VALIDATION_ERROR, 'メモの内容を入力してください', 400)
        }
        const { data, error } = await supabase
          .from('notes')
          .insert({
            profile_id: profileId,
            title,
            body: noteBody,
            created_by_auth_user_id: actorAuthUserId,
          })
          .select('id')
          .single()
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '保存できませんでした', 500, error.message)
        }
        return jsonSuccess({ id: data.id as string })
      }

      case 'delete_note': {
        const id = str(body.noteId)
        if (!id) return jsonError(ErrorCode.VALIDATION_ERROR, 'noteIdは必須です', 400)
        const { error } = await supabase
          .from('notes')
          .update({ deleted_at: nowIso })
          .eq('id', id)
          .eq('profile_id', profileId)
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '削除できませんでした', 500, error.message)
        }
        return jsonSuccess({ deleted: true })
      }

      case 'note_image_url': {
        const id = str(body.noteId)
        if (!id) return jsonError(ErrorCode.VALIDATION_ERROR, 'noteIdは必須です', 400)
        const { data: note } = await supabase
          .from('notes')
          .select('image_path')
          .eq('id', id)
          .eq('profile_id', profileId)
          .maybeSingle()
        if (!note?.image_path) {
          return jsonError(ErrorCode.NOT_FOUND, 'このメモには写真がありません', 404)
        }
        const { data: signed, error } = await supabase.storage
          .from('notes-images')
          .createSignedUrl(note.image_path as string, 300)
        if (error || !signed) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '写真を表示できませんでした', 500, error?.message)
        }
        return jsonSuccess({ signedUrl: signed.signedUrl })
      }

      case 'save_settings': {
        const rawGarbage = (body.garbage ?? {}) as Record<string, unknown>
        const garbage: Record<string, string> = {}
        for (const key of ['0', '1', '2', '3', '4', '5', '6']) {
          const value = str(rawGarbage[key])
          if (value) garbage[key] = value.slice(0, 40)
        }
        const { error } = await supabase
          .from('profiles')
          .update({ memo: JSON.stringify({ garbage }) })
          .eq('id', profileId)
        if (error) {
          return jsonError(ErrorCode.INTERNAL_ERROR, '保存できませんでした', 500, error.message)
        }
        return jsonSuccess({ saved: true })
      }
    }
  }

  // ---------------------------------------------------------------
  // 3. 読み取り
  // ---------------------------------------------------------------

  const mapEvents = (rows: Record<string, unknown>[] | null) =>
    (rows ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      startsAt: row.starts_at as string,
      category: row.category as string,
      locationText: (row.location_text as string | null) ?? null,
    }))

  const mapMedications = (rows: Record<string, unknown>[] | null) =>
    (rows ?? []).map((row) => ({
      id: row.id as string,
      medicationName: row.medication_name as string,
      dosage: (row.dosage as string | null) ?? null,
      scheduledAt: row.scheduled_at as string,
      status: row.status as string,
      takenAt: (row.taken_at as string | null) ?? null,
    }))

  const mapDeliveries = (rows: Record<string, unknown>[] | null) =>
    (rows ?? []).map((row) => ({
      id: row.id as string,
      itemName: (row.item_name as string | null) ?? '荷物',
      carrier: (row.carrier as string | null) ?? null,
      status: row.status as string,
      expectedAt: (row.expected_at as string | null) ?? null,
      memo: (row.memo as string | null) ?? null,
    }))

  async function loadSettings(): Promise<AppSettings> {
    const { data } = await supabase.from('profiles').select('memo').eq('id', profileId).maybeSingle()
    return parseSettings(data?.memo)
  }

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

  if (scope === 'medications') {
    // 今日ぶん＋これから7日ぶんを返す。飲み忘れ確認のため過去12時間ぶんも含める。
    const from = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    const to = dayRangeUtcIso(7).toIso
    const { data, error } = await supabase
      .from('medication_logs')
      .select('id, medication_name, dosage, scheduled_at, status, taken_at')
      .eq('profile_id', profileId)
      .is('deleted_at', null)
      .gte('scheduled_at', from)
      .lt('scheduled_at', to)
      .order('scheduled_at', { ascending: true })

    if (error) {
      return jsonError(ErrorCode.INTERNAL_ERROR, 'お薬を取得できませんでした', 500, error.message)
    }
    return jsonSuccess({ medications: mapMedications(data) })
  }

  if (scope === 'deliveries') {
    const { data, error } = await supabase
      .from('deliveries')
      .select('id, item_name, carrier, status, expected_at, memo')
      .eq('profile_id', profileId)
      .is('deleted_at', null)
      .neq('status', 'delivered')
      .order('expected_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })

    if (error) {
      return jsonError(ErrorCode.INTERNAL_ERROR, '荷物を取得できませんでした', 500, error.message)
    }
    return jsonSuccess({ deliveries: mapDeliveries(data) })
  }

  if (scope === 'contacts') {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, name, relationship, phone_number, is_favorite, memo')
      .eq('profile_id', profileId)
      .is('deleted_at', null)
      .order('is_favorite', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) {
      return jsonError(ErrorCode.INTERNAL_ERROR, '連絡先を取得できませんでした', 500, error.message)
    }
    const contacts = (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      relationship: (row.relationship as string | null) ?? null,
      phoneNumber: (row.phone_number as string | null) ?? null,
      isFavorite: row.is_favorite === true,
      memo: (row.memo as string | null) ?? null,
    }))
    return jsonSuccess({ contacts })
  }

  if (scope === 'locations') {
    const { data, error } = await supabase
      .from('locations')
      .select('id, name, category, address, latitude, longitude, memo')
      .eq('profile_id', profileId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })

    if (error) {
      return jsonError(ErrorCode.INTERNAL_ERROR, '場所を取得できませんでした', 500, error.message)
    }
    const locations = (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      category: row.category as string,
      address: (row.address as string | null) ?? null,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      memo: (row.memo as string | null) ?? null,
    }))
    return jsonSuccess({ locations })
  }

  if (scope === 'notes') {
    const { data, error } = await supabase
      .from('notes')
      .select('id, title, body, image_path, created_at')
      .eq('profile_id', profileId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      return jsonError(ErrorCode.INTERNAL_ERROR, 'メモを取得できませんでした', 500, error.message)
    }
    const notes = (data ?? []).map((row) => ({
      id: row.id as string,
      title: (row.title as string | null) ?? null,
      body: (row.body as string | null) ?? null,
      hasImage: Boolean(row.image_path),
      createdAt: row.created_at as string,
    }))
    return jsonSuccess({ notes })
  }

  if (scope === 'settings') {
    const settings = await loadSettings()
    const { data: home } = await supabase
      .from('locations')
      .select('id, name, address, latitude, longitude')
      .eq('profile_id', profileId)
      .eq('category', 'home')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return jsonSuccess({
      settings,
      home: home
        ? {
            id: home.id as string,
            name: home.name as string,
            address: (home.address as string | null) ?? null,
            latitude: home.latitude === null ? null : Number(home.latitude),
            longitude: home.longitude === null ? null : Number(home.longitude),
          }
        : null,
    })
  }

  if (scope === 'home') {
    // ホーム画面が必要とするものを1回で返す（表示が段階的にちらつくのを防ぐ）。
    const today = todayRangeUtcIso()
    const soonIso = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    const pastIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()

    const [eventsRes, medsRes, deliveriesRes, tasksRes, settings, homeRes] = await Promise.all([
      supabase
        .from('events')
        .select('id, title, starts_at, category, location_text')
        .eq('profile_id', profileId)
        .is('deleted_at', null)
        .neq('status', 'cancelled')
        .gte('starts_at', today.fromIso)
        .lt('starts_at', today.toIso)
        .order('starts_at', { ascending: true }),
      supabase
        .from('medication_logs')
        .select('id, medication_name, dosage, scheduled_at, status, taken_at')
        .eq('profile_id', profileId)
        .is('deleted_at', null)
        .gte('scheduled_at', pastIso)
        .lt('scheduled_at', soonIso)
        .order('scheduled_at', { ascending: true }),
      supabase
        .from('deliveries')
        .select('id, item_name, carrier, status, expected_at, memo')
        .eq('profile_id', profileId)
        .is('deleted_at', null)
        .neq('status', 'delivered')
        .order('expected_at', { ascending: true, nullsFirst: false }),
      supabase
        .from('tasks')
        .select('id')
        .eq('profile_id', profileId)
        .is('deleted_at', null)
        .eq('status', 'open'),
      loadSettings(),
      supabase
        .from('locations')
        .select('name, address, latitude, longitude')
        .eq('profile_id', profileId)
        .eq('category', 'home')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const todayWeekday = String(jstWeekday(0))
    const tomorrowWeekday = String(jstWeekday(1))

    return jsonSuccess({
      events: mapEvents(eventsRes.data),
      medications: mapMedications(medsRes.data),
      deliveries: mapDeliveries(deliveriesRes.data),
      openTaskCount: (tasksRes.data ?? []).length,
      garbage: {
        today: settings.garbage[todayWeekday] ?? null,
        tomorrow: settings.garbage[tomorrowWeekday] ?? null,
      },
      home: homeRes.data
        ? {
            name: homeRes.data.name as string,
            address: (homeRes.data.address as string | null) ?? null,
            latitude: homeRes.data.latitude === null ? null : Number(homeRes.data.latitude),
            longitude: homeRes.data.longitude === null ? null : Number(homeRes.data.longitude),
          }
        : null,
    })
  }

  // scope === 'today' | 'events'
  const { fromIso, toIso } = todayRangeUtcIso()
  let query = supabase
    .from('events')
    .select('id, title, starts_at, category, location_text')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .neq('status', 'cancelled')
    .gte('starts_at', fromIso)

  query = scope === 'events' ? query.limit(UPCOMING_EVENTS_LIMIT) : query.lt('starts_at', toIso)

  const { data, error } = await query.order('starts_at', { ascending: true })

  if (error) {
    return jsonError(ErrorCode.INTERNAL_ERROR, '予定を取得できませんでした', 500, error.message)
  }

  return jsonSuccess({ events: mapEvents(data) })
})
