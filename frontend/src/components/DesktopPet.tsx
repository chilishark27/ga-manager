import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';

interface PetConfig {
  name: string;
  folder: string;
  actions: Record<string, { prefix: string; frames: number; interval: number; move?: number; direction?: 'left' | 'right' }>;
}

const PETS: PetConfig[] = [
  {
    name: 'Kitty',
    folder: '/pets/kitty',
    actions: {
      stand: { prefix: 'stand', frames: 5, interval: 300 },
      left_walk: { prefix: 'leftwalk', frames: 4, interval: 200, move: -3, direction: 'left' },
      right_walk: { prefix: 'rightwalk', frames: 4, interval: 200, move: 3, direction: 'right' },
      drag: { prefix: 'drag', frames: 1, interval: 200 },
      fall: { prefix: 'fall', frames: 1, interval: 200 },
      angry: { prefix: 'angry', frames: 1, interval: 500 },
      sleep: { prefix: 'sleep', frames: 4, interval: 500 },
    },
  },
  {
    name: 'ChrisKitty',
    folder: '/pets/chriskitty',
    actions: {
      stand: { prefix: 'stand', frames: 5, interval: 300 },
      drag: { prefix: 'drag', frames: 1, interval: 200 },
      fall: { prefix: 'fall', frames: 1, interval: 200 },
      angry: { prefix: 'onfloor', frames: 8, interval: 150 },
    },
  },
  { name: '纳西妲', folder: '/pets', actions: { stand: { prefix: 'nahida', frames: 1, interval: 1000 } } },
  { name: '小呆', folder: '/pets', actions: { stand: { prefix: 'xiao_dai', frames: 1, interval: 1000 } } },
  { name: '魈', folder: '/pets', actions: { stand: { prefix: 'xiao', frames: 1, interval: 1000 } } },
  { name: '流浪者', folder: '/pets', actions: { stand: { prefix: 'wanderer', frames: 1, interval: 1000 } } },
  { name: '流萤', folder: '/pets', actions: { stand: { prefix: 'firefly', frames: 1, interval: 1000 } } },
  { name: '露西亚', folder: '/pets', actions: { stand: { prefix: 'lucia', frames: 1, interval: 1000 } } },
  { name: '守岸人', folder: '/pets', actions: { stand: { prefix: 'shorekeeper', frames: 1, interval: 1000 } } },
  { name: '椿', folder: '/pets', actions: { stand: { prefix: 'chun', frames: 1, interval: 1000 } } },
  { name: '饮月', folder: '/pets', actions: { stand: { prefix: 'yinyue', frames: 1, interval: 1000 } } },
  { name: '像素猫', folder: '/pets', actions: { stand: { prefix: 'pixel_cat', frames: 1, interval: 1000 } } },
  { name: '像素四妹', folder: '/pets', actions: { stand: { prefix: 'pixel_simei', frames: 1, interval: 1000 } } },
  { name: '派蒙', folder: '/pets', actions: { stand: { prefix: 'paimon', frames: 1, interval: 1000 } } },
  { name: '兰纳罗', folder: '/pets', actions: { stand: { prefix: 'lanaluo', frames: 1, interval: 1000 } } },
  { name: '皮克啾', folder: '/pets', actions: { stand: { prefix: 'pikeqiu', frames: 1, interval: 1000 } } },
];

const CLICK_DIALOGUES = [
  '喵~', '别戳我！', '嗯？', '想我了？', '(´・ω・`)', '有什么事吗~',
  '好无聊啊...', '陪我玩！', '哼！', '摸摸头~', '٩(◕‿◕｡)۶',
  '在忙呢...', '嘿嘿~', '(｡◕‿◕｡)', '干嘛啦~', '好痒！',
];

interface Position { x: number; y: number; }

