// ホーム画面（MVP）。
//
// ご本人が毎日いちばん最初に見る画面。
// 1画面に置く要素は「あいさつ＋日付」「大きな音声ボタン」「今日の予定」
// 「AIに相談」の4つまでに絞り、迷わないようにする。
// 管理者向けメニューへの導線は、誤タップを避けるため画面下部に小さく置く。

import { useEffect, useState } from 'react'
import { MicIcon } from '../components/icons'
import './HomeScreen.css'

interface HomeScreenProps {
  /** 大きな音声ボタン（話しかける）を押したとき。 */
  onGoVoice: () => void
  /** 「AIに相談」を押したとき。 */
  onGoChat: () => void
  /** 画面下部の小さな「設定」を押したとき（管理者向けメニューへ）。 */
  onGoSettings: () => void
}

/** 曜日を漢字1文字で表す（日曜=0 〜 土曜=6）。 */
const WEEKDAY_KANJI = ['日', '月', '火', '水', '木', '金', '土']

/** en-USの短縮曜日名から曜日番号（日曜=0）への対応。 */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

interface JstNow {
  month: number
  day: number
  hour: number
  weekday: number
}

// 端末のタイムゾーン設定に左右されず、常に日本時間で「日付」「時刻」を求める。
function getJstNow(base: Date): JstNow {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(base)

  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? ''

  // hourCycle次第で 24 時が返ることがあるため 0 に丸める。
  const hour = Number(pick('hour')) % 24

  return {
    month: Number(pick('month')),
    day: Number(pick('day')),
    hour: Number.isNaN(hour) ? 0 : hour,
    weekday: WEEKDAY_INDEX[pick('weekday')] ?? 0,
  }
}

function greetingOf(hour: number): string {
  if (hour < 10) return 'おはようございます'
  if (hour < 17) return 'こんにちは'
  return 'こんばんは'
}

export function HomeScreen({ onGoVoice, onGoChat, onGoSettings }: HomeScreenProps) {
  const [now, setNow] = useState<JstNow>(() => getJstNow(new Date()))

  // 日付またぎや、あいさつが切り替わる時刻（10時・17時）をまたいでも
  // 画面を開き直さずに表示が正しくなるよう、1分ごとに更新する。
  useEffect(() => {
    const timer = window.setInterval(() => setNow(getJstNow(new Date())), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const dateText = `${now.month}月${now.day}日（${WEEKDAY_KANJI[now.weekday]}）`

  return (
    <div className="home">
      <header className="home__header">
        <p className="home__greeting">{greetingOf(now.hour)}</p>
        <p className="home__date">{dateText}</p>
      </header>

      <button
        type="button"
        className="home__voice tap-feedback"
        onClick={onGoVoice}
        aria-label="音声で話しかける"
      >
        <span className="home__voice-icon" aria-hidden="true">
          <MicIcon size={64} />
        </span>
        <span className="home__voice-label">話しかける</span>
      </button>

      <section className="home__schedule">
        <h2 className="home__schedule-title">今日の予定</h2>
        {/* TODO: Phase3でeventsテーブルから取得 */}
        <p className="home__schedule-empty">本日の予定はありません</p>
      </section>

      <button type="button" className="home__chat tap-feedback" onClick={onGoChat}>
        AIに相談
      </button>

      <div className="home__footer">
        <button type="button" className="home__settings" onClick={onGoSettings}>
          設定
        </button>
      </div>
    </div>
  )
}
