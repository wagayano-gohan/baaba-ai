import { useEffect, useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import { TopBar } from '../components/TopBar'
import { ChevronLeftIcon, ChevronRightIcon, ClipboardIcon, MicIcon, PlusIcon } from '../components/icons'
import type { Appointment } from '../lib/appointments'
import { fetchAllAppointments } from '../lib/appointments'
import { buildMonthGrid } from '../utils/calendar'
import { isSameDay, toDateLabel, toTimeLabel } from '../utils/date'
import './ScheduleListScreen.css'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

interface ScheduleScreenProps {
  onStartRecording: () => void
  onNavigateTab: (tab: 'home' | 'schedule' | 'reservation') => void
  onSelectAppointment: (appointment: Appointment) => void
}

// 参考画像②予定画面
export function ScheduleScreen({ onStartRecording, onNavigateTab, onSelectAppointment }: ScheduleScreenProps) {
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar')
  const [items, setItems] = useState<Appointment[]>([])
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    fetchAllAppointments()
      .then((list) => {
        if (cancelled) return
        setItems(list)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setErrorMessage(error instanceof Error ? error.message : String(error))
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const today = new Date()
  const weeks = buildMonthGrid(today.getFullYear(), today.getMonth() + 1)

  const eventDays = new Set(
    items
      .filter((item) => {
        const d = new Date(item.scheduled_at)
        return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()
      })
      .map((item) => new Date(item.scheduled_at).getDate()),
  )

  const visibleItems =
    viewMode === 'calendar' ? items.filter((item) => isSameDay(new Date(item.scheduled_at), today)) : items

  return (
    <div className="schedule-screen">
      <TopBar
        title="予定"
        right={
          <button type="button" className="schedule-screen__add-icon tap-feedback" onClick={onStartRecording} aria-label="予定を追加する">
            <PlusIcon size={18} />
          </button>
        }
      />

      <div className="schedule-screen__scroll">
        <div className="view-tabs">
          <button
            type="button"
            className={`view-tabs__item tap-feedback ${viewMode === 'calendar' ? 'is-active' : ''}`}
            onClick={() => setViewMode('calendar')}
          >
            カレンダー
          </button>
          <button
            type="button"
            className={`view-tabs__item tap-feedback ${viewMode === 'list' ? 'is-active' : ''}`}
            onClick={() => setViewMode('list')}
          >
            リスト
          </button>
          <button type="button" className="view-tabs__item view-tabs__item--muted tap-feedback">
            週
          </button>
          <button type="button" className="view-tabs__item view-tabs__item--muted tap-feedback">
            月
          </button>
        </div>

        {viewMode === 'calendar' && (
          <section className="month-calendar" aria-label="月表示カレンダー">
            <div className="month-calendar__header">
              <button type="button" className="month-calendar__nav tap-feedback" aria-label="前の月">
                <ChevronLeftIcon size={18} />
              </button>
              <p className="month-calendar__title">
                {today.getFullYear()}年{today.getMonth() + 1}月
              </p>
              <button type="button" className="month-calendar__nav tap-feedback" aria-label="次の月">
                <ChevronRightIcon size={18} />
              </button>
            </div>

            <div className="month-calendar__weekdays">
              {WEEKDAYS.map((w, i) => (
                <span
                  key={w}
                  className={`month-calendar__weekday ${i === 0 ? 'is-sun' : ''} ${i === 6 ? 'is-sat' : ''}`}
                >
                  {w}
                </span>
              ))}
            </div>

            <div className="month-calendar__grid">
              {weeks.map((week, wi) => (
                <div className="month-calendar__row" key={`week-${wi}`}>
                  {week.map((cell, ci) => {
                    const isToday = cell.inMonth && cell.day === today.getDate()
                    const hasEvent = cell.inMonth && eventDays.has(cell.day)
                    return (
                      <div className="month-calendar__cell" key={`${wi}-${ci}`}>
                        <span
                          className={[
                            'month-calendar__day',
                            !cell.inMonth ? 'is-muted' : '',
                            isToday ? 'is-today' : '',
                            cell.inMonth && ci === 0 && !isToday ? 'is-sun' : '',
                            cell.inMonth && ci === 6 && !isToday ? 'is-sat' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {cell.day}
                        </span>
                        {hasEvent && (
                          <span className={`month-calendar__dot ${isToday ? 'is-today' : ''}`} aria-hidden="true" />
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>
        )}

        <h2 className="schedule-screen__day-heading">
          {toDateLabel(today)} {viewMode === 'calendar' ? '今日' : 'の予定'}
        </h2>

        {status === 'loading' && <p className="schedule-screen__status">読み込み中…</p>}
        {status === 'error' && (
          <p className="schedule-screen__status schedule-screen__status--error">取得に失敗しました（{errorMessage}）</p>
        )}
        {status === 'ready' && visibleItems.length === 0 && (
          <p className="schedule-screen__status">よていは ありません</p>
        )}

        {status === 'ready' && visibleItems.length > 0 && (
          <ul className="schedule-row-list">
            {visibleItems.map((item) => {
              const d = new Date(item.scheduled_at)
              const subtitle = item.departure_note || item.location || ''
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="schedule-row schedule-row--button tap-feedback"
                    onClick={() => onSelectAppointment(item)}
                  >
                    <span className="schedule-row__icon schedule-row__icon--blue">
                      <ClipboardIcon size={20} />
                    </span>
                    <span className="schedule-row__text">
                      <span className="schedule-row__title">
                        {viewMode === 'list' ? `${toDateLabel(d)}　${toTimeLabel(d)}` : toTimeLabel(d)}　{item.title}
                      </span>
                      {subtitle && <span className="schedule-row__subtitle">{subtitle}</span>}
                    </span>
                    <ChevronRightIcon size={18} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <button type="button" className="schedule-screen__add-button tap-feedback" onClick={onStartRecording}>
          <MicIcon size={20} />
          予定を追加する
        </button>
      </div>

      <BottomNav active="schedule" onNavigateTab={onNavigateTab} />
    </div>
  )
}
