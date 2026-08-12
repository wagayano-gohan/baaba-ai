// 予定一覧画面。
//
// ホーム画面が「今日の予定」だけを見せるのに対し、この画面は今日以降の予定をまとめて確認する。
// 日付ごとに見出しを立て、その下に「時刻＋予定名」を並べる。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getDeviceProfileId } from '../lib/deviceToken'
import { fetchUpcomingEvents } from '../lib/schedule'
import type { UpcomingEvent } from '../lib/schedule'
import './EventListScreen.css'

interface EventListScreenProps {
  /** 「戻る」を押したとき。 */
  onBack: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'

interface EventDateGroup {
  dateKey: string
  dateLabel: string
  events: UpcomingEvent[]
}

/** 開始時刻順に並んだ予定を、同じ日付ごとにまとめる。 */
function groupByDate(events: UpcomingEvent[]): EventDateGroup[] {
  const groups: EventDateGroup[] = []
  for (const event of events) {
    const last = groups[groups.length - 1]
    if (last && last.dateKey === event.dateKey) {
      last.events.push(event)
    } else {
      groups.push({ dateKey: event.dateKey, dateLabel: event.dateLabel, events: [event] })
    }
  }
  return groups
}

export function EventListScreen({ onBack }: EventListScreenProps) {
  const [events, setEvents] = useState<UpcomingEvent[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')

  // 家族アカウントでログイン中なら選択中のprofile、本人端末（デバイストークン）なら
  // 端末に保存されたprofileを見る。どちらも無い場合は取得しない。
  const { activeProfileId } = useAuth()
  const profileId = activeProfileId ?? getDeviceProfileId()

  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    if (!profileId) {
      setEvents([])
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    void fetchUpcomingEvents(profileId)
      .then((rows) => {
        if (cancelled) return
        setEvents(rows)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[EventListScreen] 予定を取得できませんでした:', error)
        setEvents([])
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [profileId, reloadKey])

  const groups = useMemo(() => groupByDate(events), [events])

  return (
    <div className="event-list">
      <header className="event-list__header">
        <button type="button" className="event-list__back tap-feedback" onClick={onBack}>
          ← 戻る
        </button>
        <h1 className="event-list__title">予定</h1>
      </header>

      <div className="event-list__body">
        {status === 'loading' && <p className="event-list__message">読み込んでいます…</p>}

        {status === 'error' && (
          <div className="event-list__error">
            <p className="event-list__message event-list__message--error">
              予定を読み込めませんでした
            </p>
            <button type="button" className="event-list__retry tap-feedback" onClick={reload}>
              もう一度読み込む
            </button>
          </div>
        )}

        {status === 'ready' && groups.length === 0 && (
          <p className="event-list__message">予定はありません</p>
        )}

        {status === 'ready' &&
          groups.map((group) => (
            <section key={group.dateKey} className="event-list__group">
              <h2 className="event-list__date">{group.dateLabel}</h2>
              <ul className="event-list__items">
                {group.events.map((event) => (
                  <li key={event.id} className="event-list__item">
                    <span className="event-list__time">{event.timeLabel}</span>
                    <span className="event-list__name">{event.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </div>
  )
}
