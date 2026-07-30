import { userName } from '../data/schedules'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

// 仕様書 7.3: 「7月29日（水）」形式（曜日は括弧書き、和暦は使わない）
export function formatTodayLabel(date: Date): string {
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekday = WEEKDAYS[date.getDay()]
  return `${month}月${day}日（${weekday}）`
}

// 仕様書 7.3: 時間帯に応じた挨拶文の自動切替
export function getGreeting(date: Date): string {
  const hour = date.getHours()
  if (hour >= 5 && hour <= 10) {
    return `おはようございます、${userName}`
  }
  if (hour >= 11 && hour <= 16) {
    return `こんにちは、${userName}`
  }
  return `こんばんは、${userName}`
}
