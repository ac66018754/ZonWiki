"use client";

import { useState } from "react";
import type { CurrentUser, ExpenseCategory } from "@/lib/api";
import { createExpense, createExpenseCategory } from "@/lib/api";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { DateTimePicker } from "@/components/DateTimePicker";
import { showToast } from "@/lib/toast";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { splitItems } from "../expenseUtils";

/**
 * 手動新增消費表單。
 *
 * 欄位：金額（必填）、分類（下拉＋就地新增）、商家、品項（逗號分隔）、時間（UTC 進出）。
 * 分類端點未就緒時的優雅降級：就地新增失敗以 toast 提示、不 crash；分類可留空（未分類）
 * 仍能建立消費，故整個表單不會被卡住（審查 LOW「分類端點不在設計書」）。
 */
export interface ManualExpenseFormProps {
  /** 目前登入者（取時區供時間選擇器）。 */
  user: CurrentUser | null;
  /** 目前的消費分類清單。 */
  categories: ExpenseCategory[];
  /** 建立成功後通知父層重抓清單與統計。 */
  onCreated: () => void;
  /** 分類異動後通知父層重抓分類清單。 */
  onCategoriesChanged: () => void;
}

/**
 * 手動新增消費表單元件。
 * @param props user、categories 與異動回呼。
 */
export function ManualExpenseForm({
  user,
  categories,
  onCreated,
  onCategoriesChanged,
}: ManualExpenseFormProps) {
  const timeZone = user?.timeZone || DEFAULT_TIMEZONE;

  const [amountText, setAmountText] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string>("");
  const [merchant, setMerchant] = useState("");
  const [itemsText, setItemsText] = useState("");
  const [occurredDateTime, setOccurredDateTime] = useState<string | null>(
    new Date().toISOString()
  );
  const [submitting, setSubmitting] = useState(false);

  // 就地新增分類的狀態。
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);

  /** 重置表單至初始狀態（時間預設為現在）。 */
  const resetForm = () => {
    setAmountText("");
    setAmountError(null);
    setCategoryId("");
    setMerchant("");
    setItemsText("");
    setOccurredDateTime(new Date().toISOString());
  };

  /** 送出手動新增。 */
  const handleSubmit = async () => {
    const amount = Number(amountText);
    if (!amountText.trim() || Number.isNaN(amount) || amount <= 0) {
      setAmountError("請輸入大於 0 的金額");
      return;
    }
    setAmountError(null);
    setSubmitting(true);
    try {
      const created = await createExpense({
        amount,
        categoryId: categoryId || null,
        merchant: merchant.trim() || null,
        items: splitItems(itemsText),
        occurredDateTime: occurredDateTime ?? new Date().toISOString(),
        currency: "TWD",
        needsConfirmation: false,
      });
      if (!created) {
        showToast("新增失敗，請稍後重試", { type: "error" });
        return;
      }
      showToast("已新增消費", { type: "success" });
      resetForm();
      onCreated();
    } finally {
      setSubmitting(false);
    }
  };

  /** 就地新增分類後自動選取。 */
  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name || savingCategory) return;
    setSavingCategory(true);
    try {
      const created = await createExpenseCategory({ name });
      if (!created) {
        // 端點未就緒／失敗：優雅降級，不 crash；使用者仍可留空分類建立消費。
        showToast("無法新增分類（分類功能尚未就緒）", { type: "error" });
        return;
      }
      showToast("已新增分類", { type: "success" });
      setNewCategoryName("");
      setAddingCategory(false);
      setCategoryId(created.id);
      onCategoriesChanged();
    } finally {
      setSavingCategory(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "var(--text-sm)",
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: "var(--spacing-1)",
  };

  return (
    <section
      aria-label="手動新增消費"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--spacing-4)",
      }}
    >
      <h2
        style={{
          margin: "0 0 var(--spacing-3)",
          fontSize: "var(--text-base)",
          fontWeight: 700,
          color: "var(--text-primary)",
        }}
      >
        手動新增
      </h2>
      <div style={{ display: "grid", gap: "var(--spacing-3)" }}>
        {/* 金額 */}
        <div>
          <label htmlFor="expense-amount" style={labelStyle}>
            金額 <span style={{ color: "var(--status-danger-fg)" }}>*</span>
          </label>
          <Input
            id="expense-amount"
            type="number"
            inputMode="decimal"
            min={0}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="300"
            isError={!!amountError}
            errorMessage={amountError ?? undefined}
            aria-label="金額"
          />
        </div>

        {/* 分類（下拉＋就地新增） */}
        <div>
          <label htmlFor="expense-category" style={labelStyle}>
            分類
          </label>
          <div style={{ display: "flex", gap: "var(--spacing-2)", alignItems: "center" }}>
            <select
              id="expense-category"
              className="input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              style={{ flex: 1 }}
              aria-label="分類"
            >
              <option value="">
                {categories.length === 0 ? "（尚無分類，可留空）" : "未分類"}
              </option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.icon ? `${cat.icon} ${cat.name}` : cat.name}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAddingCategory((v) => !v)}
              aria-expanded={addingCategory}
            >
              ＋ 新增分類
            </Button>
          </div>
          {addingCategory && (
            <div
              style={{
                display: "flex",
                gap: "var(--spacing-2)",
                alignItems: "center",
                marginTop: "var(--spacing-2)",
              }}
            >
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="新分類名稱"
                aria-label="新分類名稱"
                style={{ flex: 1 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAddCategory();
                  }
                }}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleAddCategory}
                isLoading={savingCategory}
                disabled={!newCategoryName.trim()}
              >
                建立
              </Button>
            </div>
          )}
        </div>

        {/* 商家 */}
        <div>
          <label htmlFor="expense-merchant" style={labelStyle}>
            商家
          </label>
          <Input
            id="expense-merchant"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="統一超商"
            aria-label="商家"
          />
        </div>

        {/* 品項 */}
        <div>
          <label htmlFor="expense-items" style={labelStyle}>
            品項（以逗號分隔）
          </label>
          <Input
            id="expense-items"
            value={itemsText}
            onChange={(e) => setItemsText(e.target.value)}
            placeholder="書, 茶葉蛋"
            aria-label="品項"
          />
        </div>

        {/* 時間 */}
        <div>
          <label style={labelStyle}>時間</label>
          <DateTimePicker
            value={occurredDateTime}
            onChange={setOccurredDateTime}
            tz={timeZone}
            ariaLabel="消費時間"
          />
        </div>

        <div>
          <Button variant="primary" onClick={handleSubmit} isLoading={submitting}>
            新增消費
          </Button>
        </div>
      </div>
    </section>
  );
}
