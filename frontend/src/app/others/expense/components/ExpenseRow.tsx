"use client";

import { useState } from "react";
import type { Expense, ExpenseCategory } from "@/lib/api";
import { updateExpense, deleteExpense } from "@/lib/api";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { DateTimePicker } from "@/components/DateTimePicker";
import { useConfirm } from "@/components/ConfirmProvider";
import { showToast } from "@/lib/toast";
import { formatDateTime } from "@/lib/formatters";
import { formatCurrency } from "../expenseUtils";

/**
 * 取某筆消費要顯示的分類文字（優先用後端回傳的 categoryName，否則在分類清單中查）。
 * @param expense 消費紀錄。
 * @param categories 分類清單。
 * @returns 分類顯示文字（含圖示），未分類回「未分類」。
 */
function categoryLabel(expense: Expense, categories: ExpenseCategory[]): string {
  if (expense.categoryName) return expense.categoryName;
  const found = categories.find((cat) => cat.id === expense.categoryId);
  if (found) return found.icon ? `${found.icon} ${found.name}` : found.name;
  return "未分類";
}

/**
 * 分類下拉選項（未分類＋各分類）。
 */
function CategoryOptions({ categories }: { categories: ExpenseCategory[] }) {
  return (
    <>
      <option value="">未分類</option>
      {categories.map((cat) => (
        <option key={cat.id} value={cat.id}>
          {cat.icon ? `${cat.icon} ${cat.name}` : cat.name}
        </option>
      ))}
    </>
  );
}

/**
 * 「待確認」佇列的單列：置頂、警示邊框，就地快速修正金額/分類後清除待確認標記。
 *
 * 對應設計書 §5.5：AI 把「300 塊」聽成 3000 時的一鍵修正動線。
 * 顏色非唯一載體：除警示邊框外，另有明確「待確認」文字徽章（§11 色盲友善）。
 */
export interface PendingExpenseRowProps {
  /** 待確認的消費紀錄。 */
  expense: Expense;
  /** 分類清單（供就地改分類）。 */
  categories: ExpenseCategory[];
  /** 使用者時區（顯示時間）。 */
  timeZone: string;
  /** 異動後通知父層重抓。 */
  onChanged: () => void;
}

/**
 * 待確認佇列單列元件。
 * @param props expense、categories、timeZone 與 onChanged。
 */
export function PendingExpenseRow({
  expense,
  categories,
  timeZone,
  onChanged,
}: PendingExpenseRowProps) {
  const [amountText, setAmountText] = useState(String(expense.amount));
  const [categoryId, setCategoryId] = useState(expense.categoryId ?? "");
  const [saving, setSaving] = useState(false);

  /** 確認：套用就地修正並清除待確認標記。 */
  const handleConfirm = async () => {
    const amount = Number(amountText);
    if (!amountText.trim() || Number.isNaN(amount) || amount <= 0) {
      showToast("請輸入大於 0 的金額", { type: "error" });
      return;
    }
    setSaving(true);
    try {
      const updated = await updateExpense(expense.id, {
        amount,
        categoryId: categoryId || null,
        needsConfirmation: false,
      });
      if (!updated) {
        showToast("確認失敗，請稍後重試", { type: "error" });
        return;
      }
      showToast("已確認", { type: "success" });
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        border: "1px solid var(--status-warning-fg)",
        background: "var(--status-warning-bg)",
        borderRadius: "var(--radius-md)",
        padding: "var(--spacing-3)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)" }}>
        <span
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: 700,
            color: "var(--status-warning-fg)",
          }}
        >
          ⚠️ 待確認
        </span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
          {formatDateTime(expense.occurredDateTime, timeZone)}
        </span>
      </div>
      {expense.rawText && (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
          原文：{expense.rawText}
        </div>
      )}
      <div style={{ display: "flex", gap: "var(--spacing-2)", flexWrap: "wrap", alignItems: "center" }}>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          aria-label="修正金額"
          style={{ width: "120px" }}
        />
        <select
          className="input"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="修正分類"
          style={{ width: "auto", flex: "1 1 140px" }}
        >
          <CategoryOptions categories={categories} />
        </select>
        <Button variant="primary" size="sm" onClick={handleConfirm} isLoading={saving}>
          確認
        </Button>
      </div>
    </div>
  );
}

/**
 * 一般消費清單單列：顯示金額/分類/商家/時間；可就地編輯或軟刪除。
 */
