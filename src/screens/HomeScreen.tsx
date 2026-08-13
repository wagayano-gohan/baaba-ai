// ホーム画面（MVP）。
//
// ご本人が毎日いちばん最初に見る画面。上から順に
//   1. あいさつと日付
//   2. お知らせ（今すぐ必要な用件だけを出すリマインダー）
//   3. 大きな音声ボタン
//   4. 今日の予定
//   5. AIに相談
//   6. その他の機能（お薬・荷物・ゴミの日・天気・地図・電話・写真・メモ など）
// の順に並べる。上にあるものほど「その時に必要な情報」で、下へ行くほど「自分から見に行くもの」。
//
// 通知（リマインダー）は、iPhoneのSafariでは追加の許可や配信基盤が必要で確実に届かないため、
// MVPでは「アプリを開いたときに必ず目に入るお知らせ」として実装する。
// 1分ごとに時刻とデータを見直し、時間が来たら自動でお知らせに現れる。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MicIcon } from '../components/icons'
import { useAuth } from '../contexts/AuthContext'
import { getDeviceProfileId } from '../lib/deviceToken'
import {
  fetchHome,
  formatTimeLabel,
  jstDateKey,
  jstTodayKey,
  takeMedication,
} from '../lib/data'
import type { HomeData, MedicationItem } from '../lib/data'
import './HomeScreen.css'

/** ホームから移動できる画面。App側の画面名と対応させる。 */
export type HomeTarget =
  | 'medication'
  | 'delivery'
  | 'garbage'
  | 'weather'
  | 'places'
  | 'contacts'
  | 'notes'
  | 'eventList'
  | 'taskList'
  | 'shoppingList'

interface HomeScreenProps {
  /** 大きな音声ボタン（話しかける）を押したとき。 */
  onGoVoice: () => void
  /** 「AIに相談」を押したとき。 */
  onGoChat: () => void
  /** 画面下部の小さな「設定」を押したとき（管理者向けメニューへ）。 */
  onGoSettings: () => void
  /** 機能ボタンを押したとき。 */
  onNavigate: (target: HomeTarget) => void
}

/** 曜日を漢字1文字で表す（日曜=0 〜 土曜=6）。 */
const WEEKDAY_KANJI = ['日', '月', '火', '水', '木', '金', '土']

/** en-USの短縮曜日名から曜日番号（日曜=0）への対応。 */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

interface JstNow {
  month: number
  day: number
  hour: number
  weekday: number
}

// 端末のタイムゾーン設定に左右されず、常に日本時間で「日付」「時刻」を求める。
function getJstNow(base: Date): JstNow {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(base)

  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? ''

  // hourCycle次第で 24 時が返ることがあるため 0 に丸める。
  const hour = Number(pick('hour')) % 24

  return {
    month: Number(pick('month')),
    day: Number(pick('day')),
    hour: Number.isNaN(hour) ? 0 : hour,
    weekday: WEEKDAY_INDEX[pick('weekday')] ?? 0,
  }
}

function greetingOf(hour: number): string {
  if (hour < 10) return 'おはようございます'
  if (hour < 17) return 'こんにちは'
  return 'こんばんは'
}

type ScheduleStatus = 'loading' | 'ready' | 'error'

/** お知らせに出す1件。 */
interface Notice {
  key: string
  /** 見出し（大きく出る文言）。 */
  text: string
  /** 補足（時刻や配送業者など）。 */
  detail?: string
  /** 強い注意を促すもの（飲み忘れなど）。 */
  urgent?: boolean
  /** 「飲みました」ボタンを出す対象の服薬記録。 */
  medication?: MedicationItem
}

/** お薬の時間が来た・過ぎたと判断する余裕（ミリ秒）。 */
const MEDICATION_LEAD_MS = 30 * 60_000
/** 「まもなく」と案内する予定の範囲（ミリ秒）。 */
const EVENT_SOON_MS = 3 * 60 * 60_000

