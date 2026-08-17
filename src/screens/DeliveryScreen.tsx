// 荷物の受け取り予定画面。
//
// まだ受け取っていない荷物だけを表示し、受け取ったら本人がその場で記録する。
// 今日届くぶんは行動が必要なので先頭にまとめ、それ以外と見分けられるようにしている。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyGuide } from '../components/EmptyGuide'
import { useAuth } from '../contexts/AuthContext'
import { getDeviceProfileId } from '../lib/deviceToken'
import {
  fetchDeliveries,
  formatRelativeDateLabel,
  formatTimeLabel,
  jstDateKey,
  jstTodayKey,
  receiveDelivery,
} from '../lib/data'
import type { DeliveryItem } from '../lib/data'
import './DeliveryScreen.css'

interface DeliveryScreenProps {
  /** 「戻る」を押したとき。 */
  onBack: () => void
  /** 空状態の「話しかける」を押したとき。 */
  onGoVoice: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'

/**
 * 到着予定を「今日 15:00」「明日」「8月20日（木）」のように1行で表す。
 * 日時が未登録のこともあるため、その場合は無理に日付を作らず未定と伝える。
 */
function formatArrivalLabel(expectedAt: string | null): string {
  if (!expectedAt) return '日時未定'
  const dateLabel = formatRelativeDateLabel(expectedAt)
  if (!dateLabel) return '日時未定'
  const timeLabel = formatTimeLabel(expectedAt)
  // 0:00は「時刻の指定なし」を意味するため、日付だけを見せる。
  return timeLabel === '時刻未定' ? dateLabel : `${dateLabel} ${timeLabel}`
}

/** 到着予定の早い順。日時未定のものは最後に回す。 */
function byExpectedAt(a: DeliveryItem, b: DeliveryItem): number {
  if (!a.expectedAt && !b.expectedAt) return 0
  if (!a.expectedAt) return 1
  if (!b.expectedAt) return -1
  return new Date(a.expectedAt).getTime() - new Date(b.expectedAt).getTime()
}

export function DeliveryScreen({ onBack, onGoVoice }: DeliveryScreenProps) {
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  // 記録処理中の荷物ID。二重送信を防ぎ、その間ボタンを押せない状態にする。
  const [receivingId, setReceivingId] = useState<string | null>(null)
  const [receiveError, setReceiveError] = useState<string | null>(null)

  // 家族アカウントでログイン中なら選択中のprofile、本人端末（デバイストークン）なら
  // 端末に保存されたprofileを見る。どちらも無い場合は取得しない。
  const { activeProfileId } = useAuth()
  const profileId = activeProfileId ?? getDeviceProfileId()

  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    if (!profileId) {
      setDeliveries([])
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    void fetchDeliveries(profileId)
      .then((rows) => {
        if (cancelled) return
        setDeliveries(rows)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[DeliveryScreen] 荷物を取得できませんでした:', error)
        setDeliveries([])
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [profileId, reloadKey])

  const todayKey = jstTodayKey(0)

  const todayItems = useMemo(
    () =>
      deliveries
        .filter((d) => d.expectedAt !== null && jstDateKey(d.expectedAt) === todayKey)
        .sort(byExpectedAt),
    [deliveries, todayKey],
  )

  const otherItems = useMemo(
    () =>
      deliveries
        .filter((d) => d.expectedAt === null || jstDateKey(d.expectedAt) !== todayKey)
        .sort(byExpectedAt),
    [deliveries, todayKey],
  )

  const handleReceive = useCallback(
    (deliveryId: string) => {
      if (receivingId) return
      setReceivingId(deliveryId)
      setReceiveError(null)

      void receiveDelivery(profileId, deliveryId)
        .then(() => {
          // 受け取り済みは表示する意味がないため、一覧から消す。
          setDeliveries((current) => current.filter((d) => d.id !== deliveryId))
        })
        .catch((error: unknown) => {
          console.error('[DeliveryScreen] 受け取りを記録できませんでした:', error)
          setReceiveError('記録できませんでした。もう一度お試しください')
        })
        .finally(() => setReceivingId(null))
    },
    [profileId, receivingId],
  )

  /** 1件ぶんのカード。今日ぶんもそれ以外も中身は同じで、囲みの色だけ変える。 */
  const renderItem = (delivery: DeliveryItem, today: boolean) => (
    <li
      key={delivery.id}
      className={'delivery__item' + (today ? ' delivery__item--today' : '')}
    >
      <div className="delivery__text">
        <span className="delivery__name">{delivery.itemName}</span>
        <span className="delivery__arrival">{formatArrivalLabel(delivery.expectedAt)}</span>
        {delivery.carrier && <span className="delivery__carrier">{delivery.carrier}</span>}
        {delivery.memo && <span className="delivery__memo">{delivery.memo}</span>}
      </div>
      <button
        type="button"
        className="delivery__receive tap-feedback"
        onClick={() => handleReceive(delivery.id)}
        disabled={receivingId !== null}
      >
        {receivingId === delivery.id ? '記録しています…' : '受け取りました'}
      </button>
    </li>
  )

  return (
    <div className="delivery">
      <header className="delivery__header">
        <button type="button" className="delivery__back tap-feedback" onClick={onBack}>
          ← 戻る
        </button>
        <h1 className="delivery__title">荷物</h1>
      </header>

      <div className="delivery__body">
        {status === 'loading' && <p className="delivery__message">読み込んでいます…</p>}

        {status === 'error' && (
          <div className="delivery__error">
            <p className="delivery__message delivery__message--error">
              荷物を読み込めませんでした
            </p>
            <button type="button" className="delivery__retry tap-feedback" onClick={reload}>
              もう一度読み込む
            </button>
          </div>
        )}

        {status === 'ready' && receiveError && <p className="delivery__notice">{receiveError}</p>}

        {status === 'ready' && deliveries.length === 0 && (
          <EmptyGuide
            title="受け取り予定の荷物はありません"
            examples={['明日、宅配便が届く', '金曜日にお米が届く']}
            onAction={onGoVoice}
          />
        )}

        {status === 'ready' && todayItems.length > 0 && (
          <section className="delivery__section">
            <h2 className="delivery__section-title delivery__section-title--today">今日届きます</h2>
            <ul className="delivery__items">{todayItems.map((d) => renderItem(d, true))}</ul>
          </section>
        )}

        {status === 'ready' && otherItems.length > 0 && (
          <section className="delivery__section">
            <h2 className="delivery__section-title">受け取り予定</h2>
            <ul className="delivery__items">{otherItems.map((d) => renderItem(d, false))}</ul>
          </section>
        )}
      </div>
    </div>
  )
}