export interface ExpenseRowProps {
  /** 消費紀錄。 */
  expense: Expense;
  /** 分類清單（供編輯改分類）。 */
  categories: ExpenseCategory[];
  /** 使用者時區（顯示時間）。 */
  timeZone: string;
  /** 異動後通知父層重抓。 */
  onChanged: () => void;
}

/**
 * 一般消費清單單列元件。
 * @param props expense、categories、timeZone 與 onChanged。
 */
export function ExpenseRow({ expense, categories, timeZone, onChanged }: ExpenseRowProps) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [amountText, setAmountText] = useState(String(expense.amount));
  const [categoryId, setCategoryId] = useState(expense.categoryId ?? "");
  const [merchant, setMerchant] = useState(expense.merchant ?? "");
  const [occurredDateTime, setOccurredDateTime] = useState<string | null>(
    expense.occurredDateTime
  );

  /** 進入編輯：以目前值填入編輯欄位。 */
  const startEdit = () => {
    setAmountText(String(expense.amount));
    setCategoryId(expense.categoryId ?? "");
    setMerchant(expense.merchant ?? "");
    setOccurredDateTime(expense.occurredDateTime);
    setEditing(true);
  };

  /** 儲存編輯。 */
  const handleSave = async () => {
    const amount = Number(amountText);
    if (!amountText.trim() || Number.isNaN(amount) || amount <= 0) {
      showToast("請輸入大於 0 的金額", { type: "error" });
      return;
    }
    setSaving(true);
    try {
      const updated = await updateExpense(expense.id, {
        amount,
        categoryId: categoryId || null,
        merchant: merchant.trim() || null,
        occurredDateTime: occurredDateTime ?? expense.occurredDateTime,
      });
      if (!updated) {
        showToast("儲存失敗，請稍後重試", { type: "error" });
        return;
      }
      showToast("已更新", { type: "success" });
      setEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  /** 刪除（軟刪除，先確認）。 */
  const handleDelete = async () => {
    const ok = await confirm({
      message: `刪除這筆消費（${formatCurrency(expense.amount, expense.currency)}）？會移至垃圾桶。`,
      danger: true,
    });
    if (!ok) return;
    const success = await deleteExpense(expense.id);
    if (!success) {
      showToast("刪除失敗，請稍後重試", { type: "error" });
      return;
    }
    showToast("已刪除", { type: "success" });
    onChanged();
  };

  if (editing) {
    return (
      <div
        style={{
          border: "1px solid var(--border-strong)",
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-md)",
          padding: "var(--spacing-3)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-2)",
        }}
      >
        <div style={{ display: "flex", gap: "var(--spacing-2)", flexWrap: "wrap", alignItems: "center" }}>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-label="金額"
            style={{ width: "120px" }}
          />
          <select
            className="input"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-label="分類"
            style={{ width: "auto", flex: "1 1 140px" }}
          >
            <CategoryOptions categories={categories} />
          </select>
        </div>
        <Input
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          placeholder="商家"
          aria-label="商家"
        />
        <DateTimePicker
          value={occurredDateTime}
          onChange={setOccurredDateTime}
          tz={timeZone}
          ariaLabel="消費時間"
        />
        <div style={{ display: "flex", gap: "var(--spacing-2)" }}>
          <Button variant="primary" size="sm" onClick={handleSave} isLoading={saving}>
            保存
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
            取消
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--border-default)",
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-md)",
        padding: "var(--spacing-3)",
        display: "flex",
        alignItems: "center",
        gap: "var(--spacing-3)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--text-base)",
            fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
          {formatCurrency(expense.amount, expense.currency)}
        </div>
        <div
          style={{
            marginTop: "var(--spacing-1)",
            display: "flex",
            gap: "var(--spacing-3)",
            flexWrap: "wrap",
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
          }}
        >
          <span>{categoryLabel(expense, categories)}</span>
          {expense.merchant && <span>{expense.merchant}</span>}
          <span>{formatDateTime(expense.occurredDateTime, timeZone)}</span>
        </div>
        {expense.items && expense.items.length > 0 && (
          <div style={{ marginTop: "var(--spacing-1)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
            {expense.items.join("、")}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: "var(--spacing-2)", flexShrink: 0 }}>
        <Button variant="secondary" size="sm" onClick={startEdit} aria-label="編輯">
          編輯
        </Button>
        <Button variant="danger" size="sm" onClick={handleDelete} aria-label="刪除">
          刪除
        </Button>
      </div>
    </div>
  );
}
