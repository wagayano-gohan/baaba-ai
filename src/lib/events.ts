// 予定(events)の取得。
// ホーム画面の「今日の予定」で使う。
//
// DBは timestamptz でUTC保存のため、「今日」の範囲は日本時間(JST)基準で計算してから
// UTCのISO文字列に直して問い合わせる（端末のタイムゾーン設定に左右されないようにする）。
// 時刻が未指定の予定は execute-confirmed-action が 00:00 JST として保存するため、
// 表示では「時刻未定」と読み替える。

import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE, supabase } from './supabase'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

export interface TodayEvent {
  id: string
  title: string
  /** DBに保存されているUTCのISO文字列。 */
  startsAt: string
  /** 画面表示用の時刻ラベル（例: 「9:30」「時刻未定」）。 */
  timeLabel: string
}

interface EventRow {
  id: string
  title: string
  starts_at: string
}

/** 端末のタイムゾーンに関わらず、日本時間での「今日」を YYYY-MM-DD で返す。 */
function jstTodayDateString(base: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(base)
}

/** JSTの今日 0:00 〜 翌日 0:00 を、UTCのISO文字列の範囲で返す。 */
function jstTodayRange(base: Date): { fromUtcIso: string; toUtcIso: string } {
  const [year, month, day] = jstTodayDateString(base).split('-').map(Number)
  // Date.UTC でJSTの壁時計を組み立て、9時間戻して実UTCにする。
  const startUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - JST_OFFSET_MS
  return {
    fromUtcIso: new Date(startUtcMs).toISOString(),
    toUtcIso: new Date(startUtcMs + 24 * 60 * 60 * 1000).toISOString(),
  }
}

/** UTCのISO文字列を、JSTの「9:30」形式にする。0:00は時刻未指定とみなす。 */
export function formatEventTimeLabel(startsAtUtcIso: string): string {
  const parsed = new Date(startsAtUtcIso)
  if (Number.isNaN(parsed.getTime())) return '時刻未定'

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(parsed)
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? ''

  // hourCycle次第で 24 時が返ることがあるため 0 に丸める。
  const hour = Number(pick('hour')) % 24
  const minute = pick('minute')
  if (Number.isNaN(hour) || minute === '') return '時刻未定'
  if (hour === 0 && minute === '00') return '時刻未定'
  return `${hour}:${minute}`
}

/**
 * 指定した家族(profile)の「今日（日本時間）」の予定を、開始時刻の早い順に取得する。
 * 取得に失敗した場合はエラーを投げる（呼び出し側で読み込み失敗として表示すること）。
 */
export async function fetchTodayEvents(profileId: string, base: Date = new Date()): Promise<TodayEvent[]> {
  if (!isSupabaseConfigured) {
    throw new Error(SUPABASE_NOT_CONFIGURED_MESSAGE)
  }

  const { fromUtcIso, toUtcIso } = jstTodayRange(base)

  const { data, error } = await supabase
    .from('events')
    .select('id, title, starts_at')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .neq('status', 'cancelled')
    .gte('starts_at', fromUtcIso)
    .lt('starts_at', toUtcIso)
    .order('starts_at', { ascending: true })

  if (error) throw new Error(error.message)

  return ((data ?? []) as EventRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    timeLabel: formatEventTimeLabel(row.starts_at),
  }))
}
