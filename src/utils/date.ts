const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土']

/** 例: 「7月29日（水）」 */
export function toDateLabel(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAY_JA[d.getDay()]}）`
}

/** 例: 「10:30」 */
export function toTimeLabel(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * 音声登録フローのダミー下書き（「7月29日（水）」「10:30」等の文字列）を
 * 実際の scheduled_at（ISO日時）に変換する。
 * 音声認識・AIによる日時解析は次フェーズのスコープのため、暫定的に文字列から
 * 月日・時刻を読み取り、実際の「今日」を基準に直近の未来の日付として扱う。
 */
export function parseDraftToScheduledAtISO(dateLabel: string, timeLabel: string): string {
  const dateMatch = dateLabel.match(/(\d+)月(\d+)日/)
  const timeMatch = timeLabel.match(/(\d+):(\d+)/)
  const now = new Date()

  const month = dateMatch ? Number(dateMatch[1]) - 1 : now.getMonth()
  const day = dateMatch ? Number(dateMatch[2]) : now.getDate()
  const hours = timeMatch ? Number(timeMatch[1]) : 9
  const minutes = timeMatch ? Number(timeMatch[2]) : 0

  let candidate = new Date(now.getFullYear(), month, day, hours, minutes, 0, 0)
  // 今日より1日以上前なら来年扱いにする（月日だけの下書きを未来の予定として解釈する）
  if (candidate.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    candidate = new Date(now.getFullYear() + 1, month, day, hours, minutes, 0, 0)
  }
  return candidate.toISOString()
}