/** 今この瞬間に伝えるべき用件だけを組み立てる。 */
function buildNotices(data: HomeData, nowMs: number, hour: number): Notice[] {
  const notices: Notice[] = []

  // 1. お薬。予定時刻の30分前から出し、過ぎても飲んでいなければ強調して出し続ける。
  for (const med of data.medications) {
    if (med.status !== 'scheduled') continue
    const scheduledMs = new Date(med.scheduledAt).getTime()
    if (Number.isNaN(scheduledMs)) continue
    if (scheduledMs - nowMs > MEDICATION_LEAD_MS) continue

    const overdue = scheduledMs < nowMs - MEDICATION_LEAD_MS
    notices.push({
      key: 'med-' + med.id,
      text: overdue ? 'お薬をまだ飲んでいません' : 'お薬の時間です',
      detail: [formatTimeLabel(med.scheduledAt), med.medicationName, med.dosage ?? '']
        .filter((part) => part !== '')
        .join('　'),
      urgent: overdue,
      medication: med,
    })
  }

  // 2. まもなく始まる予定。
  for (const event of data.events) {
    const startsMs = new Date(event.startsAt).getTime()
    if (Number.isNaN(startsMs)) continue
    if (startsMs < nowMs || startsMs - nowMs > EVENT_SOON_MS) continue
    notices.push({
      key: 'event-' + event.id,
      text: 'まもなく ' + event.title,
      detail: [formatTimeLabel(event.startsAt), event.locationText ?? '']
        .filter((part) => part !== '')
        .join('　'),
    })
  }

  // 3. 今日届く荷物。
  const todayKey = jstTodayKey(0)
  for (const delivery of data.deliveries) {
    if (!delivery.expectedAt) continue
    if (jstDateKey(delivery.expectedAt) !== todayKey) continue
    notices.push({
      key: 'delivery-' + delivery.id,
      text: '今日 ' + delivery.itemName + ' が届きます',
      detail: [delivery.carrier ?? '', formatTimeLabel(delivery.expectedAt)]
        .filter((part) => part !== '' && part !== '時刻未定')
        .join('　'),
    })
  }

  // 4. ゴミの日。当日は朝のうちに、翌日ぶんは夕方以降に案内する
  //    （前の晩に出しておく家庭が多いため）。
  if (data.garbage.today && hour < 12) {
    notices.push({ key: 'garbage-today', text: '今日は ' + data.garbage.today + ' の日です' })
  }
  if (data.garbage.tomorrow && hour >= 17) {
    notices.push({ key: 'garbage-tomorrow', text: '明日は ' + data.garbage.tomorrow + ' の日です' })
  }

  return notices
}

/** ホームに並べる機能ボタン。 */
const FEATURES: { target: HomeTarget; label: string; tint: string }[] = [
  { target: 'medication', label: 'お薬', tint: 'pink' },
  { target: 'delivery', label: '荷物', tint: 'orange' },
  { target: 'garbage', label: 'ゴミの日', tint: 'green' },
  { target: 'weather', label: '天気', tint: 'blue' },
  { target: 'places', label: '地図・行き方', tint: 'blue' },
  { target: 'contacts', label: '電話', tint: 'green' },
  { target: 'notes', label: '写真・メモ', tint: 'yellow' },
  { target: 'eventList', label: '予定', tint: 'pink' },
  { target: 'taskList', label: 'やること', tint: 'yellow' },
  { target: 'shoppingList', label: '買い物メモ', tint: 'orange' },
]

