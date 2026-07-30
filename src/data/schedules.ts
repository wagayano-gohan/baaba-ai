// 仕様書 11章「ダミーデータ一覧」をそのまま使用する固定データ。
// 実際のデータ保存・通信は行わない（画面内の一時的な状態のみ）。

export interface ScheduleItem {
  id: number
  /** 例: 「7月29日（水）」 */
  dateLabel: string
  /** 例: 「10時30分」 */
  timeLabel: string
  /** 例: 「病院（内科）」 */
  content: string
}

// No.1〜No.5（日付の早い順）
export const initialSchedules: ScheduleItem[] = [
  { id: 1, dateLabel: '7月29日（水）', timeLabel: '10時30分', content: '病院（内科）' },
  { id: 2, dateLabel: '7月31日（金）', timeLabel: '14時00分', content: 'デイサービス' },
  { id: 3, dateLabel: '8月2日（日）', timeLabel: '9時00分', content: '娘の家族が来る' },
  { id: 4, dateLabel: '8月5日（水）', timeLabel: '13時30分', content: '美容院' },
  { id: 5, dateLabel: '8月8日（土）', timeLabel: '11時00分', content: '公民館の体操教室' },
]

// ①ホーム画面「つぎの よてい」に表示する、出発時刻の案内（No.1にのみ紐づくダミー文言）
export const nextScheduleDeparture = '10時00分に 出発'

// ③AI確認画面（新規登録）に表示するダミーデータ = No.1と同内容
export const recordedDummySchedule: ScheduleItem = initialSchedules[0]

// 祖母の呼び名（ダミー）
export const userName = '花子さん'
