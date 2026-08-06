// 管理者PINの初回設定画面。
//
// 管理者PINは、本人(principal)端末の登録など「家族の管理者だけが行える操作」の直前に
// 確認を求めるための4桁の暗証番号である。ログインパスワードとは別物であり、
// この画面ではまだPINが未設定のprofileに対して最初の1回だけ設定する。
//
// 呼び出すEdge Function: manage-admin-pin（operation: 'set'）

import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiCallError, callUserAuthedFunction } from '../lib/apiClient'
import './PinSetupScreen.css'

interface PinSetupScreenProps {
  /** 設定対象のprofileId（家族）。 */
  profileId: string
  /** 設定が完了して「終わる」を押したときに呼ばれる。 */
  onDone: () => void
  /** 戻る導線。 */
  onBack: () => void
  /** すでにPINがある場合の「PINを確認する（変更の入口）」導線。渡された場合のみ表示する。 */
  onGoVerify?: () => void
  /** すでにPINがある場合の「PINを忘れた場合の再設定」導線。渡された場合のみ表示する。 */
  onGoReset?: () => void
}

const PIN_PATTERN = /^\d{4}$/

/** 数字以外を落として4桁までに丸める。IMEや音声入力で全角が混ざっても壊れないようにする。 */
function toPinValue(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, 4)
}

function toJapaneseMessage(error: unknown): string {
  if (error instanceof ApiCallError) {
    if (error.code === 'ALREADY_EXISTS') {
      return 'すでにPINが設定されています'
    }
    if (error.code === 'PIN_INVALID') {
      return 'PINは4桁の数字で入力してください'
    }
    if (error.code === 'UNAUTHENTICATED') {
      return 'ログインが必要です。ご家族の管理者アカウントでログインしてください'
    }
    if (error.code === 'PROFILE_ACCESS_DENIED') {
      return 'この操作を行う権限がありません（管理者のアカウントが必要です）'
    }
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

export function PinSetupScreen({
  profileId,
  onDone,
  onBack,
  onGoVerify,
  onGoReset,
}: PinSetupScreenProps) {
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // ALREADY_EXISTSのときだけ、変更／再設定への導線を出す。
  const [alreadyExists, setAlreadyExists] = useState(false)
  const [succeeded, setSucceeded] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting || succeeded) return

    setErrorMessage(null)
    setAlreadyExists(false)

    // サーバーへ送る前にローカルで検証し、無駄な試行を減らす。
    if (!PIN_PATTERN.test(newPin)) {
      setErrorMessage('PINは数字4桁で入力してください')
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
        operation: 'set',
        profileId,
        new_pin: newPin,
        confirm_pin: confirmPin,
      })
      setNewPin('')
      setConfirmPin('')
      setSucceeded(true)
    } catch (error) {
      if (error instanceof ApiCallError && error.code === 'ALREADY_EXISTS') {
        setAlreadyExists(true)
      }
      setErrorMessage(toJapaneseMessage(error))
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
        <h1 className="pin-screen__heading">管理者PINの設定</h1>
        <p className="pin-screen__lead">
          本人用端末の登録などの大事な操作のときに使う、数字4桁の暗証番号を決めてください。
          ログインのパスワードとは別のものです。
        </p>
      </header>

      {succeeded ? (
        <section className="pin-screen__section pin-screen__section--done">
          <p className="pin-screen__success" role="status">
            管理者PINを設定しました
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
              {submitting ? '設定しています…' : 'このPINにする'}
            </button>
          </form>

          {alreadyExists && (
            <div className="pin-screen__links">
              <p className="pin-screen__note">
                PINを変えたい場合は、いまのPINを入力してから変更してください。
                PINが分からない場合は、ログインのパスワードで再設定できます。
              </p>
              {onGoVerify && (
                <button
                  type="button"
                  className="pin-screen__button pin-screen__button--secondary tap-feedback"
                  onClick={onGoVerify}
                >
                  いまのPINを入力する
                </button>
              )}
              {onGoReset && (
                <button
                  type="button"
                  className="pin-screen__button pin-screen__button--secondary tap-feedback"
                  onClick={onGoReset}
                >
                  PINを忘れた場合の再設定
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
