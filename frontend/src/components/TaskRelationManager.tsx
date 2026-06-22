"use client";

import { useState, useEffect } from "react";
import {
  TaskCard,
  TaskRelation,
  listTaskCards,
  listTaskRelations,
  createTaskRelation,
  deleteTaskRelation,
  listNoteTaskLinks,
  createNoteTaskLink,
  deleteNoteTaskLink,
} from "@/lib/api";
import { logger } from "@/lib/logger";

/**
 * 任務卡片關聯管理元件
 * - 顯示任務與其他任務的關聯（depends/blocks/relates/subtask）
 * - 可建立/移除卡片間關聯
 * - 可連結/移除筆記與任務的連結
 */
export function TaskRelationManager({
  taskId,
  allTasks,
  noteId,
}: {
  taskId: string;
  allTasks: TaskCard[];
  noteId?: string;
}) {
  const [relations, setRelations] = useState<TaskRelation[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<TaskCard[]>([]);
  const [showRelationModal, setShowRelationModal] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * 初始化：載入關聯與連結
   */
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const relationsData = await listTaskRelations(taskId);
        setRelations(relationsData);

        if (noteId) {
          const tasksData = await listNoteTaskLinks(noteId);
          setLinkedTasks(tasksData);
        }
      } catch (err) {
        logger.error("Failed to load task relations:", err);
        setError("載入關聯失敗");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [taskId, noteId]);

  /**
   * 建立關聯
   */
  const handleCreateRelation = async (
    targetTaskId: string,
    relationType: "depends" | "blocks" | "relates" | "subtask"
  ) => {
    try {
      const relation = await createTaskRelation({
        sourceTaskId: taskId,
        targetTaskId,
        relationType,
      });

      if (relation) {
        setRelations((prev) => [...prev, relation]);
        setShowRelationModal(false);
      }
    } catch (err) {
      logger.error("Failed to create relation:", err);
      setError("建立關聯失敗");
    }
  };

  /**
   * 刪除關聯
   */
  const handleDeleteRelation = async (relationId: string) => {
    try {
      const success = await deleteTaskRelation(relationId);
      if (success) {
        setRelations((prev) => prev.filter((r) => r.id !== relationId));
      }
    } catch (err) {
      logger.error("Failed to delete relation:", err);
      setError("刪除關聯失敗");
    }
  };

  /**
   * 連結筆記與任務
   */
  const handleLinkNote = async (taskToLink: TaskCard) => {
    if (!noteId) return;

    try {
      const success = await createNoteTaskLink(noteId, taskToLink.id);
      if (success) {
        setLinkedTasks((prev) => [...prev, taskToLink]);
        setShowNoteModal(false);
      }
    } catch (err) {
      logger.error("Failed to link note and task:", err);
      setError("連結失敗");
    }
  };

  /**
   * 移除筆記與任務的連結
   */
  const handleUnlinkNote = async (taskToUnlink: TaskCard) => {
    if (!noteId) return;

    try {
      const success = await deleteNoteTaskLink(noteId, taskToUnlink.id);
      if (success) {
        setLinkedTasks((prev) => prev.filter((t) => t.id !== taskToUnlink.id));
      }
    } catch (err) {
      logger.error("Failed to unlink note and task:", err);
      setError("取消連結失敗");
    }
  };

  /**
   * 取得關聯類型標籤
   */
  function getRelationLabel(type: string): string {
    switch (type) {
      case "depends":
        return "依賴";
      case "blocks":
        return "阻擋";
      case "relates":
        return "相關";
      case "subtask":
        return "子任務";
      default:
        return type;
    }
  }

  if (loading) {
    return <div style={{ padding: "var(--spacing-4)" }}>載入中...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-6)" }}>
      {error && (
        <div
          style={{
            padding: "var(--spacing-3)",
            borderRadius: "var(--radius-md)",
            background: "var(--status-danger-bg)",
            color: "var(--status-danger-fg)",
            fontSize: "var(--text-sm)",
          }}
        >
          {error}
        </div>
      )}

      {/* 任務關聯 */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "var(--spacing-3)",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "var(--text-lg)",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            任務關聯
          </h3>
          <button
            onClick={() => setShowRelationModal(true)}
            style={{
              padding: "var(--spacing-2) var(--spacing-3)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--action-secondary-fg)",
              background: "var(--action-secondary-bg)",
              color: "var(--action-secondary-fg)",
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--action-secondary-fg)";
              e.currentTarget.style.color = "var(--action-secondary-bg)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--action-secondary-bg)";
              e.currentTarget.style.color = "var(--action-secondary-fg)";
            }}
          >
            + 新增關聯
          </button>
        </div>

        {relations.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
            {relations.map((relation) => {
              const relatedTask = allTasks.find(
                (t) => t.id === relation.targetTaskId
              );
              return (
                <div
                  key={relation.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "var(--spacing-3)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-default)",
                    background: "var(--bg-surface)",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: 600,
                        color: "var(--text-tertiary)",
                        marginBottom: "var(--spacing-1)",
                        textTransform: "uppercase",
                      }}
                    >
                      {getRelationLabel(relation.relationType)}
                    </div>
                    <div
                      style={{
                        fontSize: "var(--text-sm)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {relatedTask?.title || "未知任務"}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteRelation(relation.id)}
                    style={{
                      padding: "var(--spacing-2) var(--spacing-3)",
                      borderRadius: "var(--radius-sm)",
                      border: "none",
                      background: "var(--status-danger-bg)",
                      color: "var(--status-danger-fg)",
                      fontSize: "var(--text-xs)",
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = "0.8";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = "1";
                    }}
                  >
                    移除
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              padding: "var(--spacing-4)",
              textAlign: "center",
              color: "var(--text-secondary)",
              fontSize: "var(--text-sm)",
            }}
          >
            無關聯任務
          </div>
        )}

        {/* 新增關聯模態 */}
        {showRelationModal && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0, 0, 0, 0.5)",
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onClick={() => setShowRelationModal(false)}
            role="presentation"
          >
            <div
              style={{
                background: "var(--bg-elevated)",
                borderRadius: "var(--radius-lg)",
                padding: "var(--spacing-6)",
                maxHeight: "600px",
                overflow: "auto",
                minWidth: "400px",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                style={{
                  margin: "0 0 var(--spacing-4) 0",
                  fontSize: "var(--text-lg)",
                  fontWeight: 600,
                }}
              >
                新增任務關聯
              </h3>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--spacing-3)",
                  marginBottom: "var(--spacing-4)",
                }}
              >
                {allTasks
                  .filter((t) => t.id !== taskId)
                  .map((task) => (
                    <div
                      key={task.id}
                      style={{
                        padding: "var(--spacing-3)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-default)",
                        background: "var(--bg-surface)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "var(--text-sm)",
                          fontWeight: 600,
                          marginBottom: "var(--spacing-2)",
                        }}
                      >
                        {task.title}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: "var(--spacing-2)",
                          flexWrap: "wrap",
                        }}
                      >
                        {(["depends", "blocks", "relates", "subtask"] as const).map(
                          (type) => (
                            <button
                              key={type}
                              onClick={() => {
                                handleCreateRelation(task.id, type);
                              }}
                              style={{
                                padding: "var(--spacing-2) var(--spacing-3)",
                                borderRadius: "var(--radius-sm)",
                                border: "1px solid var(--action-secondary-fg)",
                                background: "transparent",
                                color: "var(--action-secondary-fg)",
                                fontSize: "var(--text-xs)",
                                fontWeight: 600,
                                cursor: "pointer",
                                transition: "all 0.2s ease",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "var(--action-secondary-bg)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "transparent";
                              }}
                            >
                              {getRelationLabel(type)}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  ))}
              </div>

              <button
                onClick={() => setShowRelationModal(false)}
                style={{
                  padding: "var(--spacing-2) var(--spacing-4)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-default)",
                  background: "transparent",
                  color: "var(--text-primary)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 600,
                  cursor: "pointer",
                  width: "100%",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--border-default)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                關閉
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 筆記連結 */}
      {noteId && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "var(--spacing-3)",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "var(--text-lg)",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              連結任務
            </h3>
            <button
              onClick={() => setShowNoteModal(true)}
              style={{
                padding: "var(--spacing-2) var(--spacing-3)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--action-secondary-fg)",
                background: "var(--action-secondary-bg)",
                color: "var(--action-secondary-fg)",
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--action-secondary-fg)";
                e.currentTarget.style.color = "var(--action-secondary-bg)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--action-secondary-bg)";
                e.currentTarget.style.color = "var(--action-secondary-fg)";
              }}
            >
              + 連結任務
            </button>
          </div>

          {linkedTasks.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
              {linkedTasks.map((task) => (
                <div
                  key={task.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "var(--spacing-3)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-default)",
                    background: "var(--bg-surface)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "var(--text-sm)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {task.title}
                  </div>
                  <button
                    onClick={() => handleUnlinkNote(task)}
                    style={{
                      padding: "var(--spacing-2) var(--spacing-3)",
                      borderRadius: "var(--radius-sm)",
                      border: "none",
                      background: "var(--status-danger-bg)",
                      color: "var(--status-danger-fg)",
                      fontSize: "var(--text-xs)",
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = "0.8";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = "1";
                    }}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: "var(--spacing-4)",
                textAlign: "center",
                color: "var(--text-secondary)",
                fontSize: "var(--text-sm)",
              }}
            >
              無連結任務
            </div>
          )}

          {/* 連結任務模態 */}
          {showNoteModal && (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0, 0, 0, 0.5)",
                zIndex: 1000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onClick={() => setShowNoteModal(false)}
              role="presentation"
            >
              <div
                style={{
                  background: "var(--bg-elevated)",
                  borderRadius: "var(--radius-lg)",
                  padding: "var(--spacing-6)",
                  maxHeight: "600px",
                  overflow: "auto",
                  minWidth: "400px",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <h3
                  style={{
                    margin: "0 0 var(--spacing-4) 0",
                    fontSize: "var(--text-lg)",
                    fontWeight: 600,
                  }}
                >
                  連結任務到此筆記
                </h3>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--spacing-3)",
                    marginBottom: "var(--spacing-4)",
                  }}
                >
                  {allTasks
                    .filter((t) => !linkedTasks.find((lt) => lt.id === t.id))
                    .map((task) => (
                      <div
                        key={task.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "var(--spacing-3)",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--border-default)",
                          background: "var(--bg-surface)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "var(--text-sm)",
                            fontWeight: 600,
                          }}
                        >
                          {task.title}
                        </div>
                        <button
                          onClick={() => handleLinkNote(task)}
                          style={{
                            padding: "var(--spacing-2) var(--spacing-3)",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--action-primary-bg)",
                            background: "var(--action-primary-bg)",
                            color: "var(--action-primary-fg)",
                            fontSize: "var(--text-xs)",
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background =
                              "var(--action-primary-hover)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background =
                              "var(--action-primary-bg)";
                          }}
                        >
                          連結
                        </button>
                      </div>
                    ))}
                </div>

                <button
                  onClick={() => setShowNoteModal(false)}
                  style={{
                    padding: "var(--spacing-2) var(--spacing-4)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-default)",
                    background: "transparent",
                    color: "var(--text-primary)",
                    fontSize: "var(--text-sm)",
                    fontWeight: 600,
                    cursor: "pointer",
                    width: "100%",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--border-default)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  關閉
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