export default function DesktopPet() {
  const { instances, activeInstanceId, messages } = useStore();
  const [petIdx, setPetIdx] = useState(() => {
    const saved = parseInt(localStorage.getItem('ga_pet_idx') || '0');
    return saved < PETS.length ? saved : 0;
  });
  const [showSelector, setShowSelector] = useState(false);
  const [position, setPosition] = useState<Position>(() => {
    const saved = localStorage.getItem('ga_pet_pos');
    if (saved) return JSON.parse(saved);
    return { x: window.innerWidth - 150, y: window.innerHeight - 140 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [action, setAction] = useState('stand');
  const [frameIdx, setFrameIdx] = useState(0);
  const [bubble, setBubble] = useState<string | null>(null);
  const [clickAnim, setClickAnim] = useState(false);
  const dragOffset = useRef<Position>({ x: 0, y: 0 });
  const actionTimer = useRef<ReturnType<typeof setInterval>>();
  const autoTimer = useRef<ReturnType<typeof setTimeout>>();
  const bubbleTimer = useRef<ReturnType<typeof setTimeout>>();

  const pet = PETS[petIdx];
  const activeInstance = instances.find(i => i.id === activeInstanceId);
  const hasStreamingMsg = messages.some(m => m.status === 'streaming');
  const isWorking = activeInstance?.status === 'busy' || hasStreamingMsg;

  useEffect(() => { localStorage.setItem('ga_pet_idx', String(petIdx)); }, [petIdx]);
  useEffect(() => { if (!isDragging) localStorage.setItem('ga_pet_pos', JSON.stringify(position)); }, [position, isDragging]);

  useEffect(() => {
    const act = pet.actions[action] || pet.actions.stand;
    actionTimer.current = setInterval(() => {
      setFrameIdx(prev => {
        const next = (prev + 1) % act.frames;
        if (act.move) {
          setPosition(p => {
            const newX = p.x + act.move!;
            if (newX < 20 || newX > window.innerWidth - 120) {
              setAction('stand');
              return p;
            }
            return { ...p, x: newX };
          });
        }
        return next;
      });
    }, act.interval);
    return () => clearInterval(actionTimer.current);
  }, [action, pet]);

  useEffect(() => {
    if (isDragging || isWorking) return;
    const scheduleNext = () => {
      autoTimer.current = setTimeout(() => {
        const rand = Math.random();
        if (rand < 0.3 && pet.actions.left_walk) {
          setAction('left_walk');
          setTimeout(() => { setAction('stand'); scheduleNext(); }, 3000);
        } else if (rand < 0.6 && pet.actions.right_walk) {
          setAction('right_walk');
          setTimeout(() => { setAction('stand'); scheduleNext(); }, 3000);
        } else if (rand < 0.75 && pet.actions.sleep) {
          setAction('sleep');
          setTimeout(() => { setAction('stand'); scheduleNext(); }, 5000);
        } else {
          setAction('stand');
          scheduleNext();
        }
      }, 3000 + Math.random() * 4000);
    };
    setAction('stand');
    scheduleNext();
    return () => clearTimeout(autoTimer.current);
  }, [isDragging, isWorking, pet]);

  useEffect(() => {
    if (isWorking) setAction('stand');
  }, [isWorking]);

  const handleClick = () => {
    // Random dialogue bubble
    const msg = CLICK_DIALOGUES[Math.floor(Math.random() * CLICK_DIALOGUES.length)];
    setBubble(msg);
    clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), 2500);

    // Bounce animation
    setClickAnim(true);
    setTimeout(() => setClickAnim(false), 400);

    // Play angry/reaction if available
    if (pet.actions.angry) {
      setAction('angry');
      setFrameIdx(0);
      setTimeout(() => setAction('stand'), 2000);
    }
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setAction('drag');
    setFrameIdx(0);
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.current.y)),
      });
    };
    const handleUp = () => {
      setIsDragging(false);
      if (pet.actions.fall) {
        setAction('fall');
        setFrameIdx(0);
        setTimeout(() => setAction('stand'), 800);
      } else {
        setAction('stand');
      }
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [isDragging, pet]);

  const currentAction = pet.actions[action] || pet.actions.stand;
  const frameSrc = currentAction.frames === 1 && !currentAction.prefix.includes('walk')
    ? `${pet.folder}/${currentAction.prefix}.png`
    : `${pet.folder}/${currentAction.prefix}_${frameIdx % currentAction.frames}.png`;

  return (
    <>
      <div
        className={`desktop-pet ${isWorking ? 'working' : 'idle'} ${clickAnim ? 'pet-clicked' : ''}`}
        style={{ left: position.x, top: position.y, bottom: 'auto' }}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onDoubleClick={() => setShowSelector(s => !s)}
      >
        {bubble && <div className="pet-bubble">{bubble}</div>}
        <div className="desktop-pet-container">
          <img src={frameSrc} alt={pet.name} className="desktop-pet-img" draggable={false} />
          <div className={`desktop-pet-status ${isWorking ? 'working' : 'idle'}`} />
        </div>
        <div className="desktop-pet-name">{pet.name}</div>
      </div>

      {showSelector && (
        <div className="pet-selector" onClick={e => e.stopPropagation()}>
          {PETS.map((p, idx) => (
            <div
              key={p.name}
              className={`pet-option ${petIdx === idx ? 'active' : ''}`}
              onClick={() => { setPetIdx(idx); setShowSelector(false); setAction('stand'); setFrameIdx(0); }}
              title={p.name}
            >
              <img src={p.actions.stand.frames === 1 ? `${p.folder}/${p.actions.stand.prefix}.png` : `${p.folder}/${p.actions.stand.prefix}_0.png`} alt={p.name} style={{ width: 40, height: 40, objectFit: 'contain', imageRendering: 'pixelated' }} />
              <span style={{ fontSize: 10, color: 'var(--text-2)' }}>{p.name}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}