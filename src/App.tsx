import { useCallback, useState } from 'react'
import { HomeScreen } from './screens/HomeScreen'
import { RecordingScreen } from './screens/RecordingScreen'
import { ConfirmScreen } from './screens/ConfirmScreen'
import { ScheduleScreen } from './screens/ScheduleListScreen'
import { ReservationScreen } from './screens/ReservationScreen'
import { voiceDraftSchedule } from './data/schedules'

type MainTab = 'home' | 'schedule' | 'reservation'

type Screen = { name: MainTab } | { name: 'recording' } | { name: 'confirm' }

function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  // 戻り先（録音→確認 完了後にどのタブへ戻るか）
  const [returnTab, setReturnTab] = useState<MainTab>('home')

  const goTab = useCallback((tab: MainTab) => setScreen({ name: tab }), [])
  const startRecording = useCallback((from: MainTab) => {
    setReturnTab(from)
    setScreen({ name: 'recording' })
  }, [])
  const stopRecording = useCallback(() => setScreen({ name: 'confirm' }), [])
  const finishConfirm = useCallback(() => setScreen({ name: returnTab }), [returnTab])

  return (
    <div className="app-shell">
      {screen.name === 'home' && (
        <HomeScreen onStartRecording={() => startRecording('home')} onNavigateTab={goTab} />
      )}

      {screen.name === 'schedule' && (
        <ScheduleScreen onStartRecording={() => startRecording('schedule')} onNavigateTab={goTab} />
      )}

      {screen.name === 'reservation' && <ReservationScreen onNavigateTab={goTab} />}

      {screen.name === 'recording' && <RecordingScreen onStopRecording={stopRecording} />}

      {screen.name === 'confirm' && (
        <ConfirmScreen
          mode="register"
          item={voiceDraftSchedule}
          onComplete={finishConfirm}
          onCancel={finishConfirm}
        />
      )}
    </div>
  )
}

export default App
