import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';

interface PetConfig {
  name: string;
  nameZh: string;
  folder: string;
  actions: Record<string, { prefix: string; frames: number; interval: number; move?: number; direction?: 'left' | 'right' }>;
}

const PETS: PetConfig[] = [
  {
    name: 'Kitty',
    nameZh: '小猫咪',
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
    nameZh: '圣诞猫',
    folder: '/pets/chriskitty',
    actions: {
      stand: { prefix: 'stand', frames: 5, interval: 300 },
      drag: { prefix: 'drag', frames: 1, interval: 200 },
      fall: { prefix: 'fall', frames: 1, interval: 200 },
      angry: { prefix: 'onfloor', frames: 8, interval: 150 },
    },
  },
  { name: 'Nahida', nameZh: '纳西妲', folder: '/pets', actions: { stand: { prefix: 'nahida', frames: 1, interval: 1000 }, left_walk: { prefix: 'nahida', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'nahida', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'nahida', frames: 1, interval: 1000 } } },
  { name: 'Xiao Dai', nameZh: '小呆', folder: '/pets', actions: { stand: { prefix: 'xiao_dai', frames: 1, interval: 1000 }, left_walk: { prefix: 'xiao_dai', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'xiao_dai', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'xiao_dai', frames: 1, interval: 1000 } } },
  { name: 'Xiao', nameZh: '魈', folder: '/pets', actions: { stand: { prefix: 'xiao', frames: 1, interval: 1000 }, left_walk: { prefix: 'xiao', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'xiao', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'xiao', frames: 1, interval: 1000 } } },
  { name: 'Wanderer', nameZh: '流浪者', folder: '/pets', actions: { stand: { prefix: 'wanderer', frames: 1, interval: 1000 }, left_walk: { prefix: 'wanderer', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'wanderer', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'wanderer', frames: 1, interval: 1000 } } },
  { name: 'Firefly', nameZh: '流萤', folder: '/pets', actions: { stand: { prefix: 'firefly', frames: 1, interval: 1000 }, left_walk: { prefix: 'firefly', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'firefly', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'firefly', frames: 1, interval: 1000 } } },
  { name: 'Lucia', nameZh: '露西亚', folder: '/pets', actions: { stand: { prefix: 'lucia', frames: 1, interval: 1000 }, left_walk: { prefix: 'lucia', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'lucia', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'lucia', frames: 1, interval: 1000 } } },
  { name: 'Shore Keeper', nameZh: '守岸人', folder: '/pets', actions: { stand: { prefix: 'shorekeeper', frames: 1, interval: 1000 }, left_walk: { prefix: 'shorekeeper', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'shorekeeper', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'shorekeeper', frames: 1, interval: 1000 } } },
  { name: 'Chun', nameZh: '椿', folder: '/pets', actions: { stand: { prefix: 'chun', frames: 1, interval: 1000 }, left_walk: { prefix: 'chun', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'chun', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'chun', frames: 1, interval: 1000 } } },
  { name: 'Yinyue', nameZh: '饮月', folder: '/pets', actions: { stand: { prefix: 'yinyue', frames: 1, interval: 1000 }, left_walk: { prefix: 'yinyue', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'yinyue', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'yinyue', frames: 1, interval: 1000 } } },
  { name: 'Pixel Cat', nameZh: '像素猫', folder: '/pets', actions: { stand: { prefix: 'pixel_cat', frames: 1, interval: 1000 }, left_walk: { prefix: 'pixel_cat', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'pixel_cat', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'pixel_cat', frames: 1, interval: 1000 } } },
  { name: 'Pixel Simei', nameZh: '像素四妹', folder: '/pets', actions: { stand: { prefix: 'pixel_simei', frames: 1, interval: 1000 }, left_walk: { prefix: 'pixel_simei', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'pixel_simei', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'pixel_simei', frames: 1, interval: 1000 } } },
  { name: 'Paimon', nameZh: '派蒙', folder: '/pets', actions: { stand: { prefix: 'paimon', frames: 1, interval: 1000 }, left_walk: { prefix: 'paimon', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'paimon', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'paimon', frames: 1, interval: 1000 } } },
  { name: 'Lanaluo', nameZh: '兰纳罗', folder: '/pets', actions: { stand: { prefix: 'lanaluo', frames: 1, interval: 1000 }, left_walk: { prefix: 'lanaluo', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'lanaluo', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'lanaluo', frames: 1, interval: 1000 } } },
  { name: 'Pikeqiu', nameZh: '皮克啾', folder: '/pets', actions: { stand: { prefix: 'pikeqiu', frames: 1, interval: 1000 }, left_walk: { prefix: 'pikeqiu', frames: 1, interval: 200, move: -2, direction: 'left' }, right_walk: { prefix: 'pikeqiu', frames: 1, interval: 200, move: 2, direction: 'right' }, sleep: { prefix: 'pikeqiu', frames: 1, interval: 1000 } } },
];

