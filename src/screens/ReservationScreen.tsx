import { BottomNav } from '../components/BottomNav'
import { TopBar } from '../components/TopBar'

interface ReservationScreenProps {
  onNavigateTab: (tab: 'home' | 'schedule' | 'reservation') => void
}

// 予約画面は今回のスコープ外。ビルドを通すための最小プレースホルダー。
export function ReservationScreen({ onNavigateTab }: ReservationScreenProps) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <TopBar title="予約" />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9a9aa0' }}>
        準備中
      </div>
      <BottomNav active="reservation" onNavigateTab={onNavigateTab} />
    </div>
  )
}
