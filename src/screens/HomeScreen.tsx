import { BottomNav } from '../components/BottomNav'
import { TopBar } from '../components/TopBar'
import {
  BellIcon,
  BusIcon,
  ChevronRightIcon,
  ClipboardIcon,
  HospitalIcon,
  LocationPinIcon,
  MicIcon,
  MoonIcon,
  SunIcon,
  TaxiIcon,
  WalkIcon,
} from '../components/icons'
import { nextSchedule, todayCondition, userName, weather } from '../data/schedules'
import './HomeScreen.css'

interface HomeScreenProps {
  onStartRecording: () => void
  onNavigateTab: (tab: 'home' | 'schedule' | 'reservation') => void
}

// 参考画像①ホーム画面
export function HomeScreen({ onStartRecording, onNavigateTab }: HomeScreenProps) {
  return (
    <div className="home-screen">
      <TopBar right={<BellIcon size={22} />} />

      <div className="home-screen__scroll">
        <section className="home-screen__greeting-block">
          <h1 className="home-screen__greeting">
            おはようございます、
            <br />
            {userName}
          </h1>
          <p className="home-screen__weather">
            <SunIcon size={18} />
            <span>
              {weather.dateLabel}　{weather.summary}　最高{weather.high}℃／最低{weather.low}℃
            </span>
          </p>
        </section>

        <section className="next-schedule-card" aria-label="次の予定">
          <div className="next-schedule-card__label">
            <span className="next-schedule-card__label-dot" aria-hidden="true" />
            次の予定
          </div>

          <div className="next-schedule-card__body">
            <div className="next-schedule-card__icon">
              <HospitalIcon size={30} />
            </div>
            <div className="next-schedule-card__main">
              <p className="next-schedule-card__time">{nextSchedule.timeLabel}</p>
              <p className="next-schedule-card__title">{nextSchedule.title}</p>
              <p className="next-schedule-card__departure">{nextSchedule.departureLabel}</p>
            </div>
          </div>

          <div className="next-schedule-card__transport">
            <span className="next-schedule-card__transport-item">
              <BusIcon size={18} />
              {nextSchedule.transport.bus}
            </span>
            <span className="next-schedule-card__transport-item">
              <TaxiIcon size={18} />
              {nextSchedule.transport.taxi}
            </span>
          </div>

          <div className="next-schedule-card__actions">
            <button type="button" className="next-schedule-card__button tap-feedback">
              <LocationPinIcon size={18} />
              行き方を見る
            </button>
            <button type="button" className="next-schedule-card__button tap-feedback">
              <ClipboardIcon size={18} />
              予定の詳細
            </button>
          </div>
        </section>

        <button type="button" className="voice-card tap-feedback" onClick={onStartRecording}>
          <span className="voice-card__icon">
            <MicIcon size={26} />
          </span>
          <span className="voice-card__text">
            <span className="voice-card__title">何をしますか？</span>
            <span className="voice-card__subtitle">話してください</span>
          </span>
        </button>

        <section className="condition-card" aria-label="今日の様子">
          <p className="condition-card__heading">今日の様子</p>
          <div className="condition-card__row">
            <div className="condition-card__item">
              <span className="condition-card__icon condition-card__icon--walk">
                <WalkIcon size={20} />
              </span>
              <span className="condition-card__text">
                <span className="condition-card__label">歩数</span>
                <span className="condition-card__value">{todayCondition.steps}歩</span>
              </span>
            </div>
            <div className="condition-card__divider" />
            <div className="condition-card__item">
              <span className="condition-card__icon condition-card__icon--sleep">
                <MoonIcon size={18} />
              </span>
              <span className="condition-card__text">
                <span className="condition-card__label">睡眠</span>
                <span className="condition-card__value">{todayCondition.sleep}</span>
              </span>
            </div>
            <ChevronRightIcon size={18} />
          </div>
        </section>
      </div>

      <BottomNav active="home" onNavigateTab={onNavigateTab} />
    </div>
  )
}
