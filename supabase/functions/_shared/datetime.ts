// 日時ユーティリティ。
// 方針: DBは timestamptz で UTC固定保存。JST変換は表示・メール文面等の生成時のみ行う。
// Edge Function内でDBに書き込む値は必ずUTCのISO文字列(new Date().toISOString())を使うこと。

const JST_OFFSET_MINUTES = 9 * 60

export function nowUtcIso(): string {
  return new Date().toISOString()
}

export function minutesAgoIso(minutes: number, base: Date = new Date()): string {
  return new Date(base.getTime() - minutes * 60_000).toISOString()
}

export function addMinutesIso(minutes: number, base: Date = new Date()): string {
  return new Date(base.getTime() + minutes * 60_000).toISOString()
}

export function isExpired(expiresAtIso: string, base: Date = new Date()): boolean {
  return new Date(expiresAtIso).getTime() <= base.getTime()
}

/** UTCのISO文字列を「表示専用」のJST時刻Dateに変換する。DB保存にはこの戻り値を使わないこと。 */
export function utcIsoToJstDisplayDate(utcIso: string): Date {
  const utcDate = new Date(utcIso)
  return new Date(utcDate.getTime() + JST_OFFSET_MINUTES * 60_000)
}

/** JST基準で入力されたDateをUTCのISO文字列に変換する（フォーム入力等をDBに保存する際に使用） */
export function jstDateToUtcIso(jstDate: Date): string {
  return new Date(jstDate.getTime() - JST_OFFSET_MINUTES * 60_000).toISOString()
}

/** JST基準の YYYY-MM-DD 文字列を返す（weather_cache.forecast_date 等に使用） */
export function todayJstDateString(base: Date = new Date()): string {
  const jst = utcIsoToJstDisplayDate(base.toISOString())
  return jst.toISOString().slice(0, 10)
}
