// お薬画面。
//
// 本人が「今日どのお薬をいつ飲むか」を確認し、飲んだことを自分で記録するための画面。
// 記録できるのは今日ぶんだけにしている。先の予定にもボタンを出すと、
// 押し間違いでまだ飲んでいないぶんが「済み」になってしまうためである。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyGuide } from '../components/EmptyGuide'
import { useAuth } from '../contexts/AuthContext'
import { getDeviceProfileId } from '../lib/deviceToken'
import {
  fetchMedications,
  formatDateLabel,
  formatTimeLabel,
  jstDateKey,
  jstTodayKey,
  takeMedication,
} from '../lib/data'
import type { MedicationItem } from '../lib/data'
import './MedicationScreen.css'

interface MedicationScreenProps {
  /** 「戻る」を押したとき。 */
  onBack: () => void
  /** 空状態の「話しかける」を押したとき。 */
  onGoVoice: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'

interface MedicationDateGroup {
  dateKey: string
  dateLabel: string
  items: MedicationItem[]
}

/** 服用予定の早い順。 */
function byScheduledAt(a: MedicationItem, b: MedicationItem): number {
  return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
}

/**
 * 服用を記録した時刻を「9時5分に飲みました」の形にする。
 * 時刻が取れない場合（記録直後に時刻が無い等）は、時刻を添えずに事実だけ伝える。
 */
function formatTakenLabel(takenAt: string | null): string {
  const time = formatTimeLabel(takenAt)
  if (time === '時刻未定') return '飲みました'
  const [hour, minute] = time.split(':')
  return `${hour}時${Number(minute)}分に飲みました`
}

/** 服用予定を日付ごとにまとめる（引数は時刻順に並んでいることが前提）。 */
function groupByDate(items: MedicationItem[]): MedicationDateGroup[] {
  const groups: MedicationDateGroup[] = []
  for (const item of items) {
    const dateKey = jstDateKey(item.scheduledAt)
    const last = groups[groups.length - 1]
    if (last && last.dateKey === dateKey) {
      last.items.push(item)
    } else {
      groups.push({ dateKey, dateLabel: formatDateLabel(item.scheduledAt), items: [item] })
    }
  }
  return groups
}

export function MedicationScreen({ onBack, onGoVoice }: MedicationScreenProps) {
  const [medications, setMedications] = useState<MedicationItem[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  // 記録処理中のお薬ID。二重送信を防ぎ、その間ボタンを押せない状態にする。
  const [takingId, setTakingId] = useState<string | null>(null)
  const [takeError, setTakeError] = useState<string | null>(null)

  // 家族アカウントでログイン中なら選択中のprofile、本人端末（デバイストークン）なら
  // 端末に保存されたprofileを見る。どちらも無い場合は取得しない。
  const { activeProfileId } = useAuth()
  const profileId = activeProfileId ?? getDeviceProfileId()

  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    if (!profileId) {
      setMedications([])
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    void fetchMedications(profileId)
      .then((rows) => {
        if (cancelled) return
        setMedications(rows)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[MedicationScreen] お薬を取得できませんでした:', error)
        setMedications([])
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [profileId, reloadKey])

  const todayKey = jstTodayKey(0)

  const todayItems = useMemo(
    () => medications.filter((m) => jstDateKey(m.scheduledAt) === todayKey).sort(byScheduledAt),
    [medications, todayKey],
  )

  // 明日以降のぶん。取得結果には過去12時間ぶん（＝昨日の分）も含まれうるが、
  // 今さら記録も確認もできないため、今日と明日以降のどちらにも出さない。
  const upcomingGroups = useMemo(
    () =>
      groupByDate(
        medications.filter((m) => jstDateKey(m.scheduledAt) > todayKey).sort(byScheduledAt),
      ),
    [medications, todayKey],
  )

  const handleTake = useCallback(
    (medicationId: string) => {
      if (takingId) return
      setTakingId(medicationId)
      setTakeError(null)

      void takeMedication(profileId, medicationId)
        .then(() => {
          // 一覧を取り直すと待ち時間が生じるため、その行だけ手元で「済み」に変える。
          const takenAt = new Date().toISOString()
          setMedications((current) =>
            current.map((m) => (m.id === medicationId ? { ...m, status: 'taken', takenAt } : m)),
          )
        })
        .catch((error: unknown) => {
          console.error('[MedicationScreen] 服用を記録できませんでした:', error)
          setTakeError('記録できませんでした。もう一度お試しください')
        })
        .finally(() => setTakingId(null))
    },
    [profileId, takingId],
  )

  // 予定時刻を過ぎたかどうかの判定に使う。描画のたびに評価すれば十分な精度。
  const now = Date.now()

  return (
    <div className="medication">
      <header className="medication__header">
        <button type="button" className="medication__back tap-feedback" onClick={onBack}>
          ← 戻る
        </button>
        <h1 className="medication__title">お薬</h1>
      </header>

      <div className="medication__body">
        {status === 'loading' && <p className="medication__message">読み込んでいます…</p>}

        {status === 'error' && (
          <div className="medication__error">
            <p className="medication__message medication__message--error">
              お薬を読み込めませんでした
            </p>
            <button type="button" className="medication__retry tap-feedback" onClick={reload}>
              もう一度読み込む
            </button>
          </div>
        )}

        {status === 'ready' && takeError && <p className="medication__notice">{takeError}</p>}

        {status === 'ready' && todayItems.length === 0 && upcomingGroups.length === 0 && (
          <EmptyGuide
            title="お薬はまだ覚えていません"
            examples={['血圧の薬を朝8時に飲む', '胃薬を夜9時に飲む']}
            onAction={onGoVoice}
          />
        )}

        {status === 'ready' && (todayItems.length > 0 || upcomingGroups.length > 0) && (
          <section className="medication__section">
            <h2 className="medication__section-title">今日のお薬</h2>
            {todayItems.length === 0 && (
              <p className="medication__section-empty">今日のお薬はありません</p>
            )}
            {todayItems.length > 0 && (
              <ul className="medication__items">
                {todayItems.map((m) => {
                  // 済みかどうかだけで見た目を分ける。'scheduled' 以外（'missed' など）でも、
                  // 実際に飲んだのなら記録できるようにボタンを出す。
                  const taken = m.status === 'taken'
                  const overdue = !taken && new Date(m.scheduledAt).getTime() < now
                  return (
                    <li
                      key={m.id}
                      className={
                        'medication__item' +
                        (taken ? ' medication__item--taken' : '') +
                        (overdue ? ' medication__item--overdue' : '')
                      }
                    >
                      <div className="medication__line">
                        <span className="medication__time">{formatTimeLabel(m.scheduledAt)}</span>
                        <div className="medication__text">
                          <span className="medication__name">{m.medicationName}</span>
                          {m.dosage && <span className="medication__dosage">{m.dosage}</span>}
                        </div>
                      </div>

                      {taken ? (
                        <p className="medication__taken">✓ {formatTakenLabel(m.takenAt)}</p>
                      ) : (
                        <>
                          {overdue && <p className="medication__overdue">まだ飲んでいません</p>}
                          <button
                            type="button"
                            className="medication__take tap-feedback"
                            onClick={() => handleTake(m.id)}
                            disabled={takingId !== null}
                          >
                            {takingId === m.id ? '記録しています…' : '飲みました'}
                          </button>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {status === 'ready' && upcomingGroups.length > 0 && (
          <section className="medication__section">
            <h2 className="medication__section-title">これからの予定</h2>
            {upcomingGroups.map((group) => (
              <div key={group.dateKey} className="medication__group">
                <h3 className="medication__date">{group.dateLabel}</h3>
                <ul className="medication__plans">
                  {group.items.map((m) => (
                    <li key={m.id} className="medication__plan">
                      <span className="medication__time">{formatTimeLabel(m.scheduledAt)}</span>
                      <div className="medication__text">
                        <span className="medication__name">{m.medicationName}</span>
                        {m.dosage && <span className="medication__dosage">{m.dosage}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
