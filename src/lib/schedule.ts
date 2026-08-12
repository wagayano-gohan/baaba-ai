// 予定一覧・やること・買い物メモの取得と更新。
//
// events / tasks の SELECT RLS は `to authenticated` のため、本人(principal)端末からは
// クライアント直接SELECTで0件になる。そのため取得・更新はすべて get-today-events
// Edge Function 経由で行う（本人端末=デバイストークン、家族=JWTのどちらでも動作する）。

import { callFlexibleAuthedFunction } from './apiClient'
import { formatEventTimeLabel } from './events'

const FUNCTION_NAME = 'get-today-events'

export interface UpcomingEvent {
  id: string
  title: string
  /** UTCのISO文字列。 */
  startsAt: string
  /** 「15:00」など。時刻未指定は「時刻未定」。 */
  timeLabel: string
  /** 「8月12日（水）」など、日付ごとの見出しに使う。 */
  dateLabel: string
  /** 日付ごとにまとめるためのキー（JST基準の YYYY-MM-DD）。 */
  dateKey: string
}

export interface TodoTask {
  id: string
  title: string
  /** 'shopping' | 'errand' | 'other' */
  category: string
  /** UTCのISO文字列。期限なしはnull。 */
  dueAt: string | null
}

const WEEKDAY_KANJI = ['日', '月', '火', '水', '木', '金', '土']

/** UTCのISO文字列から、JST基準の YYYY-MM-DD を返す。 */
function jstDateKey(utcIso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(utcIso))
}

/** UTCのISO文字列を「8月12日（水）」形式にする。 */
export function formatEventDateLabel(utcIso: string): string {
  const parsed = new Date(utcIso)
  if (Number.isNaN(parsed.getTime())) return ''
  const [year, month, day] = jstDateKey(utcIso).split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return `${month}月${day}日（${WEEKDAY_KANJI[weekday]}）`
}

/** 期限の表示ラベル。期限なしは空文字。 */
export function formatDueLabel(dueAt: string | null): string {
  if (!dueAt) return ''
  const date = formatEventDateLabel(dueAt)
  const time = formatEventTimeLabel(dueAt)
  return time === '時刻未定' ? date : `${date} ${time}`
}

interface EventsResponse {
  events?: { id: string; title: string; startsAt: string }[]
}

interface TasksResponse {
  tasks?: { id: string; title: string; category: string; dueAt: string | null }[]
}

/** 今日以降の予定を、開始時刻の早い順に取得する。 */
export async function fetchUpcomingEvents(profileId: string | null): Promise<UpcomingEvent[]> {
  const data = await callFlexibleAuthedFunction<EventsResponse>(FUNCTION_NAME, {
    scope: 'events',
    profileId: profileId ?? undefined,
  })

  return (data.events ?? []).map((event) => ({
    id: event.id,
    title: event.title,
    startsAt: event.startsAt,
    timeLabel: formatEventTimeLabel(event.startsAt),
    dateLabel: formatEventDateLabel(event.startsAt),
    dateKey: jstDateKey(event.startsAt),
  }))
}

/** 未完了のやること（買い物メモを含む全カテゴリ）を取得する。 */
export async function fetchOpenTasks(profileId: string | null): Promise<TodoTask[]> {
  const data = await callFlexibleAuthedFunction<TasksResponse>(FUNCTION_NAME, {
    scope: 'tasks',
    profileId: profileId ?? undefined,
  })

  return (data.tasks ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    category: task.category,
    dueAt: task.dueAt ?? null,
  }))
}

/** やることを完了にする。 */
export async function completeTask(profileId: string | null, taskId: string): Promise<void> {
  await callFlexibleAuthedFunction(FUNCTION_NAME, {
    action: 'complete_task',
    taskId,
    profileId: profileId ?? undefined,
  })
}
