// Phase2アプリシェル。
//
// Phase2で実装した3基盤（①認証 ②音声 ③AIチャット）を1つのSPAとして配線する。
// 画面遷移はルーターライブラリを使わず、useStateによる単純な判別ユニオンで管理する。
// ホーム画面や予定/ToDo等のPhase3以降の画面はここには存在しない。

import { useCallback, useState } from 'react'
import type { CSSProperties } from 'react'
import { useAuth } from './contexts/AuthContext'
import { LoginScreen } from './screens/LoginScreen'
import { DeviceSetupScreen } from './screens/DeviceSetupScreen'
import { Phase2MenuScreen } from './screens/Phase2MenuScreen'
import { PinSetupScreen } from './screens/PinSetupScreen'
import { PinVerifyScreen } from './screens/PinVerifyScreen'
import { PinResetScreen } from './screens/PinResetScreen'
import { VoiceRecordScreen } from './screens/VoiceRecordScreen'
import { VoiceConfirmScreen } from './screens/VoiceConfirmScreen'
import { ChatScreen } from './screens/ChatScreen'
import type { VoiceIntentResult } from './lib/voice/voicePipeline'

// PIN確認（PinVerifyScreen）は「メニューから明示的に確認する」場合と
// 「本人端末の登録がPIN_REQUIREDで弾かれた場合」の両方から入るため、成功・戻り先を持たせる。
type PinVerifyOrigin = 'menu' | 'deviceSetup'

type Screen =
  | { name: 'menu' }
  | { name: 'deviceSetup' }
  | { name: 'pinSetup' }
  | { name: 'pinVerify'; origin: PinVerifyOrigin }
  | { name: 'pinReset' }
  | { name: 'voiceRecord' }
  | { name: 'voiceConfirm'; result: VoiceIntentResult; transcript: string }
  | { name: 'chat' }

// 起動直後のローディング／設定不備表示は画面遷移を伴わない一時表示のため、
// 専用のCSSファイルを増やさずインラインスタイルで最小限に表示する。
const statusStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px 24px',
  textAlign: 'center',
  fontSize: '20px',
  fontWeight: 600,
  lineHeight: 1.6,
  color: 'var(--color-text)',
  background: 'var(--color-page)',
}

const errorStatusStyle: CSSProperties = {
  ...statusStyle,
  color: 'var(--color-alert)',
}

