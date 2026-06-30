'use client';

import React, { useEffect, useState } from 'react';
import { getKnowledgeGraph, type KnowledgeGraph, type GraphNode } from '@/lib/api';
import { logger } from '@/lib/logger';
import { KnowledgeGraphVisualizer } from '@/components/KnowledgeGraph';

/**
 * 知識圖譜頁面
 *
 * 功能：
 * - 展示所有筆記的互動式知識圖譜
 * - 力導向圖視覺化
 * - 點擊節點導航至筆記
 * - 支援 4 種顯示模式
 * - RWD / 觸控支援
 */

export default function KnowledgeGraphPage() {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // 載入知識圖譜
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await getKnowledgeGraph();
        if (data) {
          setGraph(data);
          setError(null);
        } else {
          setError('無法載入知識圖譜，請稍後重試。');
        }
      } catch (err) {
        logger.error('Failed to load knowledge graph:', err);
        setError('載入知識圖譜時發生錯誤，請稍後重試。');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  // 點擊節點時的處理
  const handleNodeClick = (nodeId: string) => {
    const node = graph?.nodes.find((n) => n.id === nodeId);
    if (node) {
      setSelectedNode(node);
    }
  };

  // 導航至筆記
  const navigateToNote = () => {
    if (selectedNode) {
      window.location.href = `/notes/${selectedNode.slug}`;
    }
  };

  // 取得主題：SSR 時無 document，故加 typeof 守衛避免「document is not defined」造成整頁 500。
  // 圖譜只在用戶端載入資料（loading=false）後才渲染，SSR 階段渲染的是載入動畫、不會用到 theme，故無 hydration 不一致疑慮。
  const theme = (typeof document !== 'undefined'
    ? document.documentElement.getAttribute('data-theme') || 'warmpaper'
    : 'warmpaper') as 'warmpaper' | 'light' | 'dark' | 'night';

  if (loading) {
    return (
      <div className="graph-page">
        <div className="graph-page__container">
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '400px',
              gap: 'var(--spacing-3)',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                border: '3px solid var(--border-default)',
                borderTopColor: 'var(--action-primary-bg)',
                animation: 'spin 1s linear infinite',
              }}
            />
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
              載入知識圖譜中...
            </p>
          </div>
          <style jsx>{`
            @keyframes spin {
              from {
                transform: rotate(0deg);
              }
              to {
                transform: rotate(360deg);
              }
            }
          `}</style>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="graph-page">
        <div className="graph-page__container">
          <div
            style={{
              padding: 'var(--spacing-6)',
              background: 'var(--status-danger-bg)',
              color: 'var(--status-danger-fg)',
              borderRadius: 'var(--radius-lg)',
              textAlign: 'center',
            }}
            role="alert"
          >
            <p style={{ margin: 0, fontWeight: 500 }}>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="graph-page">
        <div className="graph-page__container">
          <div
            style={{
              padding: 'var(--spacing-12)',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px dashed var(--border-default)',
            }}
          >
            <span
              style={{ fontSize: 'var(--text-4xl)', display: 'block', marginBottom: 'var(--spacing-2)' }}
            >
              🕸️
            </span>
            <p style={{ margin: 0, fontWeight: 500 }}>沒有筆記</p>
            <p style={{ margin: 'var(--spacing-2) 0 0 0', fontSize: 'var(--text-sm)' }}>
              新增筆記時，知識圖譜會自動建立。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="graph-page">
      <div className="graph-page__header">
        <div>
          <h1 className="graph-page__title">知識圖譜</h1>
          <p className="graph-page__subtitle">
            {graph.nodes.length} 篇筆記 · {graph.edges.length} 個連結
          </p>
        </div>
      </div>

      <div className="graph-page__content">
        <div className="graph-page__canvas">
          <KnowledgeGraphVisualizer
            nodes={graph.nodes}
            edges={graph.edges}
            onNodeClick={handleNodeClick}
            theme={theme}
          />
        </div>

        {selectedNode && (
          <div className="graph-page__sidebar">
            <div className="graph-page__sidebar-header">
              <h2 className="graph-page__sidebar-title">節點詳情</h2>
              <button
                onClick={() => setSelectedNode(null)}
                className="graph-page__sidebar-close"
                aria-label="關閉"
              >
                ✕
              </button>
            </div>

            <div className="graph-page__sidebar-content">
              <div className="graph-page__node-card">
                <div className="graph-page__node-title">{selectedNode.title}</div>

                <div className="graph-page__node-meta">
                  <div className="graph-page__node-meta-item">
                    <span className="graph-page__node-meta-label">類型：</span>
                    <span
                      className={`graph-page__node-kind graph-page__node-kind--${selectedNode.kind}`}
                    >
                      {selectedNode.kind === 'note' ? '筆記' : '日記'}
                    </span>
                  </div>

                  <div className="graph-page__node-meta-item">
                    <span className="graph-page__node-meta-label">連線數：</span>
                    <span>
                      {graph.edges.filter(
                        (e) => e.sourceNoteId === selectedNode.id || e.targetNoteId === selectedNode.id
                      ).length}
                    </span>
                  </div>

                  <div className="graph-page__node-meta-item">
                    <span className="graph-page__node-meta-label">進連結：</span>
                    <span>
                      {graph.edges.filter((e) => e.targetNoteId === selectedNode.id).length}
                    </span>
                  </div>

                  <div className="graph-page__node-meta-item">
                    <span className="graph-page__node-meta-label">出連結：</span>
                    <span>
                      {graph.edges.filter((e) => e.sourceNoteId === selectedNode.id).length}
                    </span>
                  </div>
                </div>

                <button
                  onClick={navigateToNote}
                  className="graph-page__node-button btn-primary"
                  style={{
                    width: '100%',
                    marginTop: 'var(--spacing-4)',
                    padding: 'var(--spacing-3) var(--spacing-4)',
                  }}
                >
                  開啟筆記 →
                </button>
              </div>

              {/* 進連結 */}
              {graph.edges.filter((e) => e.targetNoteId === selectedNode.id).length > 0 && (
                <div className="graph-page__sidebar-section">
                  <h3 className="graph-page__sidebar-section-title">指向此筆記</h3>
                  <div className="graph-page__link-list">
                    {graph.edges
                      .filter((e) => e.targetNoteId === selectedNode.id)
                      .map((edge) => {
                        const source = graph.nodes.find((n) => n.id === edge.sourceNoteId);
                        return (
                          <a
                            key={`${edge.sourceNoteId}-${selectedNode.id}`}
                            href={`/notes/${source?.slug}`}
                            className="graph-page__link-item"
                          >
                            <span className="graph-page__link-icon">←</span>
                            <span className="graph-page__link-title">{source?.title || '未命名'}</span>
                            {edge.anchorText && (
                              <span className="graph-page__link-anchor">「{edge.anchorText}」</span>
                            )}
                          </a>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* 出連結 */}
              {graph.edges.filter((e) => e.sourceNoteId === selectedNode.id).length > 0 && (
                <div className="graph-page__sidebar-section">
                  <h3 className="graph-page__sidebar-section-title">此筆記指向</h3>
                  <div className="graph-page__link-list">
                    {graph.edges
                      .filter((e) => e.sourceNoteId === selectedNode.id)
                      .map((edge) => {
                        const target = edge.targetNoteId
                          ? graph.nodes.find((n) => n.id === edge.targetNoteId)
                          : null;
                        return (
                          <div
                            key={`${selectedNode.id}-${edge.targetNoteId}`}
                            className={`graph-page__link-item ${!target ? 'graph-page__link-item--broken' : ''}`}
                          >
                            <span className="graph-page__link-icon">→</span>
                            {target ? (
                              <>
                                <a href={`/notes/${target.slug}`} className="graph-page__link-title">
                                  {target.title}
                                </a>
                                {edge.anchorText && (
                                  <span className="graph-page__link-anchor">「{edge.anchorText}」</span>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="graph-page__link-title graph-page__link-title--broken">
                                  {edge.anchorText || '未命名'}
                                </span>
                                <span className="graph-page__link-status">(未建立)</span>
                              </>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .graph-page {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }

        .graph-page__header {
          padding: var(--spacing-6) var(--spacing-4);
          border-bottom: 1px solid var(--border-default);
          flex-shrink: 0;
        }

        .graph-page__title {
          margin: 0;
          font-size: var(--text-2xl);
          font-weight: 700;
          color: var(--text-primary);
        }

        .graph-page__subtitle {
          margin: var(--spacing-2) 0 0 0;
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .graph-page__content {
          display: flex;
          flex: 1;
          overflow: hidden;
          gap: var(--spacing-4);
          padding: var(--spacing-4);
        }

        .graph-page__canvas {
          flex: 1;
          min-width: 0;
          overflow: hidden;
        }

        .graph-page__sidebar {
          display: flex;
          flex-direction: column;
          width: 300px;
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          overflow: hidden;
          flex-shrink: 0;
        }

        .graph-page__sidebar-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--spacing-4);
          border-bottom: 1px solid var(--border-default);
          flex-shrink: 0;
        }

        .graph-page__sidebar-title {
          margin: 0;
          font-size: var(--text-base);
          font-weight: 600;
          color: var(--text-primary);
        }

        .graph-page__sidebar-close {
          background: none;
          border: none;
          font-size: var(--text-lg);
          color: var(--text-secondary);
          cursor: pointer;
          padding: 0;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-md);
          transition: all 0.2s ease;
        }

        .graph-page__sidebar-close:hover {
          background: var(--bg-surface-secondary);
          color: var(--text-primary);
        }

        .graph-page__sidebar-content {
          flex: 1;
          overflow-y: auto;
          padding: var(--spacing-4);
          display: flex;
          flex-direction: column;
          gap: var(--spacing-4);
        }

        .graph-page__node-card {
          padding: var(--spacing-4);
          background: var(--bg-canvas);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-default);
        }

        .graph-page__node-title {
          font-size: var(--text-base);
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 var(--spacing-3) 0;
          word-break: break-word;
        }

        .graph-page__node-meta {
          display: grid;
          gap: var(--spacing-2);
          font-size: var(--text-sm);
        }

        .graph-page__node-meta-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .graph-page__node-meta-label {
          color: var(--text-secondary);
          font-weight: 500;
        }

        .graph-page__node-kind {
          display: inline-block;
          padding: 2px 8px;
          border-radius: var(--radius-full);
          font-size: var(--text-xs);
          font-weight: 500;
        }

        .graph-page__node-kind--note {
          background: var(--action-secondary-bg);
          color: var(--action-secondary-fg);
        }

        .graph-page__node-kind--journal {
          background: var(--status-warning-bg);
          color: var(--status-warning-fg);
        }

        .graph-page__sidebar-section {
          padding: 0;
        }

        .graph-page__sidebar-section-title {
          margin: 0 0 var(--spacing-2) 0;
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
        }

        .graph-page__link-list {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-2);
        }

        .graph-page__link-item {
          padding: var(--spacing-2) var(--spacing-3);
          background: var(--bg-canvas);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          gap: var(--spacing-2);
          font-size: var(--text-sm);
          text-decoration: none;
          color: var(--text-primary);
          transition: all 0.2s ease;
        }

        .graph-page__link-item:hover {
          border-color: var(--border-strong);
          background: var(--bg-surface);
        }

        .graph-page__link-item--broken {
          cursor: default;
        }

        .graph-page__link-item--broken:hover {
          border-color: var(--border-default);
          background: var(--bg-canvas);
        }

        .graph-page__link-icon {
          color: var(--text-secondary);
          font-weight: 600;
          flex-shrink: 0;
        }

        .graph-page__link-title {
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 500;
        }

        .graph-page__link-title--broken {
          color: var(--text-secondary);
          font-style: italic;
        }

        .graph-page__link-anchor {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex-shrink: 0;
        }

        .graph-page__link-status {
          font-size: var(--text-xs);
          color: var(--status-danger-fg);
          flex-shrink: 0;
        }

        /* RWD — 行動裝置 */
        @media (max-width: 768px) {
          .graph-page__content {
            flex-direction: column;
            padding: var(--spacing-3);
          }

          .graph-page__sidebar {
            width: 100%;
            max-height: 40vh;
          }

          .graph-page__header {
            padding: var(--spacing-4) var(--spacing-3);
          }
        }

        /* 無障礙 — 高對比模式 */
        @media (prefers-contrast: more) {
          .graph-page__link-item {
            border-width: 2px;
          }

          .graph-page__sidebar {
            border-width: 2px;
          }

          .graph-page__node-card {
            border-width: 2px;
          }
        }

        /* 無障礙 — 減低動畫 */
        @media (prefers-reduced-motion: reduce) {
          .graph-page__link-item,
          .graph-page__sidebar-close {
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
