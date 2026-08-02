// 参考画像（予定画面）に準拠したダミーデータ。実際のデータ保存・通信は行わない。

export type ScheduleIcon = 'hospital' | 'package' | 'food' | 'beauty'

export interface ScheduleItem {
  id: number
  /** カレンダー上の日（例: 27） */
  day: number
  /** 例: 「7月27日（月）」 */
  dateLabel: string
  /** 例: 「10:30」 */
  timeLabel: string
  /** 例: 「〇〇病院」 */
  title: string
  /** 例: 「9:50に出発」「受け取り予定」 */
  subtitle: string
  icon: ScheduleIcon
}

// 2026年7月のダミー月（参考画像と同じ月・同じ「今日」を採用する）
export const CALENDAR_YEAR = 2026
export const CALENDAR_MONTH = 7 // 1-12
export const TODAY_DAY = 27

// 予定がある日（カレンダーのドット表示用）
export const EVENT_DAYS = [23, 24, 27, 31]

// 7月27日（今日）の予定一覧
export const todaySchedules: ScheduleItem[] = [
  {
    id: 1,
    day: 27,
    dateLabel: '7月27日（月）',
    timeLabel: '10:30',
    title: '〇〇病院',
    subtitle: '9:50に出発',
    icon: 'hospital',
  },
  {
    id: 2,
    day: 27,
    dateLabel: '7月27日（月）',
    timeLabel: '15:00',
    title: 'Amazonの荷物',
    subtitle: '受け取り予定',
    icon: 'package',
  },
  {
    id: 3,
    day: 27,
    dateLabel: '7月27日（月）',
    timeLabel: '18:00',
    title: '立川で夕食',
    subtitle: 'レストラン予約済み',
    icon: 'food',
  },
]

// 次の予定（ホーム画面「次の予定」カード用）
export const nextSchedule = {
  timeLabel: '10:30',
  title: '〇〇病院',
  departureLabel: '9:50に出発してください',
  transport: {
    bus: 'バスで約25分',
    taxi: 'タクシーで約18分',
  },
}

// 今日の様子（ホーム画面下部）
export const todayCondition = {
  steps: '3,240',
  sleep: '7時間10分',
}

// 天気（ホーム画面）
export const weather = {
  dateLabel: '7月27日（月）',
  summary: '晴れ',
  high: 33,
  low: 26,
}

// 祖母の呼び名（ダミー）
export const userName = '花子さん'

// ②③ 音声登録フロー（録音中→AI確認画面）専用のダミーデータ。
// カレンダー／一覧の ScheduleItem とは形が異なるため独立させている。
export interface VoiceDraftSchedule {
  dateLabel: string
  timeLabel: string
  content: string
}

export const voiceDraftSchedule: VoiceDraftSchedule = {
  dateLabel: '7月29日（水）',
  timeLabel: '10:30',
  content: '病院（内科）',
}
