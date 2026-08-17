// ゴミの日画面。
//
// 曜日ごとのゴミ出し設定（ご本人が話しかけて覚えさせたもの）をもとに、
// 「今日」「明日」を最初に大きく見せ、その下に日曜〜土曜の一覧を置く。
// 出し忘れの防止が目的のため、判断に必要な今日・明日を画面上部に固定して置いている。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyGuide } from '../components/EmptyGuide'
import { useAuth } from '../contexts/AuthContext'
import { getDeviceProfileId } from '../lib/deviceToken'
import { fetchSettings, jstWeekday, weekdayKanji } from '../lib/data'
import type { GarbageSchedule } from '../lib/data'
import './GarbageScreen.css'

interface GarbageScreenProps {
  /** 「戻る」を押したとき。 */
  onBack: () => void
  /** 空状態の「話しかける」を押したとき。 */
  onGoVoice: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'

export function GarbageScreen({ onBack, onGoVoice }: GarbageScreenProps) {
  const [garbage, setGarbage] = useState<GarbageSchedule>({})
  const [status, setStatus] = useState<LoadStatus>('loading')

  // 家族アカウントでログイン中なら選択中のprofile、本人端末（デバイストークン）なら
  // 端末に保存されたprofileを見る。どちらも無い場合は取得しない。
  const { activeProfileId } = useAuth()
  const profileId = activeProfileId ?? getDeviceProfileId()

  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    if (!profileId) {
      setGarbage({})
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    void fetchSettings(profileId)
      .then((data) => {
        if (cancelled) return
        setGarbage(data.settings.garbage)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[GarbageScreen] ゴミの日を取得できませんでした:', error)
        setGarbage({})
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [profileId, reloadKey])

  // 曜日番号は画面を開いている間に日付がまたぐことは想定しないため、描画のたびに計算せず固定する。
  const todayWeekday = useMemo(() => jstWeekday(0), [])
  const tomorrowWeekday = useMemo(() => jstWeekday(1), [])

  const todayKind = garbage[String(todayWeekday)] ?? null
  const tomorrowKind = garbage[String(tomorrowWeekday)] ?? null
  const hasSchedule = Object.keys(garbage).length > 0

  // 日曜(0)から土曜(6)まで、設定の有無にかかわらず7行そろえる。
  // 抜けがあると「登録し忘れ」なのか「収集が無い日」なのか分からなくなるため。
  const week = [0, 1, 2, 3, 4, 5, 6]

  return (
    <div className="garbage">
      <header className="garbage__header">
        <button type="button" className="garbage__back tap-feedback" onClick={onBack}>
          ← 戻る
        </button>
        <h1 className="garbage__title">ゴミの日</h1>
      </header>

      <div className="garbage__body">
        {status === 'loading' && <p className="garbage__message">読み込んでいます…</p>}

        {status === 'error' && (
          <div className="garbage__error">
            <p className="garbage__message garbage__message--error">
              ゴミの日を読み込めませんでした
            </p>
            <button type="button" className="garbage__retry tap-feedback" onClick={reload}>
              もう一度読み込む
            </button>
          </div>
        )}

        {status === 'ready' && !hasSchedule && (
          <EmptyGuide
            title="ゴミの日はまだ覚えていません"
            examples={['火曜日は燃えるゴミの日', '金曜日はプラスチックの日']}
            onAction={onGoVoice}
          />
        )}

        {status === 'ready' && hasSchedule && (
          <>
            <section className="garbage__today-cards">
              <div
                className={
                  todayKind
                    ? 'garbage__card garbage__card--today garbage__card--has'
                    : 'garbage__card garbage__card--today'
                }
              >
                <span className="garbage__card-label">今日（{weekdayKanji(todayWeekday)}曜日）</span>
                {todayKind ? (
                  <p className="garbage__card-text">
                    今日は <strong className="garbage__kind">{todayKind}</strong> の日です
                  </p>
                ) : (
                  <p className="garbage__card-text">今日はゴミの収集はありません</p>
                )}
              </div>

              <div
                className={
                  tomorrowKind
                    ? 'garbage__card garbage__card--tomorrow garbage__card--has'
                    : 'garbage__card garbage__card--tomorrow'
                }
              >
                <span className="garbage__card-label">
                  明日（{weekdayKanji(tomorrowWeekday)}曜日）
                </span>
                {tomorrowKind ? (
                  <p className="garbage__card-text">
                    明日は <strong className="garbage__kind">{tomorrowKind}</strong> の日です
                  </p>
                ) : (
                  <p className="garbage__card-text">明日はゴミの収集はありません</p>
                )}
              </div>
            </section>

            <section className="garbage__week">
              <h2 className="garbage__week-title">今週の予定</h2>
              <ul className="garbage__items">
                {week.map((weekday) => {
                  const kind = garbage[String(weekday)] ?? null
                  const isToday = weekday === todayWeekday
                  return (
                    <li
                      key={weekday}
                      className={isToday ? 'garbage__item garbage__item--today' : 'garbage__item'}
                    >
                      <span className="garbage__weekday">{weekdayKanji(weekday)}</span>
                      <span
                        className={
                          kind ? 'garbage__item-kind' : 'garbage__item-kind garbage__item-kind--none'
                        }
                      >
                        {kind ?? '—'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
