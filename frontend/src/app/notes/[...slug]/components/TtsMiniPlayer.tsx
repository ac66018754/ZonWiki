'use client';

import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import {
  synthesizeNote,
  getTtsStatus,
  ttsAudioUrl,
  updateTtsSettings,
  DEFAULT_TTS_VOICE,
  type TtsChapter,
  type TtsMode,
} from '@/lib/api';
import { useTtsSettings, useTtsVoices, swrKeys } from '@/lib/swr';
import { showToast } from '@/lib/toast';
import {
  clampSeek,
  currentChapterIndex,
  formatDuration,
  loadProgress,
  saveProgress,
  clearProgress,
  loadRate,
  saveRate,
  shouldResume,
  TTS_SEEK_STEP_SECONDS,
  TTS_RATE_OPTIONS,
  TTS_POLL_INTERVAL_MS,
  TTS_POLL_MAX_MS,
  TTS_POLL_MAX_CONSECUTIVE_ERRORS,
  TTS_PROGRESS_SAVE_THROTTLE_MS,
  nextPhase,
  type TtsPlayerPhase,
  type TtsPlayerEvent,
} from '@/lib/ttsPlayer';
import { TtsChapterList } from './TtsChapterList';
import { TtsVoicePicker } from './TtsVoicePicker';

/**
 * TtsMiniPlayer 的屬性。
 */
interface TtsMiniPlayerProps {
  /** 來源筆記 ID。 */
  noteId: string;
  /** 筆記標題（播放器抬頭顯示）。 */
  noteTitle: string;
  /** 朗讀模式（Phase 3）："read"＝單人朗讀（預設）／"dialogue"＝雙主持人 Podcast。 */
  mode?: TtsMode;
  /** 關閉播放器（父層收掉本元件）。 */
  onClose: () => void;
}

/**
 * 底部迷你 TTS 播放器（設計 §6.6 / 計畫 §7-8）。
 *
 * 職責：以單一 `<audio>` 元素承載整個生命週期——
 *   1. 開啟即依使用者聲音偏好觸發後端合成（`synthesizeNote`）；
 *   2. 若回 processing 則輪詢 `/status`（穩定 interval，不以固定 90 秒判死，對齊後端 600 秒預算）；
 *   3. ready 後設 `<audio>.src`、套續聽位置，**不自動播放**（等使用者手勢按 ▶，iOS/桌機 autoplay 規範）；
 *   4. 提供播放/暫停、±15 秒、語速（playbackRate，不重合成）、章節跳段、續聽位置、失敗重試。
 *
 * 合成／輪詢的整段生命週期收在單一 `useEffect`（keyed on noteId/voice/retry），
 * cleanup 以 `cancelled` 旗標＋`clearInterval` 保證換筆記/換聲音/卸載時不殘留計時器（鐵則 #21）。
 */
