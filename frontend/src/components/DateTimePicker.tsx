"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toLocalInputValue, fromLocalInputValue, FALLBACK_TZ } from "@/app/tasks/taskUtils";

/**
 * 日期時間選擇器：
 * - 文字輸入框可直接打字（YYYY-MM-DD HH:mm，亦接受純日期），失焦/Enter 解析。
 * - 📅 按鈕開啟好看的日曆 + 時間彈窗（月切換、點日、選時、今天/清除）。
 * - 值一律以 UTC ISO 進出；顯示與編輯依使用者時區（時間鐵則）。
 */
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 解析「YYYY-MM-DDTHH:mm」牆上時間字串為各部位。 */
function parseLocal(local: string): { y: number; mo: number; d: number; hh: number; mm: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const hh = +m[4];
  const mm = +m[5];
  // 驗證有效範圍，避免 2026-13-40 25:99 這類非法輸入被 Date.UTC 無聲溢位修正。
  const daysInMonth = new Date(y, mo, 0).getDate();
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth || hh > 23 || mm > 59) return null;
  return { y, mo, d, hh, mm };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function DateTimePicker({
  value,
  onChange,
  tz = FALLBACK_TZ,
  placeholder = "YYYY-MM-DD HH:mm",
  ariaLabel,
}: {
  /** UTC ISO 字串，或 null。 */
  value: string | null;
  /** 變更時回傳 UTC ISO 或 null。 */
  onChange: (iso: string | null) => void;
  /** 使用者 IANA 時區。 */
  tz?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // 值對應的牆上時間字串（YYYY-MM-DDTHH:mm）。
  const localValue = value ? toLocalInputValue(value, tz) : "";

  // 顯示文字與值同步（外部清除/設定時更新輸入框）。
  useEffect(() => {
    setText(localValue ? localValue.replace("T", " ") : "");
  }, [localValue]);

  // 目前選取（或無值時以「現在」）的各部位，供彈窗使用。
  const parts = useMemo(() => {
    const base = localValue || toLocalInputValue(new Date().toISOString(), tz);
    return parseLocal(base)!;
  }, [localValue, tz]);

  const [viewY, setViewY] = useState(parts.y);
  const [viewMo, setViewMo] = useState(parts.mo); // 1-based
  // 僅在「開啟彈窗」時把月曆視圖對齊到選取月份；開啟後切月為純導覽、不被值變動重設。
  useEffect(() => {
    if (open) {
      setViewY(parts.y);
      setViewMo(parts.mo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 點彈窗外關閉。
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  /** 文字輸入解析提交（無效則回復原值）。 */
  const commitText = () => {
    const t = text.trim();
    if (!t) {
      onChange(null);
      return;
    }
    let norm = t.replace(" ", "T");
    if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) norm += "T00:00";
    if (!parseLocal(norm)) {
      setText(localValue ? localValue.replace("T", " ") : "");
      return;
    }
    onChange(fromLocalInputValue(norm, tz));
  };

  const setDate = (y: number, mo: number, d: number) => {
    // 已有值：沿用既有時間；尚無值：時間預設 00:00（避免帶入「現在」的時分）。
    const hh = value ? parts.hh : 0;
    const mm = value ? parts.mm : 0;
    onChange(fromLocalInputValue(`${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}`, tz));
  };
  const setTime = (timeStr: string) => {
    onChange(fromLocalInputValue(`${parts.y}-${pad(parts.mo)}-${pad(parts.d)}T${timeStr}`, tz));
  };

  // 月曆格（含前置空白）。
  const grid = useMemo(() => {
    const startDow = new Date(viewY, viewMo - 1, 1).getDay();
    const daysInMonth = new Date(viewY, viewMo, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [viewY, viewMo]);

  const prevMonth = () => {
    let m = viewMo - 1;
    let y = viewY;
    if (m < 1) {
      m = 12;
      y--;
    }
    setViewMo(m);
    setViewY(y);
  };
  const nextMonth = () => {
    let m = viewMo + 1;
    let y = viewY;
    if (m > 12) {
      m = 1;
      y++;
    }
    setViewMo(m);
    setViewY(y);
  };

  const today = parseLocal(toLocalInputValue(new Date().toISOString(), tz))!;
  const isSelected = (d: number) => !!value && parts.y === viewY && parts.mo === viewMo && parts.d === d;
  const isToday = (d: number) => today.y === viewY && today.mo === viewMo && today.d === d;

  return (
    <div className="dtp-root" ref={rootRef}>
      <div className="dtp-control">
        <input
          className="dtp-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
        />
        {text && (
          <button
            type="button"
            className="dtp-icon"
            title="清除"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(null)}
          >
            ✕
          </button>
        )}
        <button
          type="button"
          className="dtp-icon"
          title="開啟日曆"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
        >
          📅
        </button>
      </div>

      {open && (
        <div className="dtp-pop">
          <div className="dtp-pop-head">
            <button type="button" onClick={prevMonth} aria-label="上個月" className="dtp-nav">
              ‹
            </button>
            <span className="dtp-title">
              {viewY} 年 {viewMo} 月
            </span>
            <button type="button" onClick={nextMonth} aria-label="下個月" className="dtp-nav">
              ›
            </button>
          </div>
          <div className="dtp-grid dtp-grid--head">
            {WEEKDAYS.map((w) => (
              <span key={w} className="dtp-dow">
                {w}
              </span>
            ))}
          </div>
          <div className="dtp-grid">
            {grid.map((d, i) =>
              d === null ? (
                <span key={i} />
              ) : (
                <button
                  key={i}
                  type="button"
                  className={[
                    "dtp-day",
                    isSelected(d) ? "dtp-day--sel" : "",
                    isToday(d) ? "dtp-day--today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setDate(viewY, viewMo, d)}
                >
                  {d}
                </button>
              )
            )}
          </div>
          <div className="dtp-time">
            <span className="dtp-time-label">時間</span>
            <input
              type="time"
              className="dtp-time-input"
              value={`${pad(parts.hh)}:${pad(parts.mm)}`}
              onChange={(e) => {
                if (e.target.value) setTime(e.target.value);
              }}
            />
            <button
              type="button"
              className="dtp-mini"
              onClick={() => setDate(today.y, today.mo, today.d)}
            >
              今天
            </button>
            <button
              type="button"
              className="dtp-mini"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              清除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
