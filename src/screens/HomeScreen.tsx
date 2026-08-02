import { useEffect, useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import { TopBar } from '../components/TopBar'
import {
  BellIcon,
  ChevronRightIcon,
  ClipboardIcon,
  HospitalIcon,
  LocationPinIcon,
  MicIcon,
  MoonIcon,
  SunIcon,
  WalkIcon,
} from '../components/icons'
import type { Appointment } from '../lib/appointments'
import { fetchUpcomingAppointments } from '../lib/appointments'
import { todayCondition, userName, weather } from '../data/schedules'
import { toDateLabel, toTimeLabel } from '../utils/date'
import './HomeScreen.css'

interface HomeScreenProps {
  onStartRecording: () => void
  onNavigateTab: (tab: 'home' | 'schedule' | 'reservation') => void
}

type NextScheduleState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ready'; appointment: Appointment }

// 参考画像①ホーム画面
export function HomeScreen({ onStartRecording, onNavigateTab }: HomeScreenProps) {
  const [state, setState] = useState<NextScheduleState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    fetchUpcomingAppointments(new Date().toISOString())
      .then((list) => {
        if (cancelled) return
        setState(list.length > 0 ? { status: 'ready', appointment: list[0] } : { status: 'empty' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })

    return () => {
      cancelled = true
    }
  }, [])

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

          {state.status === 'loading' && (
            <p className="next-schedule-card__status">読み込み中…</p>
          )}

          {state.status === 'error' && (
            <p className="next-schedule-card__status next-schedule-card__status--error">
              取得に失敗しました（{state.message}）
            </p>
          )}

          {state.status === 'empty' && <p className="next-schedule-card__status">次の予定はありません</p>}

          {state.status === 'ready' && (
            <>
              <div className="next-schedule-card__body">
                <div className="next-schedule-card__icon">
                  <HospitalIcon size={30} />
                </div>
                <div className="next-schedule-card__main">
                  <p className="next-schedule-card__time">{toTimeLabel(new Date(state.appointment.scheduled_at))}</p>
                  <p className="next-schedule-card__title">{state.appointment.title}</p>
                  <p className="next-schedule-card__departure">
                    {state.appointment.departure_note ?? toDateLabel(new Date(state.appointment.scheduled_at))}
                  </p>
                </div>
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
            </>
          )}
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
