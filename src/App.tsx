import { useCallback, useState } from 'react'
import { HomeScreen } from './screens/HomeScreen'
import { RecordingScreen } from './screens/RecordingScreen'
import { ConfirmScreen } from './screens/ConfirmScreen'
import { ScheduleScreen } from './screens/ScheduleListScreen'
import { ScheduleDetailScreen } from './screens/ScheduleDetailScreen'
import { ReservationScreen } from './screens/ReservationScreen'
import type { VoiceDraftSchedule } from './data/schedules'
import type { Appointment } from './lib/appointments'
import { createAppointment, updateAppointment } from './lib/appointments'
import { parseDraftToScheduledAtISO, toDateLabel, toTimeLabel } from './utils/date'

type MainTab = 'home' | 'schedule' | 'reservation'

type Screen =
  | { name: MainTab }
  | { name: 'recording' }
  | { name: 'confirm'; mode: 'register'; draft: VoiceDraftSchedule }
  | { name: 'confirm'; mode: 'edit'; appointment: Appointment }
  | { name: 'detail'; appointment: Appointment }

function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  // 戻り先（録音→確認 完了後にどのタブへ戻るか）
  const [returnTab, setReturnTab] = useState<MainTab>('home')

  const goTab = useCallback((tab: MainTab) => setScreen({ name: tab }), [])

  const startRecording = useCallback((from: MainTab) => {
    setReturnTab(from)
    setScreen({ name: 'recording' })
  }, [])

  // 音声認識・意図抽出に成功したら、抽出済みの下書きを持ってAI確認画面へ進む。
  const handleRecognized = useCallback((draft: VoiceDraftSchedule) => {
    setScreen({ name: 'confirm', mode: 'register', draft })
  }, [])

  // マイク不可・認識失敗・意図不明のときは、録音を開始した画面へ戻る。
  const cancelRecording = useCallback(() => setScreen({ name: returnTab }), [returnTab])

  const finishConfirm = useCallback(() => setScreen({ name: returnTab }), [returnTab])

  const openDetail = useCallback((appointment: Appointment) => {
    setReturnTab('schedule')
    setScreen({ name: 'detail', appointment })
  }, [])

  const startEdit = useCallback((appointment: Appointment) => {
    setReturnTab('schedule')
    setScreen({ name: 'confirm', mode: 'edit', appointment })
  }, [])

  const handleDeleted = useCallback(() => setScreen({ name: 'schedule' }), [])

  const handleConfirmSubmit = useCallback(async () => {
    if (screen.name !== 'confirm') return
    if (screen.mode === 'edit') {
      await updateAppointment(screen.appointment.id, {
        title: screen.appointment.title,
        scheduled_at: screen.appointment.scheduled_at,
      })
    } else {
      await createAppointment({
        title: screen.draft.content,
        scheduled_at: parseDraftToScheduledAtISO(screen.draft.dateLabel, screen.draft.timeLabel),
      })
    }
  }, [screen])

  return (
    <div className="app-shell">
      {screen.name === 'home' && (
        <HomeScreen onStartRecording={() => startRecording('home')} onNavigateTab={goTab} />
      )}

      {screen.name === 'schedule' && (
        <ScheduleScreen
          onStartRecording={() => startRecording('schedule')}
          onNavigateTab={goTab}
          onSelectAppointment={openDetail}
        />
      )}

      {screen.name === 'reservation' && <ReservationScreen onNavigateTab={goTab} />}

      {screen.name === 'recording' && (
        <RecordingScreen onRecognized={handleRecognized} onCancel={cancelRecording} />
      )}

      {screen.name === 'confirm' && (
        <ConfirmScreen
          mode={screen.mode}
          item={
            screen.mode === 'edit'
              ? {
                  dateLabel: toDateLabel(new Date(screen.appointment.scheduled_at)),
                  timeLabel: toTimeLabel(new Date(screen.appointment.scheduled_at)),
                  content: screen.appointment.title,
                }
              : screen.draft
          }
          onSubmit={handleConfirmSubmit}
          onComplete={finishConfirm}
          onCancel={finishConfirm}
        />
      )}

      {screen.name === 'detail' && (
        <ScheduleDetailScreen
          appointment={screen.appointment}
          onBack={() => setScreen({ name: 'schedule' })}
          onEdit={startEdit}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}

export default App