function App() {
  const { loading, configError, user, deviceRegistered, activeProfileId, activeRole } = useAuth()
  const [screen, setScreen] = useState<Screen>({ name: 'menu' })
  // 未ログイン時に「本人用端末として使う」からDeviceSetupScreenへ入ったかどうか。
  const [setupFromLogin, setSetupFromLogin] = useState(false)

  const goMenu = useCallback(() => setScreen({ name: 'menu' }), [])
  const goDeviceSetup = useCallback(() => setScreen({ name: 'deviceSetup' }), [])
  const goVoiceRecord = useCallback(() => setScreen({ name: 'voiceRecord' }), [])
  const goChat = useCallback(() => setScreen({ name: 'chat' }), [])
  const goPinSetup = useCallback(() => setScreen({ name: 'pinSetup' }), [])
  const goPinReset = useCallback(() => setScreen({ name: 'pinReset' }), [])
  const goPinVerifyFromMenu = useCallback(() => setScreen({ name: 'pinVerify', origin: 'menu' }), [])
  const goPinVerifyFromDeviceSetup = useCallback(
    () => setScreen({ name: 'pinVerify', origin: 'deviceSetup' }),
    [],
  )

  const handleRecognized = useCallback((result: VoiceIntentResult, transcript: string) => {
    setScreen({ name: 'voiceConfirm', result, transcript })
  }, [])

  const openDeviceSetupFromLogin = useCallback(() => {
    setSetupFromLogin(true)
    setScreen({ name: 'deviceSetup' })
  }, [])

  const closeDeviceSetupToLogin = useCallback(() => {
    setSetupFromLogin(false)
    setScreen({ name: 'menu' })
  }, [])

  const handleLoggedIn = useCallback(() => {
    setSetupFromLogin(false)
    setScreen({ name: 'menu' })
  }, [])

  // 本人(principal)端末はメール・パスワードを使わない設計のため、
  // デバイス登録済みの端末はログインなしでメニューを表示する。
  const canUseApp = deviceRegistered || Boolean(user)

  // 管理者PIN関連の画面は、家族アカウントでログイン中かつ、選択中の家族に対してowner_adminの
  // 場合のみ到達できる。家族未選択（activeProfileIdがnull）のときはactiveRoleもnullになるため、
  // この条件だけで「未選択のまま操作させない」も満たせる。
  const canManagePin = Boolean(user) && Boolean(activeProfileId) && activeRole === 'owner_admin'
  const pinProfileId = activeProfileId ?? ''
  // 権限・選択状態が変わって条件を満たさなくなった場合に、PIN画面へ留まって行き止まりにならないようにする。
  const showPinScreen =
    canManagePin &&
    (screen.name === 'pinSetup' || screen.name === 'pinVerify' || screen.name === 'pinReset')

  let content
  if (loading) {
    content = <div style={statusStyle}>読み込んでいます…</div>
  } else if (configError) {
    content = <div style={errorStatusStyle}>{configError}</div>
  } else if (!canUseApp) {
    // 未ログイン かつ 本人端末未登録。ログイン画面と本人端末設定画面のみ行き来できる。
    content =
      screen.name === 'deviceSetup' ? (
        <DeviceSetupScreen onBack={closeDeviceSetupToLogin} onDone={closeDeviceSetupToLogin} />
      ) : (
        <LoginScreen onLoggedIn={handleLoggedIn} onGoDeviceSetup={openDeviceSetupFromLogin} />
      )
  } else if (screen.name === 'deviceSetup') {
    // 未ログイン状態で入った本人端末設定から登録が完了した場合も、そのままこの画面に留まり、
    // 「戻る」「終わる」でメニューへ移動する。
    const back = setupFromLogin ? closeDeviceSetupToLogin : goMenu
    content = (
      <DeviceSetupScreen
        onBack={back}
        onDone={back}
        onNeedPinVerify={canManagePin ? goPinVerifyFromDeviceSetup : undefined}
      />
    )
  } else if (showPinScreen && screen.name === 'pinSetup') {
    content = (
      <PinSetupScreen
        profileId={pinProfileId}
        onDone={goMenu}
        onBack={goMenu}
        onGoVerify={goPinVerifyFromMenu}
        onGoReset={goPinReset}
      />
    )
  } else if (showPinScreen && screen.name === 'pinVerify') {
    // PIN確認セッションはサーバー側で保持されるため、成功後は元の操作へ戻すだけでよい。
    const afterVerify = screen.origin === 'deviceSetup' ? goDeviceSetup : goMenu
    content = (
      <PinVerifyScreen
        profileId={pinProfileId}
        onVerified={afterVerify}
        onForgot={goPinReset}
        onBack={afterVerify}
        onGoSetup={goPinSetup}
      />
    )
  } else if (showPinScreen && screen.name === 'pinReset') {
    content = <PinResetScreen profileId={pinProfileId} onDone={goMenu} onBack={goMenu} />
  } else if (screen.name === 'voiceRecord') {
    content = <VoiceRecordScreen onRecognized={handleRecognized} onCancel={goMenu} />
  } else if (screen.name === 'voiceConfirm') {
    content = (
      <VoiceConfirmScreen
        result={screen.result}
        transcript={screen.transcript}
        onDone={goMenu}
        onRetry={goVoiceRecord}
      />
    )
  } else if (screen.name === 'chat') {
    content = <ChatScreen onBack={goMenu} />
  } else {
    content = (
      <Phase2MenuScreen
        onGoVoice={goVoiceRecord}
        onGoChat={goChat}
        onGoDeviceSetup={goDeviceSetup}
        onGoPinSetup={goPinSetup}
        onGoPinVerify={goPinVerifyFromMenu}
        onGoPinReset={goPinReset}
      />
    )
  }

  return <div className="app-shell">{content}</div>
}

export default App
