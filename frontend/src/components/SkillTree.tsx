import React, { useRef, useEffect, useState, useCallback } from 'react';

interface SkillNode {
  id: string;
  label: string;
  type: string;
  accessCount: number;
  lastAccess: string;
  size: number;
}

interface SkillEdge {
  from: string;
  to: string;
  type: string;
}

interface Props {
  onNodeClick?: (nodeId: string) => void;
  highlightNode?: string | null;
}

interface SimNode extends SkillNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

const NODE_COLORS: Record<string, string> = {
  sop: '#4A9EFF',
  script: '#52C41A',
  index: '#FAAD14',
  data: '#8C8C8C',
};

export default function SkillTree({ onNodeClick, highlightNode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [edges, setEdges] = useState<SkillEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [dragNode, setDragNode] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<SimNode[]>([]);

  useEffect(() => {
    fetch('/api/skilltree')
      .then(r => r.json())
      .then(data => {
        const rawNodes: SkillNode[] = data.nodes || [];
        const rawEdges: SkillEdge[] = data.edges || [];
        const simNodes: SimNode[] = rawNodes.map((n, i) => ({
          ...n,
          x: 300 + Math.cos(i * 2.4) * 150 + Math.random() * 50,
          y: 200 + Math.sin(i * 2.4) * 150 + Math.random() * 50,
          vx: 0,
          vy: 0,
          radius: Math.max(8, Math.min(24, 8 + (n.accessCount || 0) * 0.5)),
        }));
        setNodes(simNodes);
        nodesRef.current = simNodes;
        setEdges(rawEdges);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Force simulation
  useEffect(() => {
    if (nodes.length === 0) return;
    let running = true;
    let iterations = 0;

    const simulate = () => {
      if (!running || iterations > 300) return;
      iterations++;
      const ns = nodesRef.current;
      const damping = 0.92;
      const repulsion = 2000;
      const springLen = 100;
      const springK = 0.01;
      const centerX = 300;
      const centerY = 200;

      for (let i = 0; i < ns.length; i++) {
        if (ns[i].id === dragNode) continue;
        let fx = 0, fy = 0;
        // Repulsion from all other nodes
        for (let j = 0; j < ns.length; j++) {
          if (i === j) continue;
          const dx = ns[i].x - ns[j].x;
          const dy = ns[i].y - ns[j].y;
          const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const force = repulsion / (dist * dist);
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }
        // Spring attraction along edges
        for (const e of edges) {
          let other: SimNode | undefined;
          if (e.from === ns[i].id) other = ns.find(n => n.id === e.to);
          else if (e.to === ns[i].id) other = ns.find(n => n.id === e.from);
          if (other) {
            const dx = other.x - ns[i].x;
            const dy = other.y - ns[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const force = (dist - springLen) * springK;
            fx += (dx / dist) * force;
            fy += (dy / dist) * force;
          }
        }
        // Center gravity
        fx += (centerX - ns[i].x) * 0.001;
        fy += (centerY - ns[i].y) * 0.001;

        ns[i].vx = (ns[i].vx + fx) * damping;
        ns[i].vy = (ns[i].vy + fy) * damping;
        ns[i].x += ns[i].vx;
        ns[i].y += ns[i].vy;
      }
      nodesRef.current = [...ns];
      setNodes([...ns]);
      animRef.current = requestAnimationFrame(simulate);
    };
    animRef.current = requestAnimationFrame(simulate);
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [edges, dragNode, nodes.length]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);

    // Draw edges
    for (const e of edges) {
      const from = nodes.find(n => n.id === e.from);
      const to = nodes.find(n => n.id === e.to);
      if (!from || !to) continue;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = e.type === 'import' ? 'rgba(82,196,26,0.4)' : 'rgba(74,158,255,0.3)';
      ctx.lineWidth = e.type === 'import' ? 1.5 : 1;
      if (e.type === 'reference') ctx.setLineDash([4, 4]);
      else ctx.setLineDash([]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw nodes
    for (const n of nodes) {
      const color = NODE_COLORS[n.type] || NODE_COLORS.data;
      const isHovered = n.id === hoveredNode;
      const isHighlighted = n.id === highlightNode;

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = isHovered || isHighlighted ? 1 : 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;

      if (isHovered || isHighlighted) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label
      ctx.fillStyle = 'var(--text-1, #e0e0e0)';
      ctx.font = `${isHovered ? 11 : 9}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(n.label.slice(0, 16), n.x, n.y + n.radius + 12);
    }
    ctx.restore();
  }, [nodes, edges, hoveredNode, highlightNode, offset, scale]);

  const findNodeAt = useCallback((cx: number, cy: number) => {
    const x = (cx - offset.x) / scale;
    const y = (cy - offset.y) / scale;
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i];
      const dx = n.x - x;
      const dy = n.y - y;
      if (dx * dx + dy * dy < n.radius * n.radius) return n;
    }
    return null;
  }, [offset, scale]);

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (dragNode) {
      const n = nodesRef.current.find(n => n.id === dragNode);
      if (n) {
        n.x = (cx - offset.x) / scale;
        n.y = (cy - offset.y) / scale;
        n.vx = 0;
        n.vy = 0;
        setNodes([...nodesRef.current]);
      }
    } else {
      const node = findNodeAt(cx, cy);
      setHoveredNode(node?.id || null);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const node = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (node) setDragNode(node.id);
  };

  const handleMouseUp = () => {
    if (dragNode && hoveredNode === dragNode && onNodeClick) {
      onNodeClick(dragNode);
    }
    setDragNode(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(s => Math.max(0.3, Math.min(3, s * delta)));
  };

  if (loading) return <div className="skill-tree-loading">Loading skill tree...</div>;
  if (nodes.length === 0) return <div className="skill-tree-empty">No SOPs found</div>;

  return (
    <div className="skill-tree-container">
      <canvas
        ref={canvasRef}
        width={600}
        height={400}
        className="skill-tree-canvas"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setDragNode(null); setHoveredNode(null); }}
        onWheel={handleWheel}
        style={{ cursor: dragNode ? 'grabbing' : hoveredNode ? 'pointer' : 'default' }}
      />
      <div className="skill-tree-legend">
        <span><i style={{ background: NODE_COLORS.sop }} /> SOP</span>
        <span><i style={{ background: NODE_COLORS.script }} /> Script</span>
        <span><i style={{ background: NODE_COLORS.index }} /> Index</span>
        <span><i style={{ background: NODE_COLORS.data }} /> Data</span>
      </div>
      {hoveredNode && (
        <div className="skill-tree-tooltip">
          {nodes.find(n => n.id === hoveredNode)?.id} (used: {nodes.find(n => n.id === hoveredNode)?.accessCount || 0}x)
        </div>
      )}
    </div>
  );
}
