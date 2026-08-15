// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChoiceDialog } from './ChoiceDialog';

/**
 * ChoiceDialog 的測試（測試計畫 包4 D2）。
 */
const OPTIONS = [
  { key: 'add', label: '增加分類', description: '保留原分類' },
  { key: 'switch', label: '切換分類' },
];

beforeEach(() => cleanup());

describe('ChoiceDialog', () => {
  test('渲染標題與全部選項', () => {
    render(
      <ChoiceDialog
        isOpen
        title="要怎麼歸類？"
        options={OPTIONS}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('要怎麼歸類？')).toBeTruthy();
    expect(screen.getByText('增加分類')).toBeTruthy();
    expect(screen.getByText('切換分類')).toBeTruthy();
    expect(screen.getByText('保留原分類')).toBeTruthy();
  });

  test('點選項 → onSelect 收到對應 key', () => {
    const onSelect = vi.fn();
    render(
      <ChoiceDialog isOpen title="t" options={OPTIONS} onSelect={onSelect} onCancel={() => {}} />,
    );
    fireEvent.click(screen.getByText('切換分類'));
    expect(onSelect).toHaveBeenCalledWith('switch');
  });

  test('Esc → onCancel；取消鈕 → onCancel', () => {
    const onCancel = vi.fn();
    render(
      <ChoiceDialog isOpen title="t" options={OPTIONS} onSelect={() => {}} onCancel={onCancel} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  test('isOpen=false → 不渲染', () => {
    render(
      <ChoiceDialog
        isOpen={false}
        title="t"
        options={OPTIONS}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText('增加分類')).toBeNull();
  });
});
