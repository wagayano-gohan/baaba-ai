import { useCallback, useState } from 'react'
import { HomeScreen } from './screens/HomeScreen'
import { RecordingScreen } from './screens/RecordingScreen'
import { ConfirmScreen } from './screens/ConfirmScreen'
import { ScheduleListScreen } from './screens/ScheduleListScreen'
import { initialSchedules, recordedDummySchedule, type ScheduleItem } from './data/schedules'

// 仕様書 5章「画面遷移図」に対応する状態
type Screen =
  | { name: 'home' }
  | { name: 'recording' }
  | { name: 'confirm'; mode: 'register' }
  | { name: 'confirm'; mode: 'edit'; item: ScheduleItem }
  | { name: 'list' }

function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  // 予定データは画面内の一時的な状態のみ（保存・通信は行わない）
  const [schedules, setSchedules] = useState<ScheduleItem[]>(initialSchedules)

  const goHome = useCallback(() => setScreen({ name: 'home' }), [])
  const goList = useCallback(() => setScreen({ name: 'list' }), [])
  const startRecording = useCallback(() => setScreen({ name: 'recording' }), [])
  const stopRecording = useCallback(() => setScreen({ name: 'confirm', mode: 'register' }), [])
  const startEdit = useCallback(
    (item: ScheduleItem) => setScreen({ name: 'confirm', mode: 'edit', item }),
    [],
  )
  const deleteSchedule = useCallback((id: number) => {
    setSchedules((prev) => prev.filter((item) => item.id !== id))
  }, [])

  return (
    <div className="app-shell">
      {screen.name === 'home' && (
        <HomeScreen onStartRecording={startRecording} onNavigateList={goList} />
      )}

      {screen.name === 'recording' && <RecordingScreen onStopRecording={stopRecording} />}

      {screen.name === 'confirm' && screen.mode === 'register' && (
        <ConfirmScreen
          mode="register"
          item={recordedDummySchedule}
          onComplete={goHome}
          onCancel={goHome}
        />
      )}

      {screen.name === 'confirm' && screen.mode === 'edit' && (
        <ConfirmScreen mode="edit" item={screen.item} onComplete={goList} onCancel={goList} />
      )}

      {screen.name === 'list' && (
        <ScheduleListScreen
          schedules={schedules}
          onNavigateHome={goHome}
          onEdit={startEdit}
          onDelete={deleteSchedule}
        />
      )}
    </div>
  )
}

export default App
