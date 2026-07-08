/**
 * API 領域模組 — 知識圖譜（Graph）。
 */

import { fetchJson } from "./client";

/**
 * 知識圖譜節點（筆記）
 */
export interface GraphNode {
  /** 節點 ID (筆記 ID) */
  id: string;
  /** 節點標題 */
  title: string;
  /** 節點 slug */
  slug: string;
  /** 節點類型 (note|journal) */
  kind: string;
}

/**
 * 知識圖譜邊（連結）
 */
export interface GraphEdge {
  /** 來源筆記 ID */
  sourceNoteId: string;
  /** 目標筆記 ID (可能為空字串表示未建立的筆記) */
  targetNoteId?: string | null;
  /** 連結文字 */
  anchorText: string;
}

/**
 * 知識圖譜資料
 */
export interface KnowledgeGraph {
  /** 圖譜節點 */
  nodes: GraphNode[];
  /** 圖譜邊 */
  edges: GraphEdge[];
}

/**
 * 取得知識圖譜資料（所有筆記與連結）
 */
export async function getKnowledgeGraph(): Promise<KnowledgeGraph | null> {
  const r = await fetchJson<KnowledgeGraph>("/api/graph");
  return r.data ?? null;
}
