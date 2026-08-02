import { useCallback, useState } from 'react'
import { HomeScreen } from './screens/HomeScreen'
import { RecordingScreen } from './screens/RecordingScreen'
import { ConfirmScreen } from './screens/ConfirmScreen'
import type { ConfirmMode } from './screens/ConfirmScreen'
import { ScheduleScreen } from './screens/ScheduleListScreen'
import { ScheduleDetailScreen } from './screens/ScheduleDetailScreen'
import { ReservationScreen } from './screens/ReservationScreen'
import { voiceDraftSchedule } from './data/schedules'
import type { VoiceDraftSchedule } from './data/schedules'
import type { Appointment } from './lib/appointments'
import { createAppointment, updateAppointment } from './lib/appointments'
import { parseDraftToScheduledAtISO, toDateLabel, toTimeLabel } from './utils/date'

type MainTab = 'home' | 'schedule' | 'reservation'

type Screen = { name: MainTab } | { name: 'recording' } | { name: 'confirm' } | { name: 'detail'; appointment: Appointment }

function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  // 戻り先（録音→確認 完了後にどのタブへ戻るか）
  const [returnTab, setReturnTab] = useState<MainTab>('home')
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>('register')
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null)

  const goTab = useCallback((tab: MainTab) => setScreen({ name: tab }), [])

  const startRecording = useCallback((from: MainTab) => {
    setReturnTab(from)
    setConfirmMode('register')
    setEditingAppointment(null)
    setScreen({ name: 'recording' })
  }, [])

  const stopRecording = useCallback(() => setScreen({ name: 'confirm' }), [])
  const finishConfirm = useCallback(() => setScreen({ name: returnTab }), [returnTab])

  const openDetail = useCallback((appointment: Appointment) => {
    setReturnTab('schedule')
    setScreen({ name: 'detail', appointment })
  }, [])

  const startEdit = useCallback((appointment: Appointment) => {
    setReturnTab('schedule')
    setEditingAppointment(appointment)
    setConfirmMode('edit')
    setScreen({ name: 'confirm' })
  }, [])

  const handleDeleted = useCallback(() => setScreen({ name: 'schedule' }), [])

  // ③AI確認画面に渡す表示用データ。編集時は選択中の予定から、新規登録時は
  // 音声登録フロー（今回のスコープ外）のダミー下書きから組み立てる。
  const confirmItem: VoiceDraftSchedule =
    confirmMode === 'edit' && editingAppointment
      ? {
          dateLabel: toDateLabel(new Date(editingAppointment.scheduled_at)),
          timeLabel: toTimeLabel(new Date(editingAppointment.scheduled_at)),
          content: editingAppointment.title,
        }
      : voiceDraftSchedule

  const handleConfirmSubmit = useCallback(async () => {
    if (confirmMode === 'edit' && editingAppointment) {
      await updateAppointment(editingAppointment.id, {
        title: editingAppointment.title,
        scheduled_at: editingAppointment.scheduled_at,
      })
    } else {
      await createAppointment({
        title: voiceDraftSchedule.content,
        scheduled_at: parseDraftToScheduledAtISO(voiceDraftSchedule.dateLabel, voiceDraftSchedule.timeLabel),
      })
    }
  }, [confirmMode, editingAppointment])

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

      {screen.name === 'recording' && <RecordingScreen onStopRecording={stopRecording} />}

      {screen.name === 'confirm' && (
        <ConfirmScreen
          mode={confirmMode}
          item={confirmItem}
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
