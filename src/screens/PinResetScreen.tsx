// 管理者PINを忘れた場合の再設定画面。
//
// いまのPINが分からなくても、ログインパスワードを再入力できれば新しいPINに置き換えられる。
// 呼び出すEdge Function: manage-admin-pin（operation: 'reset'）
//
// セキュリティ上の約束:
//   - 入力されたログインパスワードは、このコンポーネントのstateにのみ保持する。
//   - localStorage / sessionStorage / cookie / ログ（console）へは一切書き出さない。
//   - 送信後は成功・失敗にかかわらず必ずstateからクリアする。

import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiCallError, callUserAuthedFunction } from '../lib/apiClient'
import './PinResetScreen.css'

interface PinResetScreenProps {
  /** 再設定対象のprofileId（家族）。 */
  profileId: string
  /** 再設定が完了して「終わる」を押したときに呼ばれる。 */
  onDone: () => void
  /** 戻る導線。 */
  onBack: () => void
}

const PIN_PATTERN = /^\d{4}$/

function toPinValue(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, 4)
}

function toJapaneseMessage(error: unknown): string {
  if (error instanceof ApiCallError) {
    if (error.code === 'PIN_INVALID') {
      return 'パスワード、またはPINの形式が正しくありません'
    }
    if (error.code === 'UNAUTHENTICATED') {
      return 'パスワードが正しくありません。もう一度ご確認ください'
    }
    if (error.code === 'PROFILE_ACCESS_DENIED') {
      return 'この操作を行う権限がありません（管理者のアカウントが必要です）'
    }
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

export function PinResetScreen({ profileId, onDone, onBack }: PinResetScreenProps) {
  // パスワードはこのstate以外のどこにも保持しない。
  const [password, setPassword] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [succeeded, setSucceeded] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting || succeeded) return

    setErrorMessage(null)

    if (!password) {
      setErrorMessage('ログインのパスワードを入力してください')
      return
    }
    if (!PIN_PATTERN.test(newPin)) {
      setErrorMessage('あたらしいPINは数字4桁で入力してください')
      return
    }
    if (newPin !== confirmPin) {
      setErrorMessage('2つのPINが一致しません。同じ数字を入力してください')
      return
    }
    if (!profileId) {
      setErrorMessage('対象の家族が選ばれていません')
      return
    }

    setSubmitting(true)
    try {
      await callUserAuthedFunction('manage-admin-pin', {
        operation: 'reset',
        profileId,
        account_password: password,
        new_pin: newPin,
        confirm_pin: confirmPin,
      })
      setNewPin('')
      setConfirmPin('')
      setSucceeded(true)
    } catch (error) {
      // エラー内容にパスワードが含まれることはないが、原文をそのままログへ出さない方針とし、
      // 画面表示用の日本語文言のみを扱う。
      setErrorMessage(toJapaneseMessage(error))
    } finally {
      // 成功・失敗にかかわらず、送信が終わった時点でパスワードをstateから消す。
      setPassword('')
      setSubmitting(false)
    }
  }

  return (
    <div className="pin-screen">
      <header className="pin-screen__header">
        <button type="button" className="pin-screen__back tap-feedback" onClick={onBack}>
          戻る
        </button>
        <h1 className="pin-screen__heading">管理者PINの再設定</h1>
        <p className="pin-screen__lead">
          いまのPINが分からない場合は、ログインのパスワードを入力すると
          あたらしいPINに変えられます。
        </p>
      </header>

      {succeeded ? (
        <section className="pin-screen__section pin-screen__section--done">
          <p className="pin-screen__success" role="status">
            あたらしい管理者PINを設定しました
          </p>
          <button
            type="button"
            className="pin-screen__button pin-screen__button--primary tap-feedback"
            onClick={onDone}
          >
            終わる
          </button>
        </section>
      ) : (
        <section className="pin-screen__section">
          <form className="pin-screen__form" onSubmit={handleSubmit} noValidate>
            <label className="pin-screen__field">
              <span className="pin-screen__label">ログインのパスワード</span>
              <input
                className="pin-screen__input pin-screen__input--password"
                type="password"
                name="account-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoCapitalize="none"
                spellCheck={false}
                disabled={submitting}
              />
            </label>

            <label className="pin-screen__field">
              <span className="pin-screen__label">あたらしいPIN（数字4桁）</span>
              <input
                className="pin-screen__input"
                type="password"
                name="new-pin"
                value={newPin}
                onChange={(e) => setNewPin(toPinValue(e.target.value))}
                inputMode="numeric"
                maxLength={4}
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
                disabled={submitting}
              />
            </label>

            <label className="pin-screen__field">
              <span className="pin-screen__label">確認のため もう一度</span>
              <input
                className="pin-screen__input"
                type="password"
                name="confirm-pin"
                value={confirmPin}
                onChange={(e) => setConfirmPin(toPinValue(e.target.value))}
                inputMode="numeric"
                maxLength={4}
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
                disabled={submitting}
              />
            </label>

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
              {submitting ? '再設定しています…' : 'あたらしいPINにする'}
            </button>
          </form>
        </section>
      )}
    </div>
  )
}
