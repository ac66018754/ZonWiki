'use client';

import React, { useRef, useState } from 'react';
import {
  previewVoice,
  ttsAudioUrl,
  type TtsVoice,
} from '@/lib/api';
import { formatVoiceLabel } from '@/lib/ttsPlayer';
import { showToast } from '@/lib/toast';

/**
 * TtsVoicePicker 的屬性。
 */
interface TtsVoicePickerProps {
  /** 可選聲音清單。 */
  voices: TtsVoice[];
  /** 是否載入中。 */
  isLoading: boolean;
  /** 目前選定聲音 name。 */
  currentVoice: string;
  /** 變更聲音（父層負責持久化＋重新合成）。 */
  onChangeVoice: (voice: string) => void;
  /** 是否停用整個選擇器（如合成中）。 */
  disabled?: boolean;
}

/**
 * 聲音選擇 UI（設計 §6.2 v1 簡化）：一個下拉（30 聲附風格標籤）＋一顆「▶ 試聽」鈕。
 *
 * 試聽：呼叫後端 preview 端點合成短句，用「獨立的暫態 Audio」播放（不動主播放器續聽位置）。
 * 對齊點 B：後端 preview 端點尚未提供 → 首次點擊命中 404 後灰掉試聽鈕＋tooltip，不阻斷主流程。
 */
export function TtsVoicePicker({
  voices,
  isLoading,
  currentVoice,
  onChangeVoice,
  disabled = false,
}: TtsVoicePickerProps) {
  // 試聽端點是否可用：null＝尚未測、true＝可用、false＝已知未就緒（灰掉）。
  const [previewAvailable, setPreviewAvailable] = useState<boolean | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  // 暫態試聽用的 <audio>（獨立於主播放器，避免污染續聽位置）。
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  /**
   * 播放試聽音檔（獨立暫態 Audio）。
   */
  function playPreview(ttsAudioId: string) {
    try {
      // 重用同一顆暫態 audio，避免重複建立。
      if (!previewAudioRef.current) {
        previewAudioRef.current = new Audio();
        previewAudioRef.current.crossOrigin = 'use-credentials';
      }
      const audio = previewAudioRef.current;
      audio.src = ttsAudioUrl(ttsAudioId);
      // play() 在 await 之後呼叫，手勢鏈可能已斷；失敗（autoplay 被擋）靜默吞掉。
      void audio.play().catch(() => {
        showToast('試聽已準備，請再點一次播放', { type: 'info' });
      });
    } catch {
      // 建立 Audio 失敗（極少）→ 靜默。
    }
  }

  /**
   * 點擊試聽。
   */
  async function handlePreview() {
    if (!currentVoice || isPreviewing) return;
    setIsPreviewing(true);
    try {
      const res = await previewVoice(currentVoice);
      if (!res.available) {
        setPreviewAvailable(false);
        showToast('後端試聽端點尚未就緒', { type: 'info' });
        return;
      }
      setPreviewAvailable(true);
      if (res.rateLimited) {
        showToast('請求太頻繁，請稍候再試', { type: 'error' });
        return;
      }
      if (res.ok && res.result) {
        if (res.result.status === 'ready') {
          playPreview(res.result.ttsAudioId);
        } else {
          showToast('試聽合成中，請稍候再試', { type: 'info' });
        }
      } else {
        showToast(res.error ?? '試聽失敗', { type: 'error' });
      }
    } finally {
      setIsPreviewing(false);
    }
  }

  const previewDisabled =
    disabled || isLoading || !currentVoice || previewAvailable === false || isPreviewing;

  return (
    <div className="tts-voice">
      <label className="tts-voice__label" htmlFor="tts-voice-select">
        朗讀聲音
      </label>
      <div className="tts-voice__row">
        <select
          id="tts-voice-select"
          className="tts-voice__select"
          value={currentVoice}
          disabled={disabled || isLoading || voices.length === 0}
          onChange={(e) => onChangeVoice(e.target.value)}
        >
          {isLoading && <option value={currentVoice}>載入聲音中…</option>}
          {!isLoading && voices.length === 0 && (
            <option value={currentVoice}>聲音清單載入失敗</option>
          )}
          {!isLoading &&
            voices.map((voice) => (
              <option key={voice.name} value={voice.name}>
                {formatVoiceLabel(voice)}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="tts-voice__preview"
          onClick={handlePreview}
          disabled={previewDisabled}
          title={
            previewAvailable === false
              ? '後端試聽端點尚未就緒'
              : '試聽這個聲音（合成一句短句）'
          }
        >
          {isPreviewing ? '試聽中…' : '▶ 試聽'}
        </button>
      </div>

      <style jsx>{`
        .tts-voice {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-1);
          min-width: 0;
        }

        .tts-voice__label {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .tts-voice__row {
          display: flex;
          align-items: center;
          gap: var(--spacing-2);
        }

        .tts-voice__select {
          flex: 1;
          min-width: 0;
          min-height: 40px;
          padding: var(--spacing-1) var(--spacing-2);
          background: var(--bg-surface);
          color: var(--text-primary);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          cursor: pointer;
        }

        .tts-voice__select:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: 1px;
          border-color: var(--focus-ring);
        }

        .tts-voice__select:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .tts-voice__preview {
          flex-shrink: 0;
          min-height: 40px;
          padding: var(--spacing-1) var(--spacing-3);
          background: transparent;
          color: var(--action-secondary-fg);
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .tts-voice__preview:hover:not(:disabled) {
          background: var(--bg-surface-secondary);
          border-color: var(--action-secondary-fg);
        }

        /* 按壓態（四態之 active）：試聽鈕按下回饋。 */
        .tts-voice__preview:active:not(:disabled) {
          background: var(--bg-surface-secondary);
          border-color: var(--action-secondary-fg);
          transform: translateY(1px);
        }

        .tts-voice__preview:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: 1px;
        }

        .tts-voice__preview:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
