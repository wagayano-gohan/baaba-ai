import { useCallback, useEffect, useRef, useState } from 'react'
import { sendChatMessage } from '../lib/chat/chatClient'
import {
  appendMessage,
  clearHistory,
  createChatMessage,
  loadHistory,
  saveHistory,
} from '../lib/chat/conversation'
import type { ChatMessage } from '../lib/chat/conversation'
import { buildSystemPrompt } from '../lib/chat/systemPrompt'
import './ChatScreen.css'

interface ChatScreenProps {
  /** 指定されたときだけ「戻る」ボタンを表示する。 */
  onBack?: () => void
}

/** 応答待ちのあいだ、AI側の吹き出しに表示する文言。 */
const THINKING_LABEL = '回答を作成しています…'
/** 送信ボタンのラベル（送信中は押せないことが分かる表記に切り替える）。 */
const SENDING_LABEL = '送信中…'
const INPUT_PLACEHOLDER = '相談したい内容を入力してください'
const EMPTY_GUIDE = '相談したい内容を入力してください'

// Phase2 ③AI基盤: AIチャット画面（テキスト入力のみ。音声入力との連携はPhase2では行わない）
export function ChatScreen({ onBack }: ChatScreenProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [errorText, setErrorText] = useState('')

  const bottomRef = useRef<HTMLDivElement | null>(null)

  // マウント時に sessionStorage から会話履歴を復元する（DBには保存しない）。
  useEffect(() => {
    setMessages(loadHistory())
  }, [])

  // 新着メッセージ・状態変化のたびに一番下へスクロールする。
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages, isSending, errorText])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isSending) return

    const nextHistory = appendMessage(messages, createChatMessage('user', text))
    setMessages(nextHistory)
    saveHistory(nextHistory)
    setInput('')
    setErrorText('')
    setIsSending(true)

    try {
      const answer = await sendChatMessage(nextHistory, buildSystemPrompt())
      const withAnswer = appendMessage(nextHistory, createChatMessage('assistant', answer))
      setMessages(withAnswer)
      saveHistory(withAnswer)
    } catch (error) {
      console.error('[ChatScreen] 送信に失敗しました:', error)
      setErrorText(
        error instanceof Error && error.message
          ? error.message
          : '回答を取得できませんでした。もう一度お試しください',
      )
    } finally {
      setIsSending(false)
    }
  }, [input, isSending, messages])

  const handleReset = useCallback(() => {
    if (isSending) return
    clearHistory()
    setMessages([])
    setErrorText('')
    setInput('')
  }, [isSending])

  return (
    <div className="chat-screen">
      <header className="chat-screen__header">
        {onBack ? (
          <button type="button" className="chat-screen__header-button tap-feedback" onClick={onBack}>
            戻る
          </button>
        ) : (
          <span className="chat-screen__header-spacer" />
        )}
        <h1 className="chat-screen__title">AIに相談</h1>
        <button
          type="button"
          className="chat-screen__header-button tap-feedback"
          onClick={handleReset}
          disabled={isSending || messages.length === 0}
        >
          最初から
        </button>
      </header>

      <div className="chat-screen__scroll">
        {messages.length === 0 && !isSending && !errorText && (
          <p className="chat-screen__guide">{EMPTY_GUIDE}</p>
        )}

        <ul className="chat-screen__list">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`chat-bubble chat-bubble--${message.role === 'user' ? 'user' : 'ai'}`}
            >
              <span className="chat-bubble__speaker">
                {message.role === 'user' ? 'あなた' : 'ばーばAI'}
              </span>
              <p className="chat-bubble__text">{message.content}</p>
            </li>
          ))}

          {isSending && (
            <li className="chat-bubble chat-bubble--ai chat-bubble--thinking">
              <span className="chat-bubble__speaker">ばーばAI</span>
              <p className="chat-bubble__text">{THINKING_LABEL}</p>
            </li>
          )}

          {errorText && (
            <li className="chat-bubble chat-bubble--error" role="alert">
              <p className="chat-bubble__text">{errorText}</p>
            </li>
          )}
        </ul>

        <div ref={bottomRef} />
      </div>

      <div className="chat-screen__composer">
        <textarea
          className="chat-screen__input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={INPUT_PLACEHOLDER}
          rows={2}
          disabled={isSending}
          aria-label={INPUT_PLACEHOLDER}
        />
        <button
          type="button"
          className="chat-screen__send tap-feedback"
          onClick={handleSend}
          disabled={isSending || input.trim() === ''}
        >
          {isSending ? SENDING_LABEL : '送信'}
        </button>
      </div>
    </div>
  )
}
