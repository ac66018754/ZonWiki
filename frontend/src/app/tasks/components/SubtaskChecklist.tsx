"use client";

import { useRef, useState } from "react";
import { SubTask } from "@/lib/api";

/** 暫存（尚未存到後端）的子任務 id 前綴。存檔時這些會被真正建立。 */
const TEMP_PREFIX = "tmp-";
/** 是否為「尚未存檔」的暫存子任務 id。 */
export const isTempSubtaskId = (id: string) => id.startsWith(TEMP_PREFIX);

/**
 * 子任務檢核清單（**受控、暫存式**）：
 * 所有操作（新增 / 打勾 / 改名 / 解除關係 / 拖曳排序）都只改本地清單並透過 onChange 往上拋，
 * **不直接呼叫 API**——要等父任務彈窗按「儲存」才真正寫入後端；若沒儲存就關閉，全部還原。
 *
 * 新增的子任務先給 `tmp-` 暫存 id（存檔時才建立、取得真正 id）；暫存子任務尚不可「開啟 / 關聯」。
 */
export function SubtaskChecklist({
  items,
  onChange,
  onOpenSubtask,
  onLinkSubtask,
}: {
  /** 目前（暫存中）的子任務清單 */
  items: SubTask[];
  /** 清單變動時往上拋（父層負責標記 dirty、存檔時 diff 寫入） */
  onChange: (next: SubTask[]) => void;
  /** 點「↗」開啟該子任務（僅已存檔的子任務可用） */
  onOpenSubtask?: (subtaskId: string) => void;
  /** 點「🔗」管理該子任務的關聯（僅已存檔的子任務可用） */
  onLinkSubtask?: (subtaskId: string, title: string, e: React.MouseEvent) => void;
}) {
  const [newTitle, setNewTitle] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropInfo, setDropInfo] = useState<{ id: string; pos: "before" | "after" } | null>(null);
  const tempCounter = useRef(0);

  const total = items.length;
  const done = items.filter((i) => i.isDone).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const handleAdd = () => {
    const title = newTitle.trim();
    if (!title) return;
    const id = `${TEMP_PREFIX}${++tempCounter.current}`;
    const newItem: SubTask = { id, taskCardId: "", title, isDone: false, sortOrder: items.length };
    onChange([...items, newItem]);
    setNewTitle("");
  };

  const handleToggle = (s: SubTask) =>
    onChange(items.map((i) => (i.id === s.id ? { ...i, isDone: !i.isDone } : i)));

  const handleRename = (s: SubTask, title: string) =>
    onChange(items.map((i) => (i.id === s.id ? { ...i, title } : i)));

  /**
   * 從清單移除：暫存（未存檔）子任務直接拿掉；已存在的子任務則是「解除父子關係」
   * （存檔後變回獨立頂層任務、不刪除）——先跳確認，避免誤觸。
   */
  const handleRemove = (s: SubTask) => {
    if (!isTempSubtaskId(s.id)) {
      const ok = window.confirm(
        `要移除與子任務「${s.title}」的父子關係嗎？\n` +
          `（此任務會變成獨立的頂層任務、不會被刪除；按父任務的「儲存」後才生效。）`
      );
      if (!ok) return;
    }
    onChange(items.filter((i) => i.id !== s.id));
  };

  const handleReorder = (sourceId: string, targetId: string, pos: "before" | "after") => {
    if (sourceId === targetId) return;
    const ids = items.map((i) => i.id).filter((id) => id !== sourceId);
    let at = ids.indexOf(targetId);
    if (at < 0) return;
    if (pos === "after") at += 1;
    ids.splice(at, 0, sourceId);
    const reordered = ids
      .map((id) => items.find((i) => i.id === id))
      .filter((x): x is SubTask => Boolean(x));
    onChange(reordered);
  };

  return (
    <div className="tk-subs">
      {/* 進度條 */}
      <div className="tk-subs-head">
        <span className="tk-subs-label">子任務</span>
        {total > 0 && (
          <span className="tk-subs-count">
            {done}/{total}（{pct}%）
          </span>
        )}
      </div>
      {total > 0 && (
        <div className="tk-progress" aria-label={`完成 ${pct}%`}>
          <div className="tk-progress-bar" style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* 子任務列 */}
      <div className="tk-subs-list">
        {items.map((s) => {
          const temp = isTempSubtaskId(s.id);
          return (
            <div
              key={s.id}
              className={[
                "tk-sub-row",
                dropInfo?.id === s.id ? `tk-sub-row--drop-${dropInfo.pos}` : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable
              onDragStart={(e) => {
                setDragId(s.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropInfo(null);
              }}
              onDragOver={
                dragId && dragId !== s.id
                  ? (e) => {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setDropInfo({
                        id: s.id,
                        pos: e.clientY - rect.top < rect.height / 2 ? "before" : "after",
                      });
                    }
                  : undefined
              }
              onDrop={
                dragId && dragId !== s.id
                  ? (e) => {
                      e.preventDefault();
                      const pos = dropInfo?.id === s.id ? dropInfo.pos : "after";
                      const src = dragId;
                      setDragId(null);
                      setDropInfo(null);
                      handleReorder(src, s.id, pos);
                    }
                  : undefined
              }
            >
              <span className="tk-sub-handle" title="拖曳調整順序">⠿</span>
              <input
                type="checkbox"
                checked={s.isDone}
                onChange={() => handleToggle(s)}
                className="tk-sub-check"
                aria-label={s.isDone ? "標為未完成" : "標為完成"}
              />
              <input
                className={`tk-sub-title ${s.isDone ? "tk-sub-title--done" : ""}`}
                value={s.title}
                onChange={(e) => handleRename(s, e.target.value)}
                placeholder={temp ? "新子任務（存檔後建立）" : ""}
              />
              {/* 🔗 / ↗ 僅對「已存檔」子任務有效（暫存子任務還沒有真實 id） */}
              {onLinkSubtask && !temp && (
                <button
                  className="tk-sub-del"
                  onClick={(e) => onLinkSubtask(s.id, s.title, e)}
                  title="管理此子任務的關聯"
                  aria-label="管理此子任務的關聯"
                >
                  🔗
                </button>
              )}
              {onOpenSubtask && !temp && (
                <button
                  className="tk-sub-del"
                  onClick={() => onOpenSubtask(s.id)}
                  title="開啟此子任務（完整任務）"
                  aria-label="開啟此子任務"
                >
                  ↗
                </button>
              )}
              <button
                className="tk-sub-del"
                onClick={() => handleRemove(s)}
                title={temp ? "移除此（尚未建立的）子任務" : "移除父子關係（不會刪除此任務；存檔後生效）"}
                aria-label="移除父子關係"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* 新增列 */}
      <div className="tk-sub-add">
        <span className="tk-sub-add-icon">＋</span>
        <input
          className="tk-sub-add-input"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder="新增子任務，按 Enter"
        />
        {newTitle.trim() && (
          <button className="tk-sub-add-btn" onClick={handleAdd}>
            新增
          </button>
        )}
      </div>
    </div>
  );
}
