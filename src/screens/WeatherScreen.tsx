// 天気・服装アドバイス画面。
//
// 出かける前に「何を着ればよいか」「傘が要るか」を判断できることが目的のため、
// 数値よりも天気の要約と服装アドバイスを大きく見せる。
// 位置情報は端末のGPSではなく、ご家族が登録した自宅（home）の緯度経度を使う。

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getDeviceProfileId } from '../lib/deviceToken'
import { fetchSettings, fetchTodayWeather } from '../lib/data'
import type { HomeLocation, WeatherToday } from '../lib/data'
import './WeatherScreen.css'

interface WeatherScreenProps {
  /** 「戻る」を押したとき。 */
  onBack: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'

/** WMOコードを、絵柄の出し分け用の少数のグループにまとめる。 */
type WeatherKind = 'sun' | 'partly' | 'cloud' | 'rain' | 'snow' | 'thunder'

function weatherKind(code: number): WeatherKind {
  if (code === 0 || code === 1) return 'sun'
  if (code === 2) return 'partly'
  if (code >= 95) return 'thunder'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  return 'cloud'
}

/**
 * 天気の絵柄。外部画像を読み込まずに済むよう、インラインSVGで描く。
 * 細部を描き込むと小さく見えるため、太い線と大きな面だけで構成している。
 */
function WeatherIcon({ code }: { code: number }) {
  const kind = weatherKind(code)
  const sun = (
    <g>
      <circle cx="34" cy="34" r="14" fill="#f4a93c" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <line
          key={angle}
          x1="34"
          y1="12"
          x2="34"
          y2="4"
          stroke="#f4a93c"
          strokeWidth="5"
          strokeLinecap="round"
          transform={`rotate(${angle} 34 34)`}
        />
      ))}
    </g>
  )
  const cloud = (
    <path
      d="M26 66c-7 0-13-6-13-13s6-13 13-13c2-9 10-16 20-16 11 0 20 8 21 19 7 1 12 7 12 14 0 5-4 9-9 9H26z"
      fill="#b9c4d2"
    />
  )
  const drops = (
    <g stroke="#4f8ed6" strokeWidth="5" strokeLinecap="round">
      <line x1="30" y1="74" x2="26" y2="86" />
      <line x1="48" y1="74" x2="44" y2="86" />
      <line x1="66" y1="74" x2="62" y2="86" />
    </g>
  )
  const flakes = (
    <g fill="#8fb8e0">
      <circle cx="30" cy="80" r="5" />
      <circle cx="48" cy="80" r="5" />
      <circle cx="66" cy="80" r="5" />
    </g>
  )
  const bolt = <path d="M50 70l-14 18h11l-5 16 18-22H49l6-12z" fill="#f4a93c" />

  return (
    <svg
      className="weather__icon"
      viewBox="0 0 100 100"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      {kind === 'sun' && sun}
      {kind === 'partly' && (
        <g>
          <g transform="translate(24 -6) scale(0.8)">{sun}</g>
          {cloud}
        </g>
      )}
      {kind === 'cloud' && cloud}
      {kind === 'rain' && (
        <g>
          {cloud}
          {drops}
        </g>
      )}
      {kind === 'snow' && (
        <g>
          {cloud}
          {flakes}
        </g>
      )}
      {kind === 'thunder' && (
        <g>
          {cloud}
          {bolt}
        </g>
      )}
    </svg>
  )
}

export function WeatherScreen({ onBack }: WeatherScreenProps) {
  const [home, setHome] = useState<HomeLocation | null>(null)
  const [weather, setWeather] = useState<WeatherToday | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')

  // 家族アカウントでログイン中なら選択中のprofile、本人端末（デバイストークン）なら
  // 端末に保存されたprofileを見る。どちらも無い場合は取得しない。
  const { activeProfileId } = useAuth()
  const profileId = activeProfileId ?? getDeviceProfileId()

  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    if (!profileId) {
      setHome(null)
      setWeather(null)
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    void fetchSettings(profileId)
      .then(async (data) => {
        if (cancelled) return
        setHome(data.home)

        const { latitude, longitude } = data.home ?? { latitude: null, longitude: null }
        // 住所が未登録なのは異常ではなく「これから登録するもの」なので、
        // エラーにせず、案内文を出せる状態（ready かつ weather=null）で終える。
        if (latitude === null || longitude === null) {
          setWeather(null)
          setStatus('ready')
          return
        }

        const today = await fetchTodayWeather(latitude, longitude)
        if (cancelled) return
        setWeather(today)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[WeatherScreen] 天気を取得できませんでした:', error)
        setWeather(null)
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [profileId, reloadKey])

  // 緯度経度がそろっている自宅だけを「地域が登録済み」とみなす。
  // constに置き換えることで、以下のJSXでnullでないことが型としても確定する。
  const location = home && home.latitude !== null && home.longitude !== null ? home : null

  return (
    <div className="weather">
      <header className="weather__header">
        <button type="button" className="weather__back tap-feedback" onClick={onBack}>
          ← 戻る
        </button>
        <h1 className="weather__title">天気</h1>
      </header>

      <div className="weather__body">
        {status === 'loading' && <p className="weather__message">読み込んでいます…</p>}

        {status === 'error' && (
          <div className="weather__error">
            <p className="weather__message weather__message--error">天気を取得できませんでした</p>
            <button type="button" className="weather__retry tap-feedback" onClick={reload}>
              もう一度読み込む
            </button>
          </div>
        )}

        {status === 'ready' && !location && (
          <div className="weather__empty">
            <p className="weather__empty-title">お住まいの地域が登録されていません</p>
            <p className="weather__empty-note">ご家族に登録してもらってください</p>
          </div>
        )}

        {status === 'ready' && location && weather && (
          <>
            <section className="weather__summary">
              <p className="weather__place">{location.name}</p>
              <WeatherIcon code={weather.code} />
              <p className="weather__condition">{weather.summary}</p>

              <dl className="weather__figures">
                <div className="weather__figure">
                  <dt className="weather__figure-label">最高／最低</dt>
                  <dd className="weather__figure-value">
                    {weather.maxTemp === null ? '—' : `${weather.maxTemp}℃`} /{' '}
                    {weather.minTemp === null ? '—' : `${weather.minTemp}℃`}
                  </dd>
                </div>
                {/* 降水確率は取得できないことがあるため、その場合は行ごと出さない。 */}
                {weather.rainChance !== null && (
                  <div className="weather__figure">
                    <dt className="weather__figure-label">降水確率</dt>
                    <dd className="weather__figure-value">{weather.rainChance}%</dd>
                  </div>
                )}
              </dl>
            </section>

            <section className="weather__advice">
              <h2 className="weather__advice-title">今日の服装</h2>
              <p className="weather__advice-text">{weather.advice}</p>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