export function HomeScreen({ onGoVoice, onGoChat, onGoSettings, onNavigate }: HomeScreenProps) {
  const [now, setNow] = useState<JstNow>(() => getJstNow(new Date()))
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const [data, setData] = useState<HomeData | null>(null)
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleStatus>('loading')
  const [takingId, setTakingId] = useState<string | null>(null)

  // 家族アカウントでログイン中なら選択中のprofile、本人端末（デバイストークン）なら
  // 端末に保存されたprofileを見る。どちらも無い場合は取得しない。
  const { activeProfileId } = useAuth()
  const profileId = activeProfileId ?? getDeviceProfileId()

  // 日付またぎや、あいさつが切り替わる時刻（10時・17時）をまたいでも
  // 画面を開き直さずに表示が正しくなるよう、1分ごとに更新する。
  // お薬の時間もこの更新でお知らせに現れる。
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(getJstNow(new Date()))
      setNowMs(Date.now())
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // 今日ぶんのデータを読み込む。日付をまたいだときは対象日が変わるため読み直す。
  const todayKey = `${now.month}/${now.day}`
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!profileId) {
      setData(null)
      setScheduleStatus('ready')
      return
    }

    let cancelled = false
    setScheduleStatus('loading')

    void fetchHome(profileId)
      .then((rows) => {
        if (cancelled) return
        setData(rows)
        setScheduleStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[HomeScreen] 今日の情報を取得できませんでした:', error)
        setData(null)
        setScheduleStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [profileId, todayKey, reloadKey])

  const notices = useMemo(
    () => (data ? buildNotices(data, nowMs, now.hour) : []),
    [data, nowMs, now.hour],
  )

  const handleTake = useCallback(
    (medicationLogId: string) => {
      if (takingId) return
      setTakingId(medicationLogId)

      void takeMedication(profileId, medicationLogId)
        .then(() => {
          // 一覧を読み直さず、その場で「飲んだ」状態に変えてお知らせから消す。
          setData((current) =>
            current
              ? {
                  ...current,
                  medications: current.medications.map((med) =>
                    med.id === medicationLogId
                      ? { ...med, status: 'taken', takenAt: new Date().toISOString() }
                      : med,
                  ),
                }
              : current,
          )
        })
        .catch((error: unknown) => {
          console.error('[HomeScreen] 服薬を記録できませんでした:', error)
          setScheduleStatus('error')
        })
        .finally(() => setTakingId(null))
    },
    [profileId, takingId],
  )

  const events = data?.events ?? []
  const dateText = `${now.month}月${now.day}日（${WEEKDAY_KANJI[now.weekday]}）`

  return (
    <div className="home">
      <header className="home__header">
        <p className="home__greeting">{greetingOf(now.hour)}</p>
        <p className="home__date">{dateText}</p>
      </header>

      {notices.length > 0 && (
        <section className="home__notices" aria-label="お知らせ">
          {notices.map((notice) => (
            <div
              key={notice.key}
              className={
                'home__notice' + (notice.urgent ? ' home__notice--urgent' : '')
              }
            >
              <div className="home__notice-text">
                <span className="home__notice-title">{notice.text}</span>
                {notice.detail && <span className="home__notice-detail">{notice.detail}</span>}
              </div>
              {notice.medication && (
                <button
                  type="button"
                  className="home__notice-action tap-feedback"
                  onClick={() => handleTake(notice.medication!.id)}
                  disabled={takingId !== null}
                >
                  {takingId === notice.medication.id ? '記録しています…' : '飲みました'}
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      <button
        type="button"
        className="home__voice tap-feedback"
        onClick={onGoVoice}
        aria-label="音声で話しかける"
      >
        <span className="home__voice-icon" aria-hidden="true">
          <MicIcon size={64} />
        </span>
        <span className="home__voice-label">話しかける</span>
      </button>

      <section className="home__schedule">
        <h2 className="home__schedule-title">今日の予定</h2>
        {scheduleStatus === 'loading' ? (
          <p className="home__schedule-empty">読み込んでいます…</p>
        ) : scheduleStatus === 'error' ? (
          <div>
            <p className="home__schedule-empty home__schedule-empty--error">
              予定を読み込めませんでした
            </p>
            <button
              type="button"
              className="home__schedule-retry tap-feedback"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              もう一度読み込む
            </button>
          </div>
        ) : events.length === 0 ? (
          <p className="home__schedule-empty">本日の予定はありません</p>
        ) : (
          <ul className="home__schedule-list">
            {events.map((event) => (
              <li key={event.id} className="home__schedule-item">
                <span className="home__schedule-time">{formatTimeLabel(event.startsAt)}</span>
                <span className="home__schedule-name">{event.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" className="home__chat tap-feedback" onClick={onGoChat}>
        AIに相談
      </button>

      <nav className="home__features" aria-label="その他の機能">
        {FEATURES.map((feature) => (
          <button
            key={feature.target}
            type="button"
            className={`home__feature home__feature--${feature.tint} tap-feedback`}
            onClick={() => onNavigate(feature.target)}
          >
            {feature.label}
          </button>
        ))}
      </nav>

      <div className="home__footer">
        <button type="button" className="home__settings" onClick={onGoSettings}>
          設定
        </button>
      </div>
    </div>
  )
}
