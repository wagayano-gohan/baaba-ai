// 家族アカウント（owner_admin / viewer）のログイン画面。
// 本人(principal)端末はデバイストークンで認証するためこの画面を通らない。
// 本人用端末として設定したい場合は onGoDeviceSetup から DeviceSetupScreen へ遷移する。

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import './LoginScreen.css'

interface LoginScreenProps {
  /** ログイン成功時に呼ばれる（画面遷移は呼び出し側の責務）。 */
  onLoggedIn?: () => void
  /** 「本人用端末として使う」導線。渡された場合のみボタンを表示する。 */
  onGoDeviceSetup?: () => void
}

// Supabase Authのエラーを利用者向けの日本語文言へ変換する。
function toJapaneseAuthMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code
  const message = error instanceof Error ? error.message : String(error)

  if (code === 'invalid_credentials' || message.includes('Invalid login credentials')) {
    return 'メールアドレスまたはパスワードが正しくありません'
  }
  if (code === 'email_not_confirmed' || message.includes('Email not confirmed')) {
    return 'メールアドレスの確認が完了していません。確認メールをご確認ください'
  }
  if (code === 'over_request_rate_limit' || message.includes('Too many requests')) {
    return '試行回数が多すぎます。しばらく時間をおいてからお試しください'
  }
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'サーバーに接続できませんでした。通信環境を確認してください'
  }
  return message || 'ログインに失敗しました'
}

export function LoginScreen({ onLoggedIn, onGoDeviceSetup }: LoginScreenProps) {
  const { signIn, configError } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return

    setErrorMessage(null)

    if (!email.trim() || !password) {
      setErrorMessage('メールアドレスとパスワードを入力してください')
      return
    }

    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
      setPassword('')
      onLoggedIn?.()
    } catch (error) {
      setErrorMessage(toJapaneseAuthMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-screen">
      <h1 className="login-screen__heading">ばーばAI</h1>
      <p className="login-screen__lead">ご家族の方はこちらからログインしてください</p>

      {configError && <p className="login-screen__config-error">{configError}</p>}

      <form className="login-form" onSubmit={handleSubmit} noValidate>
        <label className="login-form__field">
          <span className="login-form__label">メールアドレス</span>
          <input
            className="login-form__input"
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            disabled={submitting}
          />
        </label>

        <label className="login-form__field">
          <span className="login-form__label">パスワード</span>
          <input
            className="login-form__input"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={submitting}
          />
        </label>

        {errorMessage && (
          <p className="login-form__error" role="alert">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          className="login-form__submit tap-feedback"
          disabled={submitting || Boolean(configError)}
        >
          {submitting ? 'ログインしています…' : 'ログイン'}
        </button>
      </form>

      {onGoDeviceSetup && (
        <button
          type="button"
          className="login-screen__device-link tap-feedback"
          onClick={onGoDeviceSetup}
          disabled={submitting}
        >
          本人（おばあちゃん）用の端末として使う
        </button>
      )}
    </div>
  )
}
