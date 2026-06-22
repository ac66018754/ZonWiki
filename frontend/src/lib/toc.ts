// Table-of-contents extraction. Runs on the server: scans rendered article
// HTML for h2/h3 headings, guarantees each one a unique anchor id, and returns
// both the id-augmented HTML and a flat outline.

export interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface TocResult {
  html: string;
  toc: TocItem[];
}

const HEADING = /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
const EXISTING_ID = /\bid\s*=\s*["']([^"']+)["']/i;

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

export function buildToc(html: string): TocResult {
  const toc: TocItem[] = [];
  const used = new Set<string>();

  const out = html.replace(HEADING, (match, lvl: string, attrs: string, inner: string) => {
    const level = (Number(lvl) === 3 ? 3 : 2) as 2 | 3;
    const text = inner
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return match;

    const existing = EXISTING_ID.exec(attrs);
    const seed = existing ? existing[1] : slugify(text);

    let id = seed;
    let n = 2;
    while (used.has(id)) {
      id = `${seed}-${n}`;
      n += 1;
    }
    used.add(id);
    toc.push({ id, text, level });

    if (existing) {
      const replaced = attrs.replace(EXISTING_ID, `id="${id}"`);
      return `<h${level}${replaced}>${inner}</h${level}>`;
    }
    return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
  });

  return { html: out, toc };
}
