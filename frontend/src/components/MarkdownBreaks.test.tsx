// @vitest-environment jsdom
/**
 * 「單一換行＝硬換行」前端接線測試 —
 * 對應 docs/design/測試計畫-Enter硬換行與表格br視圖層.md B5 組。
 *
 * 鎖定三個 ReactMarkdown 渲染點都掛上 remark-breaks（與後端
 * UseSoftlineBreakAsHardlineBreak 對齊），日後有人動 remarkPlugins 陣列會被抓到：
 * - MarkdownPreview（ToggleAwareMarkdown）：編輯預覽／彈出預覽／答題彈窗
 * - overlay/StickyBody：便利貼預覽
 * - canvas/kaiwen-components/NodeContent：畫布節點
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToggleAwareMarkdown } from './MarkdownPreview';
import { StickyBody } from './overlay/StickyBody';
import { NodeContent } from '@/app/canvas/kaiwen-components/NodeContent';
import type { OverlayItemView } from './overlay/overlayShared';

afterEach(() => {
  cleanup();
});

describe('B5 MarkdownPreview（ToggleAwareMarkdown）', () => {
  it('B5-1: 單一換行渲染成 <br>', () => {
    const { container } = render(<ToggleAwareMarkdown value={'第一行\n第二行'} />);
    expect(container.querySelectorAll('br').length).toBe(1);
    expect(container.querySelectorAll('p').length).toBe(1);
  });

  it('B5-2: 空行仍分段（兩個 <p>、無 <br>）', () => {
    const { container } = render(<ToggleAwareMarkdown value={'段一\n\n段二'} />);
    expect(container.querySelectorAll('p').length).toBe(2);
    expect(container.querySelectorAll('br').length).toBe(0);
  });

  it('B5-3: 圍欄程式碼內換行不產生 <br>', () => {
    const { container } = render(<ToggleAwareMarkdown value={'```\nline1\nline2\n```'} />);
    expect(container.querySelectorAll('br').length).toBe(0);
    expect(container.textContent).toContain('line1');
  });

  it('B5-6: 混合輸入 a\\nb<br>c → 兩個換行（remark-breaks 與 remarkHtmlLineBreak 並存）', () => {
    const { container } = render(<ToggleAwareMarkdown value={'a\nb<br>c'} />);
    expect(container.querySelectorAll('br').length).toBe(2);
  });
});

describe('B5-4 StickyBody 便利貼預覽', () => {
  it('預覽模式渲染單一換行成 <br>', () => {
    const item = { text: '第一行\n第二行', dataJson: null, color: '#FFF9C4' } as unknown as OverlayItemView;
    render(
      <StickyBody
        item={item}
        onText={vi.fn()}
        onTextCommit={vi.fn()}
        onColor={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('sticky-preview-toggle'));
    const md = screen.getByTestId('sticky-markdown');
    expect(md.querySelectorAll('br').length).toBe(1);
  });
});

describe('B5-5 NodeContent 畫布節點', () => {
  it('渲染單一換行成 <br>', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <NodeContent
        content={'第一行\n第二行'}
        highlights={[]}
        links={[]}
        editing={false}
        pending={false}
        containerRef={ref as React.RefObject<HTMLDivElement>}
        onMouseUp={vi.fn()}
        onLinkClick={vi.fn()}
        onHighlightClick={vi.fn()}
        onStartEdit={vi.fn()}
      />,
    );
    const el = screen.getByTestId('node-content');
    expect(el.querySelectorAll('br').length).toBe(1);
  });
});
