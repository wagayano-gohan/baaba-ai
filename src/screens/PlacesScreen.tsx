// 地図・経路案内画面。
//
// ご本人が話しかけて覚えさせた「よく行く場所」を一覧し、地図表示と経路案内をワンタップで開く。
// 経路の計算やルート表示はアプリ内では行わず、端末の地図アプリ（Googleマップ）に任せる。
// 高齢のご本人が普段から使い慣れた地図アプリで見られるほうが迷いにくいためである。

import { useCallback, useEffect, useState } from 'react'
import { EmptyGuide } from '../components/EmptyGuide'
import { useAuth } from '../contexts/AuthContext'
import { getDeviceProfileId } from '../lib/deviceToken'
import { buildDirectionsUrl, buildMapUrl, fetchLocations } from '../lib/data'
import type { LocationItem } from '../lib/data'
import './PlacesScreen.css'

interface PlacesScreenProps {
  /** 「戻る」を押したとき。 */
  onBack: () => void
  /** 空状態の「話しかける」を押したとき。 */
  onGoVoice: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'

/** 保存されているカテゴリ値と、画面に出す日本語ラベルの対応。 */
const CATEGORY_LABELS: Record<string, string> = {
  home: '自宅',
  hospital: '病院',
  store: 'お店',
  family: '家族の家',
  other: 'その他',
}

/** 未知のカテゴリが入っていても画面が壊れないよう「その他」に寄せる。 */
function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? CATEGORY_LABELS.other
}

export function PlacesScreen({ onBack, onGoVoice }: PlacesScreenProps) {
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')

  // 家族アカウントでログイン中なら選択中のprofile、本人端末（デバイストークン）なら
  // 端末に保存されたprofileを見る。どちらも無い場合は取得しない。
  const { activeProfileId } = useAuth()
  const profileId = activeProfileId ?? getDeviceProfileId()

  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    if (!profileId) {
      setLocations([])
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    void fetchLocations(profileId)
      .then((rows) => {
        if (cancelled) return
        setLocations(rows)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[PlacesScreen] 場所を取得できませんでした:', error)
        setLocations([])
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [profileId, reloadKey])

  // 地図アプリは別タブで開く。アプリ側の状態（開いていた画面）を失わせないため。
  const openExternal = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  return (
    <div className="places">
      <header className="places__header">
        <button type="button" className="places__back tap-feedback" onClick={onBack}>
          ← 戻る
        </button>
        <h1 className="places__title">場所・行き方</h1>
      </header>

      <div className="places__body">
        {status === 'loading' && <p className="places__message">読み込んでいます…</p>}

        {status === 'error' && (
          <div className="places__error">
            <p className="places__message places__message--error">場所を読み込めませんでした</p>
            <button type="button" className="places__retry tap-feedback" onClick={reload}>
              もう一度読み込む
            </button>
          </div>
        )}

        {status === 'ready' && locations.length === 0 && (
          <EmptyGuide
            title="よく行く場所はまだ覚えていません"
            examples={['いつもの美容院は青葉美容室', 'かかりつけは立川病院']}
            onAction={onGoVoice}
          />
        )}

        {status === 'ready' && locations.length > 0 && (
          <ul className="places__items">
            {locations.map((location) => (
              <li key={location.id} className="places__item">
                <div className="places__text">
                  <span className="places__name">{location.name}</span>
                  <span className="places__category">{categoryLabel(location.category)}</span>
                  {location.address && <span className="places__address">{location.address}</span>}
                </div>
                <div className="places__actions">
                  <button
                    type="button"
                    className="places__action tap-feedback"
                    onClick={() => openExternal(buildMapUrl(location))}
                  >
                    地図で見る
                  </button>
                  <button
                    type="button"
                    className="places__action places__action--primary tap-feedback"
                    onClick={() => openExternal(buildDirectionsUrl(location))}
                  >
                    行き方を調べる
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
