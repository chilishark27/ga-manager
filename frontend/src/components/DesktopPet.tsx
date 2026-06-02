import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';

interface PetAction {
  images: string;
  frames: number;
  interval: number;
  need_move?: boolean;
  direction?: string;
  frame_move?: number;
}

interface PetInfo {
  id: string;
  name: string;
  folder: string;
  actions: Record<string, PetAction>;
}

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
  const [pets, setPets] = useState<PetInfo[]>([]);
  const [petIdx, setPetIdx] = useState(0);
  const [showSelector, setShowSelector] = useState(false);
  const [position, setPosition] = useState<Position>(() => {
    const saved = localStorage.getItem('ga_pet_pos');
    if (saved) return JSON.parse(saved);
    return { x: window.innerWidth - 150, y: window.innerHeight - 140 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [action, setAction] = useState('default');
  const [frameIdx, setFrameIdx] = useState(0);
  const [bubble, setBubble] = useState<string | null>(null);
  const [clickAnim, setClickAnim] = useState(false);
  const dragOffset = useRef<Position>({ x: 0, y: 0 });
  const actionTimer = useRef<ReturnType<typeof setInterval>>();
  const bubbleTimer = useRef<ReturnType<typeof setTimeout>>();

  const activeInstance = instances.find(i => i.id === activeInstanceId);
  const hasStreamingMsg = messages.some(m => m.status === 'streaming');
  const isWorking = activeInstance?.status === 'busy' || hasStreamingMsg;

  // Load pets from API
  useEffect(() => {
    fetch('/api/pets')
      .then(r => r.ok ? r.json() : [])
      .then((data: PetInfo[]) => {
        if (data.length > 0) {
          setPets(data);
          const savedId = localStorage.getItem('ga_pet_id');
          const idx = data.findIndex(p => p.id === savedId);
          setPetIdx(idx >= 0 ? idx : 0);
        }
      })
      .catch(() => {});
  }, []);

  const pet = pets[petIdx];

  useEffect(() => {
    if (pet) localStorage.setItem('ga_pet_id', pet.id);
  }, [pet]);
  useEffect(() => {
    if (!isDragging) localStorage.setItem('ga_pet_pos', JSON.stringify(position));
  }, [position, isDragging]);

  // Frame animation loop
  useEffect(() => {
    if (!pet) return;
    const act = pet.actions[action] || pet.actions.default || Object.values(pet.actions)[0];
    if (!act) return;
    actionTimer.current = setInterval(() => {
      setFrameIdx(prev => {
        const next = (prev + 1) % act.frames;
        if (act.need_move) {
          const move = act.frame_move || 3;
          const dir = act.direction === 'left' ? -move : move;
          setPosition(p => {
            const newX = p.x + dir;
            if (newX < 20 || newX > window.innerWidth - 150) {
              setAction('default');
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

  // Auto behavior
  useEffect(() => {
    if (!pet || isDragging || isWorking) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const loop = () => {
      if (cancelled) return;
      timer = setTimeout(() => {
        if (cancelled) return;
        const rand = Math.random();
        if (rand < 0.25 && pet.actions.left_walk) {
          setAction('left_walk');
          timer = setTimeout(() => { if (!cancelled) { setAction('default'); loop(); } }, 3000);
        } else if (rand < 0.5 && pet.actions.right_walk) {
          setAction('right_walk');
          timer = setTimeout(() => { if (!cancelled) { setAction('default'); loop(); } }, 3000);
        } else if (rand < 0.65 && pet.actions.sleep) {
          setAction('sleep');
          timer = setTimeout(() => { if (!cancelled) { setAction('default'); loop(); } }, 5000);
        } else {
          setAction('default');
          loop();
        }
      }, 3000 + Math.random() * 4000);
    };

    setAction('default');
    setFrameIdx(0);
    loop();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isDragging, isWorking, petIdx, pet]);

  useEffect(() => {
    if (isWorking && pet?.actions?.work) setAction('work');
    else if (!isWorking && action === 'work') setAction('default');
  }, [isWorking]);

  const handleClick = () => {
    if (!pet) return;
    const dialogues = lang === 'zh' ? CLICK_DIALOGUES_ZH : CLICK_DIALOGUES_EN;
    setBubble(dialogues[Math.floor(Math.random() * dialogues.length)]);
    clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), 2500);
    setClickAnim(true);
    setTimeout(() => setClickAnim(false), 400);

    const patpat = pet.actions.patpat || pet.actions.patpat_1 || pet.actions.patpat_2;
    if (patpat) {
      const key = pet.actions.patpat ? 'patpat' : pet.actions.patpat_1 ? 'patpat_1' : 'patpat_2';
      setAction(key);
      setFrameIdx(0);
      setTimeout(() => setAction('default'), 2000);
    }
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!pet) return;
    e.preventDefault();
    setIsDragging(true);
    if (pet.actions.drag) { setAction('drag'); setFrameIdx(0); }
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [position, pet]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 130, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 130, e.clientY - dragOffset.current.y)),
      });
    };
    const handleUp = () => {
      setIsDragging(false);
      if (pet?.actions.fall) {
        setAction('fall');
        setFrameIdx(0);
        setTimeout(() => {
          if (pet?.actions.onfloor) {
            setAction('onfloor');
            setTimeout(() => setAction('default'), 1500);
          } else {
            setAction('default');
          }
        }, 800);
      } else {
        setAction('default');
      }
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [isDragging, pet]);

  if (!pet) return null;

  const currentAction = pet.actions[action] || pet.actions.default || Object.values(pet.actions)[0];
  const frameSrc = `${pet.folder}/action/${currentAction.images}_${frameIdx % currentAction.frames}.png`;

  return (
    <>
      <div
        className={`desktop-pet ${isWorking ? 'working' : 'idle'} ${clickAnim ? 'pet-clicked' : ''}`}
        style={{ left: position.x, top: position.y, bottom: 'auto' }}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onContextMenu={(e) => { e.preventDefault(); setShowSelector(s => !s); }}
      >
        {bubble && <div className="pet-bubble">{bubble}</div>}
        <div className="desktop-pet-container">
          <img src={frameSrc} alt={pet.name} className="desktop-pet-img" draggable={false}
            onError={(e) => {
              const def = pet.actions.default || Object.values(pet.actions)[0];
              (e.target as HTMLImageElement).src = `${pet.folder}/action/${def.images}_0.png`;
            }} />
          <div className={`desktop-pet-status ${isWorking ? 'working' : 'idle'}`} />
        </div>
        <div className="desktop-pet-name">{pet.name}</div>
      </div>

      {showSelector && (
        <div className="pet-selector" onClick={e => e.stopPropagation()}>
          {pets.map((p, idx) => {
            const defAct = p.actions.default || Object.values(p.actions)[0];
            return (
              <div
                key={p.id}
                className={`pet-option ${petIdx === idx ? 'active' : ''}`}
                onClick={() => { setPetIdx(idx); setShowSelector(false); setAction('default'); setFrameIdx(0); }}
                title={p.name}
              >
                <img src={`${p.folder}/action/${defAct.images}_0.png`} alt={p.name} style={{ width: 56, height: 56, objectFit: 'contain', imageRendering: 'pixelated' }} />
                <span style={{ fontSize: 10, color: 'var(--text-2)' }}>{p.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
