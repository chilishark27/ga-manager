import { useEffect, useState, useRef } from 'react';

interface SkillNode { id: string; label: string; type: string; accessCount: number; lastAccess: string; size: number; }
interface SkillEdge { from: string; to: string; type: string; }
interface Props { onNodeClick?: (nodeId: string) => void; highlightNode?: string | null; }
interface SimNode extends SkillNode { x: number; y: number; radius: number; }

const NODE_COLORS: Record<string, string> = { sop: '#4A9EFF', script: '#52C41A', index: '#FAAD14', data: '#8C8C8C' };

function runSimulation(nodes: SimNode[], edges: SkillEdge[]) {
  for (let iter = 0; iter < 300; iter++) {
    const vx = new Array(nodes.length).fill(0);
    const vy = new Array(nodes.length).fill(0);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const f = 2000 / (dist * dist);
        vx[i] += (dx / dist) * f; vy[i] += (dy / dist) * f;
        vx[j] -= (dx / dist) * f; vy[j] -= (dy / dist) * f;
      }
      for (const e of edges) {
        let other: SimNode | undefined;
        if (e.from === nodes[i].id) other = nodes.find(n => n.id === e.to);
        else if (e.to === nodes[i].id) other = nodes.find(n => n.id === e.from);
        if (other) {
          const dx = other.x - nodes[i].x, dy = other.y - nodes[i].y;
          const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const f = (dist - 100) * 0.01;
          vx[i] += (dx / dist) * f; vy[i] += (dy / dist) * f;
        }
      }
      vx[i] += -nodes[i].x * 0.001; vy[i] += -nodes[i].y * 0.001;
    }
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].x += vx[i] * 0.9; nodes[i].y += vy[i] * 0.9;
    }
  }
}

export default function SkillTree({ onNodeClick, highlightNode }: Props) {
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [edges, setEdges] = useState<SkillEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    fetch('/api/skilltree').then(r => r.json()).then(data => {
      const rawNodes: SkillNode[] = data.nodes || [];
      const rawEdges: SkillEdge[] = data.edges || [];
      if (rawNodes.length === 0) { setLoading(false); return; }
      const simNodes: SimNode[] = rawNodes.map((n, i) => ({
        ...n,
        x: Math.cos(i * 2.4) * 200 + (Math.random() - 0.5) * 80,
        y: Math.sin(i * 2.4) * 200 + (Math.random() - 0.5) * 80,
        radius: Math.max(8, Math.min(24, 8 + (n.accessCount || 0) * 0.5)),
      }));
      runSimulation(simNodes, rawEdges);
      setNodes(simNodes);
      setEdges(rawEdges);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const toSvg = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 800 - 400;
    const y = ((e.clientY - rect.top) / rect.height) * 600 - 300;
    return { x, y };
  };

  const handleMouseDown = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    const pt = toSvg(e);
    dragOffset.current = { x: pt.x - node.x, y: pt.y - node.y };
    setDragging(id);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    const pt = toSvg(e);
    setNodes(prev => prev.map(n => n.id === dragging ? { ...n, x: pt.x - dragOffset.current.x, y: pt.y - dragOffset.current.y } : n));
  };

  const handleMouseUp = () => {
    if (dragging && hovered === dragging && onNodeClick) onNodeClick(dragging);
    setDragging(null);
  };

  if (loading) return <div className="skill-tree-loading">Loading skill tree...</div>;
  if (nodes.length === 0) return <div className="skill-tree-empty">No SOPs found</div>;

  return (
    <div className="skill-tree-container">
      <svg ref={svgRef} className="skill-tree-canvas" viewBox="-400 -300 800 600" preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        {edges.map((e, i) => {
          const from = nodes.find(n => n.id === e.from);
          const to = nodes.find(n => n.id === e.to);
          if (!from || !to) return null;
          return <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke={e.type === 'import' ? 'rgba(82,196,26,0.5)' : 'rgba(74,158,255,0.4)'}
            strokeWidth={e.type === 'import' ? 1.5 : 1}
            strokeDasharray={e.type === 'reference' ? '4 4' : undefined} />;
        })}
        {nodes.map(n => {
          const color = NODE_COLORS[n.type] || NODE_COLORS.data;
          const isActive = n.id === hovered || n.id === highlightNode;
          return (
            <g key={n.id} onMouseDown={(e) => handleMouseDown(n.id, e)}
              onMouseEnter={() => setHovered(n.id)} onMouseLeave={() => setHovered(null)}
              style={{ cursor: dragging === n.id ? 'grabbing' : 'pointer' }}>
              <circle cx={n.x} cy={n.y} r={n.radius} fill={color} opacity={isActive ? 1 : 0.8}
                stroke={isActive ? '#fff' : 'none'} strokeWidth={isActive ? 2 : 0} />
              <text x={n.x} y={n.y + n.radius + 12} textAnchor="middle"
                fontSize={isActive ? 10 : 8} fill="var(--text-2)">{n.label.slice(0, 18)}</text>
            </g>
          );
        })}
      </svg>
      <div className="skill-tree-legend">
        <span><i style={{ background: NODE_COLORS.sop }} /> SOP</span>
        <span><i style={{ background: NODE_COLORS.script }} /> Script</span>
        <span><i style={{ background: NODE_COLORS.index }} /> Index</span>
        <span><i style={{ background: NODE_COLORS.data }} /> Data</span>
      </div>
    </div>
  );
}