import { StopIcon } from '../components/icons'
import './RecordingScreen.css'

interface RecordingScreenProps {
  onStopRecording: () => void
}

// 仕様書 8章: ②録音中画面
// 実際の録音・音声認識は行わない。停止ボタンで③へダミーデータを渡す想定のみ。
export function RecordingScreen({ onStopRecording }: RecordingScreenProps) {
  return (
    <div className="recording-screen">
      <div className="recording-screen__message">
        <h1 className="recording-screen__title">聞いています</h1>
        <div className="recording-screen__indicator">
          <span className="recording-dot" aria-hidden="true" />
          <span className="recording-screen__hint">おはなし ください</span>
        </div>
      </div>

      <div className="recording-screen__action">
        <button
          type="button"
          className="stop-button tap-feedback"
          onClick={onStopRecording}
          aria-label="おわったら ボタンを おしてください"
        >
          <StopIcon size={44} />
        </button>
        <p className="recording-screen__caption">おわったら ボタンを おしてください</p>
      </div>
    </div>
  )
}
