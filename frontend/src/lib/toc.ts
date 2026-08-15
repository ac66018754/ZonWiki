// Table-of-contents extraction. Runs on the client after fetching rendered
// article HTML: scans for h1/h2/h3 headings AND md-toggle summaries, guarantees
// each one a unique anchor id, and returns both the id-augmented HTML and a
// flat outline.
//
// 為什麼 summary 也要進 TOC：純 toggle 結構的筆記（整篇都是 :::toggle、沒有任何
// h1-h3，例如 prod 的 reamde）在舊版會得到空 TOC → 章節目錄表整個不出現。
// toggle 的標題由後端 ToggleContainerExtension 渲染成
// <summary class="md-toggle-summary">純文字</summary>，其層級以 details 巢狀深度推定。

export interface TocItem {
  id: string;
  text: string;
  level: 1 | 2 | 3;
}

export interface TocResult {
  html: string;
  toc: TocItem[];
}

/**
 * 單一掃描正則，依文件順序比對四種標記：
 * 1. md-toggle 的 <details …> 開標籤（巢狀深度 +1）
 * 2. </details> 關標籤（巢狀深度 -1）
 * 3. <summary class="md-toggle-summary">標題</summary>（捕獲組 1＝標題）
 * 4. <h1-3 …>標題</h1-3>（捕獲組 2＝層級、3＝屬性、4＝內文）
 * 註 1：Markdig 管線 DisableHtml，內文不可能出現使用者手寫的 details/summary，只會有後端產物。
 * 註 2：屬性區段的量詞一律「有界」（{0,512}/{0,256}）——無界的 [^>]* 在「大量未閉合
 * <details 片段」的病態輸入下會 O(n²) 凍結主執行緒（對抗式復審實測 4MB → 15 秒）；
 * 後端產物的屬性遠短於上限，正常內容行為不變。
 */
const TOKEN =
  /<details\b[^>]{0,512}\bclass="[^"]{0,256}\bmd-toggle\b[^"]{0,256}"[^>]{0,512}>|<\/details\s*>|<summary class="md-toggle-summary"[^>]{0,256}>([\s\S]*?)<\/summary>|<h([123])\b([^>]{0,512})>([\s\S]*?)<\/h\2>/gi;

const EXISTING_ID = /\bid\s*=\s*["']([^"']+)["']/i;

/** toggle summary 收錄的最大巢狀深度（與 h1-h3 的三層上限一致，避免 TOC 過雜）。 */
const MAX_TOGGLE_DEPTH = 3;

function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return base || "section";
}

/** 把 HTML 跳脫字元解回原字元（僅供 TOC 顯示文字；不回寫 HTML）。 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** 從標記內文萃取顯示文字（去標籤、併空白、解跳脫）。 */
function extractText(inner: string): string {
  return decodeEntities(
    inner
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function buildToc(html: string): TocResult {
  const toc: TocItem[] = [];
  const used = new Set<string>();
  // 目前的 md-toggle 巢狀深度（summary 的層級依據）。未閉合的 details 只會讓後續深度偏高，不會噴錯。
  let depth = 0;

  /** 取得未用過的唯一 id（碰撞時 -2、-3 遞增）。 */
  const uniqueId = (seed: string): string => {
    let id = seed;
    let n = 2;
    while (used.has(id)) {
      id = `${seed}-${n}`;
      n += 1;
    }
    used.add(id);
    return id;
  };

  const out = html.replace(
    TOKEN,
    (
      match,
      summaryInner: string | undefined,
      lvl: string | undefined,
      attrs: string | undefined,
      headingInner: string | undefined
    ) => {
      // 1) details 開/關標籤：只調整深度、原樣輸出。
      if (summaryInner === undefined && lvl === undefined) {
        if (match.startsWith("</")) depth = Math.max(0, depth - 1);
        else depth += 1;
        return match;
      }

      // 2) toggle 摘要：依深度決定層級；過深（>3）不收錄、原樣輸出。
      if (summaryInner !== undefined) {
        const text = extractText(summaryInner);
        if (!text || depth < 1 || depth > MAX_TOGGLE_DEPTH) return match;
        const id = uniqueId(slugify(text));
        toc.push({ id, text, level: depth as 1 | 2 | 3 });
        return `<summary class="md-toggle-summary" id="${id}">${summaryInner}</summary>`;
      }

      // 3) h1-h3 標題（維持既有行為：沿用既有 id 當種子、無則 slugify）。
      const level = Number(lvl) as 1 | 2 | 3;
      const inner = headingInner ?? "";
      const text = extractText(inner);
      if (!text) return match;

      const attrStr = attrs ?? "";
      const existing = EXISTING_ID.exec(attrStr);
      const seed = existing ? existing[1] : slugify(text);
      const id = uniqueId(seed);
      toc.push({ id, text, level });

      if (existing) {
        const replaced = attrStr.replace(EXISTING_ID, `id="${id}"`);
        return `<h${level}${replaced}>${inner}</h${level}>`;
      }
      return `<h${level}${attrStr} id="${id}">${inner}</h${level}>`;
    }
  );

  return { html: out, toc };
}
