/**
 * Web Speech API（語音辨識）型別宣告。
 *
 * 為什麼在此重新宣告而非沿用 app/page.tsx：首頁 page.tsx 內部宣告的
 * `SpeechRecognitionEvent`／`WindowWithSpeechRecognition` **未 export**，且 page.tsx 不在本工作包的
 * 修改清單內；直接 import 會編譯失敗、或被迫越界改 page.tsx（審查 MEDIUM #3）。
 * 故在此獨立、可重用地重新宣告這些型別（瀏覽器 `webkitSpeechRecognition` 標準型別，TS lib 未內建）。
 */

/**
 * 語音辨識單一候選結果。
 */
export interface SpeechRecognitionAlternative {
  /** 辨識出的文字。 */
  transcript: string;
  /** 信心值（0–1）。 */
  confidence: number;
}

/**
 * 語音辨識單一結果（可含多個候選）。
 */
export interface SpeechRecognitionResult {
  /** 候選數量。 */
  length: number;
  /** 以索引取候選。 */
  [index: number]: SpeechRecognitionAlternative;
  /** 是否為最終結果（非中途暫定）。 */
  isFinal: boolean;
}

/**
 * 語音辨識結果清單。
 */
export interface SpeechRecognitionResultList {
  /** 結果數量。 */
  length: number;
  /** 以索引取結果。 */
  [index: number]: SpeechRecognitionResult;
}

/**
 * 語音辨識「有結果」事件。
 */
export interface SpeechRecognitionEvent extends Event {
  /** 結果清單。 */
  results: SpeechRecognitionResultList;
  /** 本次事件的起始結果索引。 */
  resultIndex: number;
}

/**
 * 語音辨識錯誤事件。
 */
export interface SpeechRecognitionErrorEvent extends Event {
  /** 錯誤代碼（如 "no-speech"、"not-allowed"）。 */
  error: string;
}

/**
 * 語音辨識實例（webkitSpeechRecognition／SpeechRecognition）。
 */
export interface SpeechRecognitionInstance {
  /** 辨識語言（BCP-47，如 "zh-Hant-TW"）。 */
  lang: string;
  /** 是否連續辨識。 */
  continuous: boolean;
  /** 是否回傳中途暫定結果。 */
  interimResults: boolean;
  /** 開始事件。 */
  onstart: (() => void) | null;
  /** 有結果事件。 */
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  /** 錯誤事件。 */
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  /** 結束事件。 */
  onend: (() => void) | null;
  /** 開始辨識。 */
  start: () => void;
  /** 停止辨識。 */
  stop: () => void;
}

/**
 * 帶有語音辨識建構子的 Window（供特徵偵測）。
 */
export interface WindowWithSpeechRecognition extends Window {
  /** WebKit 前綴版建構子（Chrome/Safari）。 */
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  /** 標準建構子（少數瀏覽器）。 */
  SpeechRecognition?: new () => SpeechRecognitionInstance;
}