const CLICK_DIALOGUES_ZH = [
  '喵~', '别戳我！', '嗯？', '想我了？', '(´・ω・`)', '有什么事吗~',
  '好无聊啊...', '陪我玩！', '哼！', '摸摸头~', '٩(◕‿◕｡)۶',
  '在忙呢...', '嘿嘿~', '(｡◕‿◕｡)', '干嘛啦~', '好痒！',
];

const CLICK_DIALOGUES_EN = [
  'Meow~', "Don't poke me!", 'Hmm?', 'Miss me?', '(´・ω・`)', "What's up~",
  "So bored...", 'Play with me!', 'Hmph!', 'Pat pat~', '٩(◕‿◕｡)۶',
  "I'm busy...", 'Hehe~', '(｡◕‿◕｡)', 'What~', 'That tickles!',
];

interface Position { x: number; y: number; }

export default function DesktopPet() {
  const { instances, activeInstanceId, messages } = useStore();
  const { lang } = useI18n();
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
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([]);
  const dragOffset = useRef<Position>({ x: 0, y: 0 });
  const actionTimer = useRef<ReturnType<typeof setInterval>>();
  const bubbleTimer = useRef<ReturnType<typeof setTimeout>>();
  const heartId = useRef(0);

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

  // Auto behavior: cycle through actions
  useEffect(() => {
    if (isDragging || isWorking) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const loop = () => {
      if (cancelled) return;
      const delay = 3000 + Math.random() * 4000;
      timer = setTimeout(() => {
        if (cancelled) return;
        const rand = Math.random();
        if (rand < 0.3 && pet.actions.left_walk) {
          setAction('left_walk');
          timer = setTimeout(() => { if (!cancelled) { setAction('stand'); loop(); } }, 3000);
        } else if (rand < 0.6 && pet.actions.right_walk) {
          setAction('right_walk');
          timer = setTimeout(() => { if (!cancelled) { setAction('stand'); loop(); } }, 3000);
        } else if (rand < 0.75 && pet.actions.sleep) {
          setAction('sleep');
          timer = setTimeout(() => { if (!cancelled) { setAction('stand'); loop(); } }, 5000);
        } else {
          setAction('stand');
          loop();
        }
      }, delay);
    };

    setAction('stand');
    setFrameIdx(0);
    loop();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isDragging, isWorking, petIdx]);

  useEffect(() => {
    if (isWorking) setAction('stand');
  }, [isWorking]);

  const handleClick = () => {
    const dialogues = lang === 'zh' ? CLICK_DIALOGUES_ZH : CLICK_DIALOGUES_EN;
    const msg = dialogues[Math.floor(Math.random() * dialogues.length)];
    setBubble(msg);
    clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), 2500);

    setClickAnim(true);
    setTimeout(() => setClickAnim(false), 400);

    // Spawn heart particles
    const newHearts = Array.from({ length: 4 }, () => ({
      id: heartId.current++,
      x: (Math.random() - 0.5) * 60,
      y: -Math.random() * 30 - 10,
    }));
    setHearts(prev => [...prev, ...newHearts]);
    setTimeout(() => setHearts(prev => prev.filter(h => !newHearts.includes(h))), 1000);

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
        data-action={action}
        style={{ left: position.x, top: position.y, bottom: 'auto' }}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onContextMenu={(e) => { e.preventDefault(); setShowSelector(s => !s); }}
      >
        {bubble && <div className="pet-bubble">{bubble}</div>}
        {hearts.map(h => (
          <span key={h.id} className="pet-heart" style={{ left: `calc(50% + ${h.x}px)`, top: `${h.y}px` }}>&#10084;</span>
        ))}
        <div className="desktop-pet-container">
          <img src={frameSrc} alt={lang === 'zh' ? pet.nameZh : pet.name} className="desktop-pet-img" draggable={false}
            onError={(e) => { (e.target as HTMLImageElement).src = `${pet.folder}/${pet.actions.stand.prefix}_0.png`; }} />
          <div className={`desktop-pet-status ${isWorking ? 'working' : 'idle'}`} />
        </div>
        <div className="desktop-pet-name">{lang === 'zh' ? pet.nameZh : pet.name}</div>
      </div>

      {showSelector && (
        <div className="pet-selector" onClick={e => e.stopPropagation()}>
          {PETS.map((p, idx) => (
            <div
              key={p.name}
              className={`pet-option ${petIdx === idx ? 'active' : ''}`}
              onClick={() => { setPetIdx(idx); setShowSelector(false); setAction('stand'); setFrameIdx(0); }}
              title={lang === 'zh' ? p.nameZh : p.name}
            >
              <img src={p.actions.stand.frames === 1 ? `${p.folder}/${p.actions.stand.prefix}.png` : `${p.folder}/${p.actions.stand.prefix}_0.png`} alt={p.name} style={{ width: 56, height: 56, objectFit: 'contain', imageRendering: 'pixelated' }} />
              <span style={{ fontSize: 10, color: 'var(--text-2)' }}>{lang === 'zh' ? p.nameZh : p.name}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}