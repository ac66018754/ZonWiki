// @vitest-environment jsdom
/**
 * revealAnchor / openAncestorDetails 單元測試（問題清單「循著階層展開」修復）。
 *
 * 背景：問題（便利貼/文字框）的文字錨點位於收合的 :::toggle（<details class="md-toggle">）內時，
 * 該浮層項目整個不會被渲染（NoteOverlay 以 collapsedByToggle 過濾），點問題清單定位會靜默失敗。
 * 修法＝定位前先把錨定文字的收合祖先 <details> 循著階層展開（比照目錄 TocPanel.scrollToHeading）。
 *
 * 測試環境注意：jsdom 沒有版面量測（getClientRects 恆空、getBoundingClientRect 全 0），
 * 因此受測函式必須是「純 DOM 判定」——嚴禁在 revealAnchor 內呼叫 locateAnchor 之類
 * 依賴幾何的函式（jsdom 下會假紅；瀏覽器下也沒必要）。
 */
import { describe, expect, it } from 'vitest';
import { openAncestorDetails, revealAnchor, type OverlayAnchor } from './overlayAnchor';

/** 建一個掛在 document.body 上的內文容器（每個測試各自獨立，不互相汙染）。 */
function makeContainer(html: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'markdown-prose';
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

/** 產生最小可用的持久化錨點（ex/ey 與 start 僅為提示值，reAnchor 會自行重定位）。 */
function anchorOf(text: string): OverlayAnchor {
  return { text, start: 0, prefix: '', suffix: '', ex: 0, ey: 0 };
}

/** 取容器內所有 details 的開合狀態快照（依文件順序），供「DOM 不變」斷言用。 */
function detailsStates(container: HTMLElement): boolean[] {
  return Array.from(container.querySelectorAll('details')).map((d) => d.open);
}

// 與後端 ToggleContainerExtension 產物一致的雙層收合 toggle 測資：
// 外層（md-toggle）→ 內層（md-toggle）→ 內層段落含錨定文字；另附一個「旁支」收合 toggle。
const NESTED_CLOSED_HTML = `
  <p>前導段落。</p>
  <details class="md-toggle">
    <summary class="md-toggle-summary">外層章節</summary>
    <p>外層內容開頭。</p>
    <details class="md-toggle">
      <summary class="md-toggle-summary">內層章節</summary>
      <p id="target-p">這裡是內層獨特錨定文字GOAL-7391。</p>
    </details>
  </details>
  <details class="md-toggle" id="sibling-details">
    <summary class="md-toggle-summary">旁支章節</summary>
    <p>旁支內容，不該被展開。</p>
  </details>
`;

describe('openAncestorDetails', () => {
  it('元素位於兩層收合 details 內 → 兩層都展開、回傳 true；旁支收合 details 不動', () => {
    // Arrange
    const container = makeContainer(NESTED_CLOSED_HTML);
    const target = container.querySelector('#target-p')!;

    // Act
    const opened = openAncestorDetails(container, target);

    // Assert
    expect(opened).toBe(true);
    const all = Array.from(container.querySelectorAll('details'));
    expect(all[0].open).toBe(true); // 外層
    expect(all[1].open).toBe(true); // 內層
    expect(container.querySelector<HTMLDetailsElement>('#sibling-details')!.open).toBe(false);
  });

  it('無收合祖先 → 回傳 false、所有 details 狀態不變', () => {
    // Arrange
    const container = makeContainer(NESTED_CLOSED_HTML);
    const before = detailsStates(container);
    const visibleP = container.querySelector('p')!; // 前導段落（不在任何 details 內）

    // Act
    const opened = openAncestorDetails(container, visibleP);

    // Assert
    expect(opened).toBe(false);
    expect(detailsStates(container)).toEqual(before);
  });

  it('el 為 null 或不在 container 內 → 回傳 false、不動任何 details（含 container 之外的祖先）', () => {
    // Arrange：container 自己被包在一個「外部」收合 details 裡——reveal 必須止步於 container。
    const outer = document.createElement('details');
    document.body.appendChild(outer);
    const container = document.createElement('div');
    container.innerHTML = NESTED_CLOSED_HTML;
    outer.appendChild(container);
    const strayNode = document.createElement('p');
    document.body.appendChild(strayNode); // 在 container 之外

    // Act & Assert
    expect(openAncestorDetails(container, null)).toBe(false);
    expect(openAncestorDetails(container, strayNode)).toBe(false);
    expect(outer.open).toBe(false); // 外部 details 不受影響
  });
});

describe('revealAnchor', () => {
  it('錨點文字位於雙層收合 details 內 → 兩層展開、回傳 true；旁支不動', () => {
    // Arrange
    const container = makeContainer(NESTED_CLOSED_HTML);

    // Act
    const found = revealAnchor(container, anchorOf('內層獨特錨定文字GOAL-7391'));

    // Assert
    expect(found).toBe(true);
    const all = Array.from(container.querySelectorAll('details'));
    expect(all[0].open).toBe(true);
    expect(all[1].open).toBe(true);
    expect(container.querySelector<HTMLDetailsElement>('#sibling-details')!.open).toBe(false);
  });

  it('錨點文字本來就可見（無收合祖先）→ 回傳 true、所有 details 狀態不變', () => {
    // Arrange
    const container = makeContainer(NESTED_CLOSED_HTML);
    const before = detailsStates(container);

    // Act
    const found = revealAnchor(container, anchorOf('前導段落'));

    // Assert
    expect(found).toBe(true);
    expect(detailsStates(container)).toEqual(before);
  });

  it('錨點文字已不存在（內容被編輯掉）→ 回傳 false、所有 details 狀態不變', () => {
    // Arrange
    const container = makeContainer(NESTED_CLOSED_HTML);
    const before = detailsStates(container);

    // Act
    const found = revealAnchor(container, anchorOf('這段文字不存在於內容中XYZ-999'));

    // Assert
    expect(found).toBe(false);
    expect(detailsStates(container)).toEqual(before);
  });

  it('外層已展開、內層收合 → 只展開內層（回傳 true）', () => {
    // Arrange
    const container = makeContainer(NESTED_CLOSED_HTML);
    const all = Array.from(container.querySelectorAll('details'));
    all[0].open = true; // 外層預先展開

    // Act
    const found = revealAnchor(container, anchorOf('內層獨特錨定文字GOAL-7391'));

    // Assert
    expect(found).toBe(true);
    expect(all[0].open).toBe(true);
    expect(all[1].open).toBe(true);
  });

  it('container 之外的收合 details 祖先不動（reveal 止步於 container 邊界）', () => {
    // Arrange：container 被包在外部收合 details 裡（頁面實務不會，防禦邊界仍要測）。
    const outer = document.createElement('details');
    document.body.appendChild(outer);
    const container = document.createElement('div');
    container.innerHTML = NESTED_CLOSED_HTML;
    outer.appendChild(container);

    // Act
    const found = revealAnchor(container, anchorOf('內層獨特錨定文字GOAL-7391'));

    // Assert
    expect(found).toBe(true);
    const all = Array.from(container.querySelectorAll('details'));
    expect(all[0].open).toBe(true);
    expect(all[1].open).toBe(true);
    expect(outer.open).toBe(false); // container 之外不動
  });

  it('錨點文字橫跨多個行內元素（多個文字節點）也能定位並展開', () => {
    // Arrange：錨定文字被 <strong> 切成多個文字節點——rangeFromOffsets 需跨節點映射。
    const container = makeContainer(`
      <details class="md-toggle">
        <summary class="md-toggle-summary">章節</summary>
        <p>前段<strong>粗體錨定</strong>後段文字。</p>
      </details>
    `);

    // Act
    const found = revealAnchor(container, anchorOf('前段粗體錨定後段'));

    // Assert
    expect(found).toBe(true);
    expect(container.querySelector('details')!.open).toBe(true);
  });
});
