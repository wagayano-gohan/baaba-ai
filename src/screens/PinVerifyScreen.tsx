// 管理者PINの照合画面（PIN確認セッションの発行）。
//
// verify-admin-pin に成功すると、サーバー側で一定時間（10分）有効な「PIN確認セッション」が発行され、
// その間だけ register-device などの管理者操作が実行できる。
// PIN確認セッションはサーバーが管理するため、この画面ではPINも有効期限も端末に保存しない。

import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiCallError, callUserAuthedFunction } from '../lib/apiClient'
import './PinVerifyScreen.css'

interface PinVerifyScreenProps {
  /** 照合対象のprofileId（家族）。 */
  profileId: string
  /** 照合に成功したときに呼ばれる（この時点でPIN確認セッションが有効になっている）。 */
  onVerified: () => void
  /** 「PINを忘れた場合」を押したときに呼ばれる。 */
  onForgot: () => void
  /** 戻る導線。 */
  onBack: () => void
  /** PIN未設定（PIN_NOT_SET）だった場合の初回設定導線。渡された場合のみ表示する。 */
  onGoSetup?: () => void
}

interface VerifyAdminPinResponse {
  verified: boolean
  expiresAt: string
}

const PIN_PATTERN = /^\d{4}$/

// サーバー側のロック条件。画面では「あと何回間違えられるか」の目安表示にのみ使う
// （実際の試行回数はサーバーが保持しており、この画面のカウントは同一画面内での目安）。
const MAX_ATTEMPTS = 5

function toPinValue(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, 4)
}

export function PinVerifyScreen({
  profileId,
  onVerified,
  onForgot,
  onBack,
  onGoSetup,
}: PinVerifyScreenProps) {
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // この画面で数えた失敗回数（サーバーの正確な残数は取得できないため、あくまで目安）。
  const [failedCount, setFailedCount] = useState(0)
  // 423 PIN_LOCKED。以降は再入力させない。
  const [locked, setLocked] = useState(false)
  // PIN未設定。初回設定へ誘導する。
  const [notSet, setNotSet] = useState(false)

  const disabled = submitting || locked || notSet

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled) return

    setErrorMessage(null)

    if (!PIN_PATTERN.test(pin)) {
      setErrorMessage('PINは数字4桁で入力してください')
      return
    }
    if (!profileId) {
      setErrorMessage('対象のご家族が選択されていません')
      return
    }

    setSubmitting(true)
    try {
      const result = await callUserAuthedFunction<VerifyAdminPinResponse>('verify-admin-pin', {
        profileId,
        pin,
      })
      setPin('')
      if (result.verified) {
        onVerified()
        return
      }
      setErrorMessage('PINを確認できませんでした。もう一度お試しください')
    } catch (error) {
      setPin('')
      if (error instanceof ApiCallError) {
        if (error.code === 'PIN_LOCKED' || error.status === 423) {
          setLocked(true)
          setErrorMessage('PINを5回連続で間違えたため、15分間ロックされています')
        } else if (error.code === 'PIN_INVALID') {
          const nextCount = failedCount + 1
          setFailedCount(nextCount)
          const remaining = Math.max(0, MAX_ATTEMPTS - nextCount)
          setErrorMessage(
            `PINが正しくありません（あと${remaining}回間違えると15分間ロックされます／回数は目安です）`,
          )
        } else if (error.code === 'PIN_NOT_SET') {
          setNotSet(true)
          setErrorMessage('管理者PINが未設定です')
        } else if (error.code === 'AUTH_SESSION_ID_MISSING' || error.code === 'UNAUTHENTICATED') {
          setErrorMessage('ログインし直してから、もう一度お試しください')
        } else if (error.code === 'PROFILE_ACCESS_DENIED') {
          setErrorMessage('この操作を行う権限がありません（管理者のアカウントが必要です）')
        } else {
          setErrorMessage(error.message)
        }
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pin-screen">
      <header className="pin-screen__header">
        <button type="button" className="pin-screen__back tap-feedback" onClick={onBack}>
          戻る
        </button>
        <h1 className="pin-screen__heading">管理者PINの確認</h1>
        <p className="pin-screen__lead">
          重要な操作を行う前に、管理者PIN（数字4桁）を入力してください。
        </p>
      </header>

      <section className="pin-screen__section">
        {locked ? (
          <>
            <p className="pin-screen__error" role="alert">
              PINを5回連続で間違えたため、15分間ロックされています
            </p>
            <p className="pin-screen__note">
              しばらく時間をおいてからお試しください。PINが分からない場合は、
              ログインパスワードで再設定できます。
            </p>
            <button
              type="button"
              className="pin-screen__button pin-screen__button--secondary tap-feedback"
              onClick={onForgot}
            >
              PINを忘れた場合
            </button>
          </>
        ) : notSet ? (
          <>
            <p className="pin-screen__error" role="alert">
              管理者PINが未設定です
            </p>
            <p className="pin-screen__note">先に管理者PINを設定してください。</p>
            {onGoSetup && (
              <button
                type="button"
                className="pin-screen__button pin-screen__button--primary tap-feedback"
                onClick={onGoSetup}
              >
                管理者PINを設定する
              </button>
            )}
          </>
        ) : (
          <>
            <form className="pin-screen__form" onSubmit={handleSubmit} noValidate>
              <label className="pin-screen__field">
                <span className="pin-screen__label">管理者PIN（数字4桁）</span>
                <input
                  className="pin-screen__input"
                  type="password"
                  name="admin-pin"
                  value={pin}
                  onChange={(e) => setPin(toPinValue(e.target.value))}
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={submitting}
                />
              </label>

              <p className="pin-screen__note">5回連続で間違えると、15分間ロックされます。</p>

              {errorMessage && (
                <p className="pin-screen__error" role="alert">
                  {errorMessage}
                </p>
              )}

              <button
                type="submit"
                className="pin-screen__button pin-screen__button--primary tap-feedback"
                disabled={submitting}
              >
                {submitting ? '確認しています…' : '確認する'}
              </button>
            </form>

            <button type="button" className="pin-screen__textlink tap-feedback" onClick={onForgot}>
              PINを忘れた場合
            </button>
          </>
        )}
      </section>
    </div>
  )
}