export function TtsMiniPlayer({ noteId, noteTitle, mode = 'read', onClose }: TtsMiniPlayerProps) {
  // 是否為雙人 Podcast 模式（供抬頭與狀態文案；不影響控制項）。
  const isDialogue = mode === 'dialogue';
  const { mutate } = useSWRConfig();
  const settingsQuery = useTtsSettings();
  const voicesQuery = useTtsVoices();

  // 使用者在本次 session 內的聲音覆寫（優先於後端設定）。
  const [voiceOverride, setVoiceOverride] = useState<string | null>(null);
  const settingsLoading = settingsQuery.isLoading;
  const effectiveVoice =
    voiceOverride ?? settingsQuery.data?.defaultVoice ?? DEFAULT_TTS_VOICE;

  // 播放器階段與資料。
  // 階段改用 reducer 驅動：所有階段轉換一律委派給 lib/ttsPlayer 的純函式 nextPhase，
  // 讓「狀態機 nextPhase 對照」的單元測試真正覆蓋元件實際執行的轉換路徑，
  // 而非測一段產品不會執行的死碼（對抗式復審 MEDIUM：狀態機假信心）。
  // 元件各處只需 dispatchPhase(事件)，禁止再直接指定目標階段。
  const [phase, dispatchPhase] = useReducer(
    (current: TtsPlayerPhase, event: TtsPlayerEvent): TtsPlayerPhase =>
      nextPhase(current, event),
    'requesting',
  );
  const [ttsAudioId, setTtsAudioId] = useState<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string>('');
  const [chapters, setChapters] = useState<TtsChapter[]>([]);
  const [durationState, setDurationState] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [rate, setRate] = useState<number>(() => loadRate());
  const [errorText, setErrorText] = useState<string | null>(null);
  const [segmentsDone, setSegmentsDone] = useState<number | null>(null);
  const [segmentsTotal, setSegmentsTotal] = useState<number | null>(null);
  const [showChapters, setShowChapters] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioIdRef = useRef<string | null>(null);
  const lastSaveRef = useRef<number>(0);
  // 關閉鈕（播放器內第一個永遠存在的可聚焦控制）：開啟時把鍵盤焦點移入這裡。
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  // 持有最新的關閉行為，供全域 Esc 監聽呼叫（避免 stale closure）。
  const handleCloseRef = useRef<() => void>(() => {});

  // 讓卸載 cleanup 取得最新的 ttsAudioId（存續聽位置用）。
  useEffect(() => {
    ttsAudioIdRef.current = ttsAudioId;
  }, [ttsAudioId]);

  // ── 合成＋輪詢的整段生命週期（換 noteId/聲音/重試即重跑；cleanup 保證無殘留計時器）──────────
  useEffect(() => {
    // 設定尚未載入完成前不啟動（避免用 DEFAULT 先合成、設定到位後又重合成一次）。
    if (settingsLoading) return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let pollStart = 0;
    let pollErrors = 0;
    let busy = false;

    const clearPoll = () => {
      if (interval != null) {
        clearInterval(interval);
        interval = null;
      }
    };

    /**
     * 套用 ready：設 src、章節、時長；不自動播。
     * @param readyEvent 觸發此次就緒的狀態機事件——
     *   從 requesting 直接命中快取時為 'synthReady'；從 processing 輪詢得到時為 'pollReady'。
     *   （nextPhase 需依來源階段給對應事件，兩者都會轉到 'ready'。）
     */
    const applyReady = async (
      id: string,
      chs: TtsChapter[] | null,
      dur: number | null,
      readyEvent: TtsPlayerEvent,
    ) => {
      let finalChapters = chs;
      let finalDuration = dur;
      // 快取命中但沒帶章節 → 補打一次 /status 取章節（對齊點 E / 審查 MEDIUM）。
      if (!finalChapters || finalChapters.length === 0) {
        const st = await getTtsStatus(id);
        if (cancelled) return;
        if (st) {
          finalChapters = st.chapters ?? finalChapters;
          finalDuration = st.durationSeconds ?? finalDuration;
        }
      }
      if (cancelled) return;
      setTtsAudioId(id);
      setChapters(finalChapters ?? []);
      if (finalDuration != null) setDurationState(finalDuration);
      setAudioSrc(ttsAudioUrl(id));
      dispatchPhase(readyEvent);
    };

    /** 單次輪詢。 */
    const tick = async (id: string) => {
      if (cancelled) {
        clearPoll();
        return;
      }
      if (busy) return; // 上一輪還在飛，跳過避免重疊
      // 絕對逾時：僅在仍 processing 時判定（後端仍可能正常進行，故上限拉到 > 後端 600 秒預算）。
      if (Date.now() - pollStart > TTS_POLL_MAX_MS) {
        clearPoll();
        dispatchPhase('pollFailed');
        setErrorText('合成逾時，請重試');
        return;
      }
      busy = true;
      const st = await getTtsStatus(id);
      busy = false;
      if (cancelled) {
        clearPoll();
        return;
      }
      if (st === null) {
        pollErrors += 1;
        if (pollErrors >= TTS_POLL_MAX_CONSECUTIVE_ERRORS) {
          clearPoll();
          dispatchPhase('pollFailed');
          setErrorText('無法取得合成狀態，請重試');
        }
        return;
      }
      pollErrors = 0;
      setSegmentsDone(st.segmentsDone ?? null);
      setSegmentsTotal(st.segmentsTotal ?? null);
      if (st.status === 'ready') {
        clearPoll();
        await applyReady(id, st.chapters ?? null, st.durationSeconds ?? null, 'pollReady');
      } else if (st.status === 'failed') {
        clearPoll();
        dispatchPhase('pollFailed');
        setErrorText(st.error ?? '合成失敗');
      }
      // processing → 繼續輪詢（不判死）。
    };

    /** 啟動輪詢。 */
    const startPoll = (id: string) => {
      clearPoll();
      pollStart = Date.now();
      pollErrors = 0;
      busy = false;
      interval = setInterval(() => {
        void tick(id);
      }, TTS_POLL_INTERVAL_MS);
    };

    /** 觸發一次合成流程。 */
    const run = async () => {
      // 換聲音/重試前，先停掉舊音檔的播放（否則設 audioSrc='' 不會自動停，舊聲音會繼續播）。
      try {
        audioRef.current?.pause();
      } catch {
        // 忽略。
      }
      // 重置 UI 為「準備中」：每次 run() 都是「重啟合成管線」（首載入／換聲音／換筆記／重試），
      // 用全域 'retry' 事件把任何當前階段統一拉回 requesting（nextPhase 對 retry 為全域轉移）。
      dispatchPhase('retry');
      setErrorText(null);
      setAudioSrc('');
      setChapters([]);
      setTtsAudioId(null);
      setCurrentTime(0);
      setSegmentsDone(null);
      setSegmentsTotal(null);

      const res = await synthesizeNote(noteId, { voice: effectiveVoice, mode });
      if (cancelled) return;
      if (!res.ok || !res.result) {
        dispatchPhase('synthFailed');
        setErrorText(res.rateLimited ? '請求太頻繁，請稍候再試' : res.error ?? '合成失敗');
        return;
      }
      const r = res.result;
      if (r.status === 'ready') {
        await applyReady(r.ttsAudioId, r.chapters ?? null, r.durationSeconds ?? null, 'synthReady');
      } else if (r.status === 'failed') {
        dispatchPhase('synthFailed');
        setErrorText('合成失敗');
      } else {
        setTtsAudioId(r.ttsAudioId);
        dispatchPhase('synthProcessing');
        startPoll(r.ttsAudioId);
      }
    };

    void run();

    return () => {
      cancelled = true;
      clearPoll();
    };
  }, [noteId, effectiveVoice, mode, settingsLoading, retryNonce]);

  // ── 卸載時保存續聽位置＋暫停（單一 audio 生命週期收尾）────────────────────────────────
  useEffect(() => {
    // 於 effect 執行當下擷取 audio 元素（整個生命週期同一顆，不會變動），供 cleanup 使用。
    const audio = audioRef.current;
    return () => {
      if (audio && ttsAudioIdRef.current) {
        saveProgress(ttsAudioIdRef.current, audio.currentTime);
      }
      if (audio) {
        try {
          audio.pause();
        } catch {
          // 忽略。
        }
      }
    };
  }, []);

  // ── src 變更時載入 metadata（觸發 onLoadedMetadata → 套續聽位置）─────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (audio && audioSrc) {
      audio.load();
    }
  }, [audioSrc]);

  // ── MediaSession 鎖屏控制（nice-to-have，feature-detect；設計 §6.5「時有時無」）────────────
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (phase !== 'ready' && phase !== 'playing' && phase !== 'paused') return;
    try {
      const ms = navigator.mediaSession;
      ms.metadata = new MediaMetadata({ title: noteTitle, artist: 'ZonWiki 朗讀' });
      ms.setActionHandler('play', () => {
        void audioRef.current?.play().catch(() => undefined);
      });
      ms.setActionHandler('pause', () => audioRef.current?.pause());
      // 直接讀 audioRef 做位移（避免向前參照下方的 skipBy 宣告）。
      ms.setActionHandler('seekbackward', () => {
        const a = audioRef.current;
        if (!a) return;
        a.currentTime = clampSeek(a.currentTime - TTS_SEEK_STEP_SECONDS, a.duration);
        // 同步 App 內進度條/時間碼（暫停時鎖屏跳段不會觸發 timeupdate，需手動同步；與 skipBy 一致）。
        setCurrentTime(a.currentTime);
      });
      ms.setActionHandler('seekforward', () => {
        const a = audioRef.current;
        if (!a) return;
        a.currentTime = clampSeek(a.currentTime + TTS_SEEK_STEP_SECONDS, a.duration);
        // 同步 App 內進度條/時間碼（暫停時鎖屏跳段不會觸發 timeupdate，需手動同步；與 skipBy 一致）。
        setCurrentTime(a.currentTime);
      });
    } catch {
      // 某些瀏覽器缺 MediaMetadata → 忽略。
    }
    // 播放器關閉/卸載時清掉鎖屏控制，避免殘留指向已卸載元素的 handler。
    return () => {
      try {
        const ms = navigator.mediaSession;
        ms.metadata = null;
        ms.setActionHandler('play', null);
        ms.setActionHandler('pause', null);
        ms.setActionHandler('seekbackward', null);
        ms.setActionHandler('seekforward', null);
      } catch {
        // 忽略。
      }
    };
  }, [phase, noteTitle]);

  // ── a11y：開啟時焦點移入播放器＋全域 Esc 關閉（設計為非模態工具列，不做 focus trap）──────────
  useEffect(() => {
    // 開啟當下把鍵盤焦點移入播放器的第一個控制（關閉鈕），讓鍵盤使用者不需 Tab 一路走進來。
    closeBtnRef.current?.focus();
    // 全域 Esc 關閉：播放器為固定於底部的常駐工具列，焦點可能已離開播放器，
    // 故監聽 document 而非只監聽本容器，確保開啟期間任何位置按 Esc 都能關閉。
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const currentIndex = useMemo(
    () => currentChapterIndex(chapters, currentTime),
    [chapters, currentTime],
  );

  // ── 控制項 ─────────────────────────────────────────────────────────────────────────
  const isPlaying = phase === 'playing';
  const isBusy = phase === 'requesting' || phase === 'processing';
  const canControl = phase === 'ready' || phase === 'playing' || phase === 'paused';

  /** 播放/暫停（play() 必在此使用者手勢鏈內）。 */
  function handlePlayPause() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => {
        // 播放被拒（如自動播放政策）＝無法載入播放 → 以 loadError 事件轉入 failed。
        dispatchPhase('loadError');
        setErrorText('播放失敗，請重試');
      });
    } else {
      audio.pause();
    }
  }

  /** ±秒數快轉/倒轉。 */
  function skipBy(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = clampSeek(audio.currentTime + delta, audio.duration);
    setCurrentTime(audio.currentTime);
  }

  /** 拖曳進度條。 */
  function handleScrub(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = clampSeek(value, audio.duration);
    setCurrentTime(audio.currentTime);
  }

  /** 變更語速（playbackRate，不重合成）。 */
  function handleRateChange(next: number) {
    setRate(next);
    saveRate(next);
    const audio = audioRef.current;
    if (audio) audio.playbackRate = next;
  }

  /** 章節跳段。 */
  function handleChapterSeek(startSeconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = clampSeek(startSeconds, audio.duration);
    setCurrentTime(audio.currentTime);
  }

  /** 變更聲音：持久化＋（透過 effect）重新合成。 */
  async function handleVoiceChange(nextVoice: string) {
    if (nextVoice === effectiveVoice) return;
    setVoiceOverride(nextVoice); // → effectiveVoice 改變 → 合成 effect 重跑（重新合成）
    const saved = await updateTtsSettings({ voice: nextVoice });
    if (saved) {
      void mutate(swrKeys.ttsSettings);
      showToast('已更新朗讀聲音', { type: 'success' });
    } else {
      showToast('聲音偏好未能儲存（本次仍會生效）', { type: 'info' });
    }
  }

  /** 失敗重試。 */
  function handleRetry() {
    setRetryNonce((n) => n + 1);
  }

  /** 關閉前保存續聽位置。 */
  function handleClose() {
    const audio = audioRef.current;
    if (audio && ttsAudioIdRef.current) saveProgress(ttsAudioIdRef.current, audio.currentTime);
    onClose();
  }
  // 每次 render 後把最新的 handleClose 同步到 ref，供「掛載一次」的全域 Esc 監聽呼叫（避免 stale closure）。
  useEffect(() => {
    handleCloseRef.current = handleClose;
  });

  // ── <audio> 事件 ──────────────────────────────────────────────────────────────────
  function handleLoadedMetadata() {
    const audio = audioRef.current;
    if (!audio) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDurationState(audio.duration);
    }
    audio.playbackRate = rate;
    // 套續聽位置。
    if (ttsAudioIdRef.current) {
      const saved = loadProgress(ttsAudioIdRef.current);
      if (shouldResume(saved, audio.duration) && saved != null) {
        audio.currentTime = saved;
        setCurrentTime(saved);
      }
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    // 節流寫入續聽位置。
    const now = Date.now();
    if (now - lastSaveRef.current >= TTS_PROGRESS_SAVE_THROTTLE_MS && ttsAudioIdRef.current) {
      lastSaveRef.current = now;
      saveProgress(ttsAudioIdRef.current, audio.currentTime);
    }
  }

  function handlePlayEvent() {
    dispatchPhase('play');
  }

  function handlePauseEvent() {
    // ended 也會先觸發 pause；ended handler 另行清續聽位置。
    // nextPhase(playing, pause) → paused；其餘階段收到 pause 不轉移（與舊 prev==='playing' 判斷等價）。
    dispatchPhase('pause');
    const audio = audioRef.current;
    if (audio && ttsAudioIdRef.current) saveProgress(ttsAudioIdRef.current, audio.currentTime);
  }

  function handleEnded() {
    dispatchPhase('ended');
    if (ttsAudioIdRef.current) clearProgress(ttsAudioIdRef.current);
  }

  function handleAudioError() {
    // src 為空時的偽 error 不理會。
    if (!audioSrc) return;
    dispatchPhase('loadError');
    setErrorText('音檔載入失敗（可能是跨源憑證或 Range 未放行）');
  }

  const progressText = `${formatDuration(currentTime)} / ${formatDuration(durationState)}`;

  return (
    <div className="tts-player" role="region" aria-label="筆記朗讀播放器">
      {/* 單一 <audio>：整個生命週期只有一顆，換源不重建（iOS 續播特性）。 */}
      <audio
        ref={audioRef}
        src={audioSrc || undefined}
        preload="metadata"
        crossOrigin="use-credentials"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlayEvent}
        onPause={handlePauseEvent}
        onEnded={handleEnded}
        onError={handleAudioError}
      />

      {/* 章節彈出面板（在控制列上方）。 */}
      {showChapters && canControl && (
        <div className="tts-player__chapters">
          <TtsChapterList
            chapters={chapters}
            currentIndex={currentIndex}
            onSeek={handleChapterSeek}
          />
        </div>
      )}

      <div className="tts-player__inner">
        <div className="tts-player__top">
          <span className="tts-player__title" title={noteTitle}>
            {isDialogue ? '🎙️' : '🎧'} {isDialogue ? '雙人 Podcast・' : ''}{noteTitle}
          </span>
          <button
            ref={closeBtnRef}
            type="button"
            className="tts-player__icon-btn"
            onClick={handleClose}
            aria-label="關閉播放器"
            title="關閉播放器"
          >
            ✕
          </button>
        </div>

        {/* 準備中／合成中 */}
        {isBusy && (
          <div className="tts-player__status" role="status" aria-live="polite">
            <span className="tts-player__spinner" aria-hidden="true" />
            <span>
              {segmentsTotal
                ? `AI 合成中… ${segmentsDone ?? 0}/${segmentsTotal} 段`
                : isDialogue
                  ? 'AI 正在生成雙人對談…'
                  : 'AI 正在準備語音…'}
            </span>
          </div>
        )}

        {/* 失敗 */}
        {phase === 'failed' && (
          <div className="tts-player__error" role="alert">
            <span>{errorText ?? '發生錯誤'}</span>
            <button type="button" className="tts-player__retry" onClick={handleRetry}>
              重試
            </button>
          </div>
        )}

        {/* 就緒／播放控制 */}
        {canControl && (
          <div className="tts-player__controls">
            <button
              type="button"
              className="tts-player__play"
              onClick={handlePlayPause}
              aria-label={isPlaying ? '暫停' : '播放'}
              title={isPlaying ? '暫停' : '播放'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button
              type="button"
              className="tts-player__icon-btn"
              onClick={() => skipBy(-TTS_SEEK_STEP_SECONDS)}
              aria-label="倒轉 15 秒"
              title="倒轉 15 秒"
            >
              ⏪15
            </button>
            <button
              type="button"
              className="tts-player__icon-btn"
              onClick={() => skipBy(TTS_SEEK_STEP_SECONDS)}
              aria-label="快轉 15 秒"
              title="快轉 15 秒"
            >
              15⏩
            </button>

            <div className="tts-player__scrub">
              <input
                type="range"
                className="tts-player__range"
                min={0}
                max={durationState > 0 ? durationState : 0}
                step={0.1}
                value={Math.min(currentTime, durationState || currentTime)}
                disabled={durationState <= 0}
                onChange={(e) => handleScrub(Number(e.target.value))}
                aria-label="播放進度"
              />
              <span className="tts-player__time" aria-hidden="true">
                {progressText}
              </span>
            </div>

            <label className="tts-player__rate">
              <span className="tts-player__rate-label">語速</span>
              <select
                value={rate}
                onChange={(e) => handleRateChange(Number(e.target.value))}
                aria-label="播放語速"
              >
                {TTS_RATE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </label>

            {chapters.length > 0 && (
              <button
                type="button"
                className={`tts-player__icon-btn${showChapters ? ' is-active' : ''}`}
                onClick={() => setShowChapters((v) => !v)}
                aria-expanded={showChapters}
                aria-label="章節列表"
                title="章節列表"
              >
                ☰ 章節
              </button>
            )}
          </div>
        )}

        {/* 聲音選擇（就緒後才顯示，避免合成中干擾）。 */}
        {canControl && (
          <div className="tts-player__voice-row">
            <TtsVoicePicker
              voices={voicesQuery.data ?? []}
              isLoading={voicesQuery.isLoading}
              currentVoice={effectiveVoice}
              onChangeVoice={handleVoiceChange}
              disabled={isBusy}
            />
          </div>
        )}
      </div>

      <style jsx>{`
        .tts-player {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 60;
          background: var(--bg-elevated);
          border-top: 1px solid var(--border-default);
          /* --shadow-lg 四主題皆有定義；不留 rgb 字面 fallback（監工零硬編色票要求）。 */
          box-shadow: var(--shadow-lg);
          color: var(--text-primary);
        }

        .tts-player__chapters {
          max-width: var(--max-content-width, 900px);
          margin: 0 auto;
          padding: var(--spacing-2) var(--spacing-4);
          border-bottom: 1px solid var(--border-default);
        }

        .tts-player__inner {
          max-width: var(--max-content-width, 900px);
          margin: 0 auto;
          padding: var(--spacing-2) var(--spacing-4);
          display: flex;
          flex-direction: column;
          gap: var(--spacing-2);
        }

        .tts-player__top {
          display: flex;
          align-items: center;
          gap: var(--spacing-2);
        }

        .tts-player__title {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: var(--text-sm);
          font-weight: 600;
        }

        .tts-player__status {
          display: flex;
          align-items: center;
          gap: var(--spacing-2);
          min-height: 44px;
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .tts-player__spinner {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 2px solid var(--border-strong);
          border-top-color: var(--action-secondary-fg);
          animation: tts-spin 0.7s linear infinite;
        }

        .tts-player__error {
          display: flex;
          align-items: center;
          gap: var(--spacing-3);
          min-height: 44px;
          padding: var(--spacing-2) var(--spacing-3);
          background: var(--status-danger-bg);
          color: var(--status-danger-fg);
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
        }

        /* 外框式重試鈕：文字＝status-danger-fg 落在錯誤框的 status-danger-bg 上（此配對四主題已驗 ≥4.5），
           避免「白字配亮紅底」在暗/亮主題掉到 AA 以下。 */
        .tts-player__retry {
          margin-left: auto;
          min-height: 40px;
          padding: var(--spacing-1) var(--spacing-4);
          background: transparent;
          color: var(--status-danger-fg);
          border: 1px solid var(--status-danger-fg);
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .tts-player__retry:hover {
          background: var(--bg-elevated);
        }

        /* 按壓態（四態之 active）：重試鈕按下回饋。 */
        .tts-player__retry:active {
          background: var(--bg-elevated);
          transform: translateY(1px);
        }

        .tts-player__retry:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: 2px;
        }

        .tts-player__controls {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: var(--spacing-2);
        }

        .tts-player__play {
          flex-shrink: 0;
          width: 48px;
          height: 48px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: var(--text-lg);
          /* 用四主題已驗證對比的主行動色（深底＋白字），不用 secondary-fg（暗主題會變淺藍配白字失敗）。 */
          background: var(--action-primary-bg);
          color: var(--action-primary-fg);
          border: none;
          border-radius: 50%;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .tts-player__play:hover {
          background: var(--action-primary-hover);
        }

        /* 按壓態（四態之 active）：沿用 repo 慣例 translateY(1px)＋略深底，提供按下回饋。 */
        .tts-player__play:active {
          background: var(--action-primary-hover);
          transform: translateY(1px);
        }

        .tts-player__play:focus-visible,
        .tts-player__icon-btn:focus-visible,
        .tts-player__retry:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: 2px;
        }

        .tts-player__icon-btn {
          flex-shrink: 0;
          min-width: 44px;
          min-height: 44px;
          padding: 0 var(--spacing-2);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          color: var(--text-secondary);
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .tts-player__icon-btn:hover {
          background: var(--bg-surface-secondary);
          color: var(--text-primary);
        }

        /* 按壓態（四態之 active）：±15／章節／關閉等圖示鈕按下回饋。 */
        .tts-player__icon-btn:active {
          background: var(--bg-surface-secondary);
          color: var(--text-primary);
          transform: translateY(1px);
        }

        .tts-player__icon-btn.is-active {
          color: var(--action-secondary-fg);
          border-color: var(--action-secondary-fg);
        }

        .tts-player__scrub {
          flex: 1;
          min-width: 160px;
          display: flex;
          align-items: center;
          gap: var(--spacing-2);
        }

        .tts-player__range {
          flex: 1;
          min-width: 0;
          height: 6px;
          accent-color: var(--action-secondary-fg);
          cursor: pointer;
        }

        .tts-player__range:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .tts-player__time {
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
          font-size: var(--text-xs);
          color: var(--text-secondary);
          white-space: nowrap;
        }

        .tts-player__rate {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          gap: var(--spacing-1);
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .tts-player__rate select {
          min-height: 40px;
          padding: var(--spacing-1) var(--spacing-2);
          background: var(--bg-surface);
          color: var(--text-primary);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          cursor: pointer;
        }

        .tts-player__rate select:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: 1px;
        }

        .tts-player__voice-row {
          display: flex;
        }

        .tts-player__voice-row > :global(.tts-voice) {
          flex: 1;
          max-width: 420px;
        }

        @keyframes tts-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 768px) {
          .tts-player__inner {
            padding: var(--spacing-2) var(--spacing-3);
          }

          .tts-player__scrub {
            order: 5;
            flex-basis: 100%;
            min-width: 0;
          }

          .tts-player__voice-row > :global(.tts-voice) {
            max-width: none;
          }
        }
      `}</style>
    </div>
  );
}
