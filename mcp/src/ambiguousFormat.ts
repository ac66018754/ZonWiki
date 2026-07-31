/**
 * 消歧異候選 → 人類（AI）可讀文字。
 *
 * 背景（feature/slug-alias 包3）：GET /api/notes/{slug} 的回應改為
 * { kind:"note"|"ambiguous", ... }。當 slug 因「名字被多篇取用過」而歧義時，
 * get_note 不能再把整包 JSON 原樣丟回（AI 呼叫端會困惑該選哪個），
 * 改以本函式輸出：每個候選一行（標題＋現用/曾用標示＋id），並提示「以 id 重查可直達」
 * （get_note 支援把 GUID 當 slug 傳入 → 永不再歧義的錨點）。
 */

/**
 * 單一消歧異候選（對應後端 SlugCandidateDto）。
 */
export interface SlugCandidate {
  /** 筆記識別碼（GUID）；以此重查（get_note 傳 id 當 slug）可直達、不再歧義。 */
  id: string
  /** 筆記目前的標題。 */
  title: string
  /** 筆記目前的（活著的）slug。 */
  slug: string
  /** 是否為「現在正用這個名字」的那一篇。 */
  isCurrentHolder: boolean
  /** 別名命中者：讓出此 slug 當下的標題（現用者為 null）。 */
  originalTitle: string | null
  /** 最後更新時間（UTC ISO 字串）。 */
  updatedAt: string
}

/**
 * 依 slug 解析筆記的回應（對應後端 NoteResolutionDto）。
 */
export interface NoteResolution {
  /** 解析種類："note"（唯一命中）或 "ambiguous"（多篇候選）。 */
  kind: 'note' | 'ambiguous'
  /** 僅 kind="note"：命中來源是否為舊 slug（別名）。 */
  matchedByAlias?: boolean | null
  /** 命中的筆記本體（kind="note"）。 */
  note?: unknown
  /** 使用者輸入、產生歧義的 slug（kind="ambiguous"）。 */
  requestedSlug?: string | null
  /** 歧義候選清單（kind="ambiguous"）。 */
  candidates?: SlugCandidate[] | null
}

/**
 * 把消歧異候選清單格式化成一段給 AI 讀的文字。
 *
 * @param requestedSlug 使用者輸入、產生歧義的 slug。
 * @param candidates 候選清單（可能為空——防禦邊界）。
 * @returns 每個候選一行（標題／現用或曾用／id）＋「以 id 重查直達」提示的多行文字。
 */
export function formatAmbiguous(requestedSlug: string, candidates: SlugCandidate[]): string {
  // 空候選防禦：不炸、回一段有意義的非空字串。
  if (!candidates || candidates.length === 0) {
    return `找不到「${requestedSlug}」對應的任何筆記（沒有候選）。`
  }

  const header =
    `「${requestedSlug}」目前可能指向多篇筆記，請挑一篇、以其 id 重新查詢`
    + `（get_note 支援直接把 id 當 slug 傳入，即可直達不再歧義）：`

  const lines = candidates.map((candidate) => {
    // 「現用此名」／「曾用此名」：測試契約要求文字含「現用」「曾用」兩詞。
    const marker = candidate.isCurrentHolder ? '現用此名' : '曾用此名'
    // 曾用者附「現名／曾名」對照，幫 AI 辨識是哪一篇（現用者則無 originalTitle）。
    const detail =
      !candidate.isCurrentHolder && candidate.originalTitle
        ? `（現名《${candidate.title}》，讓出此名時名為《${candidate.originalTitle}》）`
        : `《${candidate.title}》`
    return `・${marker}：${detail} — id: ${candidate.id}`
  })

  return [header, ...lines].join('\n')
}
