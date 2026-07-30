import { useMemo } from 'react'
import { BottomNav } from '../components/BottomNav'
import { MicIcon } from '../components/icons'
import { initialSchedules, nextScheduleDeparture } from '../data/schedules'
import { formatTodayLabel, getGreeting } from '../utils/greeting'
import './HomeScreen.css'

interface HomeScreenProps {
  onStartRecording: () => void
  onNavigateList: () => void
}

// 仕様書 7章: ①ホーム画面
export function HomeScreen({ onStartRecording, onNavigateList }: HomeScreenProps) {
  const now = useMemo(() => new Date(), [])
  const todayLabel = formatTodayLabel(now)
  const greeting = getGreeting(now)
  const nextSchedule = initialSchedules[0]

  return (
    <div className="home-screen">
      <div className="home-screen__scroll">
        <header className="home-screen__header">
          <p className="home-screen__date">{todayLabel}</p>
          <h1 className="home-screen__greeting">{greeting}</h1>
        </header>

        <section className="next-schedule-card" aria-label="つぎの よてい">
          <p className="next-schedule-card__label">つぎの よてい</p>
          <p className="next-schedule-card__time">{nextSchedule.timeLabel}</p>
          <p className="next-schedule-card__content">{nextSchedule.content}</p>
          <div className="next-schedule-card__departure">
            <p className="next-schedule-card__departure-label">でかける時間</p>
            <p className="next-schedule-card__departure-time">{nextScheduleDeparture}</p>
          </div>
        </section>

        <section className="mic-area">
          <button
            type="button"
            className="mic-button tap-feedback"
            onClick={onStartRecording}
            aria-label="ボタンを おすと おはなしできます"
          >
            <MicIcon size={56} />
          </button>
          <p className="mic-area__caption">ボタンを おすと おはなしできます</p>
        </section>
      </div>

      <BottomNav active="home" onNavigateHome={() => {}} onNavigateList={onNavigateList} />
    </div>
  )
}
