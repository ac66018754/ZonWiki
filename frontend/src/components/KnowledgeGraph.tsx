'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { GraphNode, GraphEdge } from '@/lib/api';

/**
 * 力導向圖渲染引擎（簡版）
 * 使用 Canvas 繪製節點與邊，支援拖曳、縮放、互動
 */

interface Position {
  x: number;
  y: number;
}

interface NodeData extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphVisualizerProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (nodeId: string) => void;
  theme?: 'warmpaper' | 'light' | 'dark' | 'night';
}

/**
 * 知識圖譜視覺化元件
 * 使用力導向演算法渲染互動式知識圖譜
 */
export const KnowledgeGraphVisualizer: React.FC<GraphVisualizerProps> = ({
  nodes,
  edges,
  onNodeClick,
  theme = 'warmpaper',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 模擬狀態
  const [nodeData, setNodeData] = useState<NodeData[]>([]);
  const [isSimulating, setIsSimulating] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // 力導向演算法參數
  const CHARGE_STRENGTH = -300;
  const LINK_DISTANCE = 100;
  const LINK_STRENGTH = 0.1;
  const FRICTION = 0.8;
  const DAMPING = 0.02;

  // 初始化節點位置
  useEffect(() => {
    if (nodes.length === 0) return;

    const newNodeData: NodeData[] = nodes.map((node, idx) => {
      const angle = (idx / nodes.length) * Math.PI * 2;
      const radius = 150;
      return {
        ...node,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });
    // 使用 queueMicrotask 延遲 setState，避免同步呼叫
    queueMicrotask(() => {
      setNodeData(newNodeData);
    });
  }, [nodes]);

  // Canvas 繪製與模擬
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || nodeData.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 設定 Canvas 尺寸
    const updateCanvasSize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);

    // 取得主題色彩
    const getThemeColors = () => {
      const root = document.documentElement;
      const getVar = (name: string) =>
        getComputedStyle(root).getPropertyValue(name).trim();

      return {
        bgCanvas: getVar('--bg-canvas'),
        textPrimary: getVar('--text-primary'),
        textSecondary: getVar('--text-secondary'),
        borderDefault: getVar('--border-default'),
        actionPrimaryBg: getVar('--action-primary-bg'),
        actionSecondaryFg: getVar('--action-secondary-fg'),
      };
    };

    const colors = getThemeColors();
    const NODE_RADIUS = 8;
    const SELECTED_RADIUS = 12;
    const HOVERED_RADIUS = 11;
    const TEXT_OFFSET = 20;

    // 力導向計算
    const simulateForces = () => {
      if (!isSimulating) return;

      let updated = false;
      const newNodeData = nodeData.map((d) => ({ ...d }));

      // 計算重力與斥力
      for (let i = 0; i < newNodeData.length; i++) {
        const node = newNodeData[i];

        // 將節點吸引至中心（防止漂移）
        const cx = 0;
        const cy = 0;
        const dx = node.x - cx;
        const dy = node.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        node.vx -= dx * DAMPING * 0.5;
        node.vy -= dy * DAMPING * 0.5;

        // 斥力（節點間）
        for (let j = i + 1; j < newNodeData.length; j++) {
          const other = newNodeData[j];
          const ddx = node.x - other.x;
          const ddy = node.y - other.y;
          const d = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          const force = CHARGE_STRENGTH / (d * d);

          node.vx += (ddx / d) * force;
          node.vy += (ddy / d) * force;
          other.vx -= (ddx / d) * force;
          other.vy -= (ddy / d) * force;
        }

        // 重力（連結）
        edges.forEach((edge) => {
          if (edge.sourceNoteId === node.id) {
            const target = newNodeData.find((n) => n.id === edge.targetNoteId);
            if (target) {
              const ddx = node.x - target.x;
              const ddy = node.y - target.y;
              const d = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
              const force = (d - LINK_DISTANCE) * LINK_STRENGTH;

              node.vx -= (ddx / d) * force;
              node.vy -= (ddy / d) * force;
              target.vx += (ddx / d) * force;
              target.vy += (ddy / d) * force;
            }
          } else if (edge.targetNoteId === node.id) {
            const source = newNodeData.find((n) => n.id === edge.sourceNoteId);
            if (source) {
              const ddx = node.x - source.x;
              const ddy = node.y - source.y;
              const d = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
              const force = (d - LINK_DISTANCE) * LINK_STRENGTH;

              node.vx -= (ddx / d) * force;
              node.vy -= (ddy / d) * force;
              source.vx += (ddx / d) * force;
              source.vy += (ddy / d) * force;
            }
          }
        });

        // 應用速度與摩擦力
        node.vx *= FRICTION;
        node.vy *= FRICTION;
        node.x += node.vx;
        node.y += node.vy;

        if (Math.abs(node.vx) > 0.1 || Math.abs(node.vy) > 0.1) {
          updated = true;
        }
      }

      setNodeData(newNodeData);
      if (!updated) {
        setIsSimulating(false);
      }
    };

    // 繪製
    const draw = () => {
      // 清空 Canvas
      ctx.fillStyle = colors.bgCanvas;
      ctx.fillRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);

      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      const centerX = width / 2;
      const centerY = height / 2;

      // 繪製邊
      ctx.strokeStyle = colors.borderDefault;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;

      edges.forEach((edge) => {
        const source = nodeData.find((n) => n.id === edge.sourceNoteId);
        const target = nodeData.find((n) => n.id === edge.targetNoteId);

        if (source && target) {
          ctx.beginPath();
          ctx.moveTo(centerX + source.x, centerY + source.y);
          ctx.lineTo(centerX + target.x, centerY + target.y);
          ctx.stroke();
        }
      });

      ctx.globalAlpha = 1;

      // 繪製節點
      nodeData.forEach((node) => {
        const x = centerX + node.x;
        const y = centerY + node.y;

        let radius = NODE_RADIUS;
        let fillColor = colors.actionPrimaryBg;
        let strokeColor = colors.actionPrimaryBg;

        if (selectedNodeId === node.id) {
          radius = SELECTED_RADIUS;
          strokeColor = colors.actionSecondaryFg;
        } else if (hoveredNodeId === node.id) {
          radius = HOVERED_RADIUS;
          fillColor = colors.actionSecondaryFg;
        }

        // 繪製節點圓形
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // 繪製邊框
        if (selectedNodeId === node.id || hoveredNodeId === node.id) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // 繪製標籤
        if (node.title.length < 30) {
          ctx.fillStyle = colors.textPrimary;
          ctx.font = '12px var(--font-body)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(node.title, x, y + TEXT_OFFSET);
        }
      });
    };

    // 動畫迴圈
    let rafId: number;
    const animate = () => {
      simulateForces();
      draw();
      rafId = requestAnimationFrame(animate);
    };
    animate();

    // 滑鼠互動
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      const centerX = width / 2;
      const centerY = height / 2;

      let nearNode: string | null = null;
      for (const node of nodeData) {
        const x = centerX + node.x;
        const y = centerY + node.y;
        const dist = Math.sqrt((mx - x) ** 2 + (my - y) ** 2);
        if (dist < 20) {
          nearNode = node.id;
          break;
        }
      }

      setHoveredNodeId(nearNode);
      if (nearNode) {
        canvas.style.cursor = 'pointer';
      } else {
        canvas.style.cursor = 'default';
      }
    };

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      const centerX = width / 2;
      const centerY = height / 2;

      for (const node of nodeData) {
        const x = centerX + node.x;
        const y = centerY + node.y;
        const dist = Math.sqrt((mx - x) ** 2 + (my - y) ** 2);
        if (dist < 20) {
          setSelectedNodeId(node.id);
          onNodeClick?.(node.id);
          break;
        }
      }
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);

    return () => {
      window.removeEventListener('resize', updateCanvasSize);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
      cancelAnimationFrame(rafId);
    };
  }, [nodeData, edges, isSimulating, selectedNodeId, hoveredNodeId, onNodeClick]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-default)',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
    </div>
  );
};
