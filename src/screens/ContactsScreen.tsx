// 連絡先・電話画面。
//
// ご本人が話しかけて覚えさせた連絡先を一覧し、その場で電話をかけられるようにする。
// 「よく電話する相手（お気に入り）」を上のセクションに大きく出し、
// 探す手間なく最初の1タップで目的の相手に届くようにしている。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyGuide } from '../components/EmptyGuide'
import { useAuth } from '../contexts/AuthContext'
import { getDeviceProfileId } from '../lib/deviceToken'
import { fetchContacts } from '../lib/data'
import type { ContactItem } from '../lib/data'
import './ContactsScreen.css'

interface ContactsScreenProps {
  /** 「戻る」を押したとき。 */
  onBack: () => void
  /** 空状態の「話しかける」を押したとき。 */
  onGoVoice: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'

/** tel: リンクに載せる番号。ダイヤルできない文字（ハイフン・括弧・空白）を取り除く。 */
function toTelHref(phoneNumber: string): string {
  return `tel:${phoneNumber.replace(/[^0-9+]/g, '')}`
}

/**
 * 画面に出す電話番号の表記。
 * 数字が続くだけだと読み取りにくいため、桁の区切りが確実に分かる携帯電話番号
 * （0x0 + 4桁 + 4桁）のときだけハイフンを補う。
 * 固定電話は市外局番の桁数が地域によって変わり、機械的に区切ると誤った区切りに
 * なってしまうため、登録されたままの表記を尊重する。
 */
function formatPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/[^0-9]/g, '')
  if (/^0[789]0\d{8}$/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  }
  return phoneNumber
}

interface ContactRowProps {
  contact: ContactItem
}

/** 連絡先1件分の表示。お気に入りかどうかで文字やボタンの大きさをCSS側で変える。 */
function ContactRow({ contact }: ContactRowProps) {
  const phoneNumber = contact.phoneNumber?.trim() ?? ''

  return (
    <li className="contacts__item">
      <div className="contacts__text">
        <span className="contacts__name">
          {contact.name}
          {contact.relationship && (
            <span className="contacts__relationship">（{contact.relationship}）</span>
          )}
        </span>
        {phoneNumber ? (
          <span className="contacts__number">{formatPhoneNumber(phoneNumber)}</span>
        ) : (
          <span className="contacts__no-number">電話番号が登録されていません</span>
        )}
      </div>

      {/* tel: は button では発信できないため、a要素をボタンの見た目にしている。 */}
      {phoneNumber && (
        <a className="contacts__call" href={toTelHref(phoneNumber)}>
          電話をかける
        </a>
      )}
    </li>
  )
}

export function ContactsScreen({ onBack, onGoVoice }: ContactsScreenProps) {
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')

  // 家族アカウントでログイン中なら選択中のprofile、本人端末（デバイストークン）なら
  // 端末に保存されたprofileを見る。どちらも無い場合は取得しない。
  const { activeProfileId } = useAuth()
  const profileId = activeProfileId ?? getDeviceProfileId()

  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    if (!profileId) {
      setContacts([])
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    void fetchContacts(profileId)
      .then((rows) => {
        if (cancelled) return
        setContacts(rows)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[ContactsScreen] 連絡先を取得できませんでした:', error)
        setContacts([])
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [profileId, reloadKey])

  const favorites = useMemo(() => contacts.filter((contact) => contact.isFavorite), [contacts])
  const others = useMemo(() => contacts.filter((contact) => !contact.isFavorite), [contacts])

  return (
    <div className="contacts">
      <header className="contacts__header">
        <button type="button" className="contacts__back tap-feedback" onClick={onBack}>
          ← 戻る
        </button>
        <h1 className="contacts__title">連絡先</h1>
      </header>

      <div className="contacts__body">
        {status === 'loading' && <p className="contacts__message">読み込んでいます…</p>}

        {status === 'error' && (
          <div className="contacts__error">
            <p className="contacts__message contacts__message--error">
              連絡先を読み込めませんでした
            </p>
            <button type="button" className="contacts__retry tap-feedback" onClick={reload}>
              もう一度読み込む
            </button>
          </div>
        )}

        {status === 'ready' && contacts.length === 0 && (
          <EmptyGuide
            title="連絡先はまだ覚えていません"
            examples={['娘の電話番号は090-1234-5678', '田中さんの電話番号は03-1234-5678']}
            onAction={onGoVoice}
          />
        )}

        {/* お気に入りが無い場合はセクションごと出さない（空の見出しだけが残ると迷うため）。 */}
        {status === 'ready' && favorites.length > 0 && (
          <section className="contacts__group contacts__group--favorite">
            <h2 className="contacts__group-title">よく電話する相手</h2>
            <ul className="contacts__items">
              {favorites.map((contact) => (
                <ContactRow key={contact.id} contact={contact} />
              ))}
            </ul>
          </section>
        )}

        {status === 'ready' && others.length > 0 && (
          <section className="contacts__group">
            <h2 className="contacts__group-title">そのほかの連絡先</h2>
            <ul className="contacts__items">
              {others.map((contact) => (
                <ContactRow key={contact.id} contact={contact} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
