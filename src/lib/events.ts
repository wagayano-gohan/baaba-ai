// 予定(events)の取得。
// ホーム画面の「今日の予定」で使う。
//
// DBは timestamptz でUTC保存のため、「今日」の範囲は日本時間(JST)基準で計算してから
// UTCのISO文字列に直して問い合わせる（端末のタイムゾーン設定に左右されないようにする）。
// 時刻が未指定の予定は execute-confirmed-action が 00:00 JST として保存するため、
// 表示では「時刻未定」と読み替える。

// 取得は get-today-events Edge Function 経由で行う。
// events の SELECT RLS が `to authenticated` のため、Supabase Authアカウントを持たない
// 本人(principal)端末からクライアント直接SELECTすると常に0件になり、
// ご本人がホーム画面で自分の予定を見られないため。
import { callFlexibleAuthedFunction } from './apiClient'

export interface TodayEvent {
  id: string
  title: string
  /** DBに保存されているUTCのISO文字列。 */
  startsAt: string
  /** 画面表示用の時刻ラベル（例: 「9:30」「時刻未定」）。 */
  timeLabel: string
}

interface TodayEventsResponse {
  events?: { id: string; title: string; startsAt: string }[]
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
 * 「今日（日本時間）」の予定を、開始時刻の早い順に取得する。
 * 本人端末（デバイストークン）でも家族アカウント（JWT）でも動作する。
 * 取得に失敗した場合はエラーを投げる（呼び出し側で読み込み失敗として表示すること）。
 */
export async function fetchTodayEvents(profileId: string | null): Promise<TodayEvent[]> {
  const data = await callFlexibleAuthedFunction<TodayEventsResponse>('get-today-events', {
    // 本人端末ではデバイストークンから対象profileが決まるため、送っても無視される。
    profileId: profileId ?? undefined,
  })

  return (data.events ?? []).map((event) => ({
    id: event.id,
    title: event.title,
    startsAt: event.startsAt,
    timeLabel: formatEventTimeLabel(event.startsAt),
  }))
}
