import { useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import { TopBar } from '../components/TopBar'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ForkKnifeIcon,
  HospitalIcon,
  MicIcon,
  PackageIcon,
  PlusIcon,
} from '../components/icons'
import { CALENDAR_MONTH, CALENDAR_YEAR, EVENT_DAYS, TODAY_DAY, todaySchedules } from '../data/schedules'
import type { ScheduleIcon } from '../data/schedules'
import { buildMonthGrid } from '../utils/calendar'
import './ScheduleListScreen.css'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

interface ScheduleScreenProps {
  onStartRecording: () => void
  onNavigateTab: (tab: 'home' | 'schedule' | 'reservation') => void
}

function ScheduleIconBadge({ icon }: { icon: ScheduleIcon }) {
  if (icon === 'hospital') {
    return (
      <span className="schedule-row__icon schedule-row__icon--blue">
        <HospitalIcon size={20} />
      </span>
    )
  }
  if (icon === 'package') {
    return (
      <span className="schedule-row__icon schedule-row__icon--yellow">
        <PackageIcon size={20} />
      </span>
    )
  }
  return (
    <span className="schedule-row__icon schedule-row__icon--orange">
      <ForkKnifeIcon size={18} />
    </span>
  )
}

// 参考画像②予定画面
export function ScheduleScreen({ onStartRecording, onNavigateTab }: ScheduleScreenProps) {
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar')
  const weeks = buildMonthGrid(CALENDAR_YEAR, CALENDAR_MONTH)

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
                {CALENDAR_YEAR}年{CALENDAR_MONTH}月
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
                    const isToday = cell.inMonth && cell.day === TODAY_DAY
                    const hasEvent = cell.inMonth && EVENT_DAYS.includes(cell.day)
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
          7月{TODAY_DAY}日（月） {viewMode === 'calendar' ? '今日' : 'の予定'}
        </h2>

        <ul className="schedule-row-list">
          {todaySchedules.map((item) => (
            <li key={item.id} className="schedule-row tap-feedback">
              <ScheduleIconBadge icon={item.icon} />
              <span className="schedule-row__text">
                <span className="schedule-row__title">
                  {item.timeLabel}　{item.title}
                </span>
                <span className="schedule-row__subtitle">{item.subtitle}</span>
              </span>
              <ChevronRightIcon size={18} />
            </li>
          ))}
        </ul>

        <button type="button" className="schedule-screen__add-button tap-feedback" onClick={onStartRecording}>
          <MicIcon size={20} />
          予定を追加する
        </button>
      </div>

      <BottomNav active="schedule" onNavigateTab={onNavigateTab} />
    </div>
  )
}
