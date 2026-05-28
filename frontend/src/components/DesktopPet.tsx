import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';

type PetType = 'dark_knight' | 'shark_chili' | 'sakura_cat' | 'pixel_ghost';
type PetState = 'idle' | 'walking' | 'working';

interface Position { x: number; y: number; }

const PET_NAMES: Record<PetType, string> = {
  dark_knight: '暗夜骑士',
  shark_chili: '鲨鱼辣椒',
  sakura_cat: '樱花猫',
  pixel_ghost: '像素幽灵',
};

function DarkKnightSVG({ state }: { state: PetState }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g className="pet-body">
        <ellipse cx="32" cy="44" rx="16" ry="14" fill="#2a2a3e" stroke="#1a1a2e" strokeWidth="1"/>
        <path d="M20 38 L16 56 Q32 60 48 56 L44 38" fill="#1a1a2e" opacity="0.7"/>
        <circle cx="32" cy="28" r="13" fill="#3d3d5c" stroke="#2a2a3e" strokeWidth="1.5"/>
        <path d="M22 24 Q32 16 42 24 L41 30 Q32 33 23 30 Z" fill="#4a4a6a"/>
        <rect x="24" y="26" width="16" height="5" rx="2.5" fill="#d4729a" opacity="0.85">
          {state === 'working' && <animate attributeName="opacity" values="0.85;1;0.6;1;0.85" dur="1.2s" repeatCount="indefinite"/>}
        </rect>
        <circle cx="29" cy="28" r="1.5" fill="#fff" opacity="0.9">
          {state === 'idle' && <animate attributeName="r" values="1.5;0.4;1.5" dur="3.5s" repeatCount="indefinite"/>}
        </circle>
        <circle cx="35" cy="28" r="1.5" fill="#fff" opacity="0.9">
          {state === 'idle' && <animate attributeName="r" values="1.5;0.4;1.5" dur="3.5s" repeatCount="indefinite"/>}
        </circle>
        <path d="M46 20 L48 8 L50 20" fill="#b0b0cc" stroke="#8888aa" strokeWidth="0.5"/>
        <rect x="47" y="8" width="2" height="3" rx="1" fill="#d4729a"/>
        <path d="M19 22 L17 18 L21 20 Z" fill="#3d3d5c"/>
        <path d="M43 20 L47 18 L45 22 Z" fill="#3d3d5c"/>
      </g>
    </svg>
  );
}

function SharkChiliSVG({ state }: { state: PetState }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g className="pet-body">
        <ellipse cx="32" cy="34" rx="18" ry="13" fill="#5ba3e6" stroke="#3a7bc8" strokeWidth="1"/>
        <ellipse cx="32" cy="37" rx="11" ry="8" fill="#e8f4ff" opacity="0.9"/>
        <path d="M30 21 L32 14 L34 21 Z" fill="#3a7bc8" stroke="#2d6db5" strokeWidth="0.5"/>
        <path d="M48 32 L58 27 L56 34 L58 41 L48 36 Z" fill="#3a7bc8">
          {state !== 'working' && <animate attributeName="d" values="M48 32 L58 27 L56 34 L58 41 L48 36 Z;M48 32 L60 25 L58 34 L60 43 L48 36 Z;M48 32 L58 27 L56 34 L58 41 L48 36 Z" dur="1.8s" repeatCount="indefinite"/>}
        </path>
        <circle cx="26" cy="32" r="3.5" fill="#fff" stroke="#e8e8f0" strokeWidth="0.5"/>
        <circle cx="26" cy="32" r="2" fill="#1a1a2e">
          {state === 'idle' && <animate attributeName="cx" values="26;27;26;25;26" dur="4s" repeatCount="indefinite"/>}
        </circle>
        <circle cx="38" cy="32" r="3.5" fill="#fff" stroke="#e8e8f0" strokeWidth="0.5"/>
        <circle cx="38" cy="32" r="2" fill="#1a1a2e">
          {state === 'idle' && <animate attributeName="cx" values="38;39;38;37;38" dur="4s" repeatCount="indefinite"/>}
        </circle>
        <path d="M28 40 Q32 43 36 40" stroke="#1a1a2e" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        <path d="M29 40 L30 41.5 L31 40 M33 40 L34 41.5 L35 40" fill="#fff" stroke="#fff" strokeWidth="0.3"/>
        <path d="M22 22 Q26 16 30 18 Q31 14 28 11" fill="#e74c3c" stroke="#c0392b" strokeWidth="0.5"/>
        <circle cx="27.5" cy="11" r="1.5" fill="#27ae60"/>
        {state === 'working' && (
          <g>
            <ellipse cx="18" cy="38" rx="3" ry="2.5" fill="#ff6b35" opacity="0.7">
              <animate attributeName="rx" values="3;5;3" dur="0.6s" repeatCount="indefinite"/>
            </ellipse>
            <ellipse cx="15" cy="38" rx="2" ry="1.5" fill="#ffd700" opacity="0.5">
              <animate attributeName="rx" values="2;4;2" dur="0.5s" repeatCount="indefinite"/>
            </ellipse>
          </g>
        )}
      </g>
    </svg>
  );
}

function SakuraCatSVG({ state }: { state: PetState }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g className="pet-body">
        <ellipse cx="32" cy="44" rx="13" ry="11" fill="#fce4ec" stroke="#f8bbd0" strokeWidth="1"/>
        <circle cx="32" cy="28" r="14" fill="#fce4ec" stroke="#f8bbd0" strokeWidth="1"/>
        <path d="M21 18 L23 8 L28 16 Z" fill="#fce4ec" stroke="#f8bbd0" strokeWidth="0.8"/>
        <path d="M23 14 L24 10 L27 15 Z" fill="#f48fb1" opacity="0.4"/>
        <path d="M36 16 L41 8 L43 18 Z" fill="#fce4ec" stroke="#f8bbd0" strokeWidth="0.8"/>
        <path d="M38 15 L40 10 L42 16 Z" fill="#f48fb1" opacity="0.4"/>
        <ellipse cx="27" cy="27" rx="2.5" ry="3" fill="#37474f">
          {state === 'idle' && <animate attributeName="ry" values="3;0.5;3" dur="4s" repeatCount="indefinite"/>}
        </ellipse>
        <ellipse cx="37" cy="27" rx="2.5" ry="3" fill="#37474f">
          {state === 'idle' && <animate attributeName="ry" values="3;0.5;3" dur="4s" repeatCount="indefinite"/>}
        </ellipse>
        <circle cx="26" cy="26" r="1" fill="#fff" opacity="0.8"/>
        <circle cx="36" cy="26" r="1" fill="#fff" opacity="0.8"/>
        <ellipse cx="23" cy="32" rx="3" ry="1.5" fill="#f48fb1" opacity="0.3"/>
        <ellipse cx="41" cy="32" rx="3" ry="1.5" fill="#f48fb1" opacity="0.3"/>
        <ellipse cx="32" cy="30" rx="1.5" ry="1" fill="#f48fb1"/>
        <path d="M29 32 Q32 34 35 32" stroke="#795548" strokeWidth="0.8" fill="none" strokeLinecap="round"/>
        <line x1="16" y1="28" x2="24" y2="29" stroke="#bdbdbd" strokeWidth="0.5" strokeLinecap="round"/>
        <line x1="16" y1="31" x2="24" y2="31" stroke="#bdbdbd" strokeWidth="0.5" strokeLinecap="round"/>
        <line x1="40" y1="29" x2="48" y2="28" stroke="#bdbdbd" strokeWidth="0.5" strokeLinecap="round"/>
        <line x1="40" y1="31" x2="48" y2="31" stroke="#bdbdbd" strokeWidth="0.5" strokeLinecap="round"/>
        <path d="M44 44 Q50 38 48 32 Q47 28 50 26" stroke="#fce4ec" strokeWidth="3.5" fill="none" strokeLinecap="round">
          {state === 'idle' && <animate attributeName="d" values="M44 44 Q50 38 48 32 Q47 28 50 26;M44 44 Q52 40 50 34 Q49 30 52 28;M44 44 Q50 38 48 32 Q47 28 50 26" dur="3s" repeatCount="indefinite"/>}
        </path>
        <g transform="translate(38,14)">
          <circle cx="0" cy="0" r="2" fill="#ffcdd2"/>
          <circle cx="1.8" cy="-1.5" r="2" fill="#ffcdd2"/>
          <circle cx="-1.5" cy="-1.5" r="2" fill="#ffcdd2"/>
          <circle cx="0" cy="-0.8" r="1.2" fill="#fff9c4" opacity="0.6"/>
        </g>
        {state === 'working' && (
          <g>
            <rect x="22" y="46" width="20" height="12" rx="2" fill="#455a64" stroke="#37474f" strokeWidth="0.5"/>
            <rect x="24" y="48" width="16" height="8" rx="1" fill="#4fc3f7" opacity="0.6">
              <animate attributeName="opacity" values="0.6;0.9;0.6" dur="1.5s" repeatCount="indefinite"/>
            </rect>
          </g>
        )}
      </g>
    </svg>
  );
}

function PixelGhostSVG({ state }: { state: PetState }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g className="pet-body">
        <path d="M20 34 Q20 16 32 16 Q44 16 44 34 L44 50 L41 47 L38 50 L35 47 L32 50 L29 47 L26 50 L23 47 L20 50 Z" fill="#b39ddb" stroke="#9575cd" strokeWidth="1" opacity="0.85">
          {state === 'idle' && <animate attributeName="opacity" values="0.85;0.6;0.85" dur="3.5s" repeatCount="indefinite"/>}
        </path>
        <path d="M24 34 Q24 20 32 20 Q40 20 40 34 L40 46 L38 44 L36 46 L34 44 L32 46 L30 44 L28 46 L26 44 L24 46 Z" fill="#d1c4e9" opacity="0.5"/>
        <circle cx="28" cy="32" r="3.5" fill="#fff" stroke="#ede7f6" strokeWidth="0.5"/>
        <circle cx="36" cy="32" r="3.5" fill="#fff" stroke="#ede7f6" strokeWidth="0.5"/>
        <circle cx="28.5" cy="32.5" r="2" fill="#311b92">
          {state === 'idle' && <animate attributeName="cy" values="32.5;31.5;32.5;33.5;32.5" dur="3s" repeatCount="indefinite"/>}
        </circle>
        <circle cx="36.5" cy="32.5" r="2" fill="#311b92">
          {state === 'idle' && <animate attributeName="cy" values="32.5;31.5;32.5;33.5;32.5" dur="3s" repeatCount="indefinite"/>}
        </circle>
        <ellipse cx="25" cy="37" rx="2.5" ry="1.5" fill="#f48fb1" opacity="0.35"/>
        <ellipse cx="39" cy="37" rx="2.5" ry="1.5" fill="#f48fb1" opacity="0.35"/>
        <path d="M30 39 Q32 41 34 39" stroke="#7c4dff" strokeWidth="1" fill="none" strokeLinecap="round"/>
        {state === 'working' && (
          <ellipse cx="32" cy="14" rx="8" ry="2.5" fill="none" stroke="#ffd54f" strokeWidth="1.5" opacity="0.7">
            <animate attributeName="opacity" values="0.7;1;0.7" dur="1.5s" repeatCount="indefinite"/>
          </ellipse>
        )}
        {state === 'idle' && (
          <g>
            <circle cx="15" cy="24" r="1.2" fill="#ffd54f" opacity="0.5">
              <animate attributeName="opacity" values="0.5;0;0.5" dur="2.5s" repeatCount="indefinite"/>
            </circle>
            <circle cx="49" cy="28" r="1" fill="#ffd54f" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0;0.4" dur="3s" repeatCount="indefinite"/>
            </circle>
            <circle cx="47" cy="20" r="1.2" fill="#ce93d8" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite"/>
            </circle>
          </g>
        )}
      </g>
    </svg>
  );
}

const PET_COMPONENTS: Record<PetType, React.FC<{ state: PetState }>> = {
  dark_knight: DarkKnightSVG,
  shark_chili: SharkChiliSVG,
  sakura_cat: SakuraCatSVG,
  pixel_ghost: PixelGhostSVG,
};

export default function DesktopPet() {
  const { instances, activeInstanceId, messages } = useStore();
  const [petType, setPetType] = useState<PetType>(() => {
    return (localStorage.getItem('ga_pet_type') as PetType) || 'shark_chili';
  });
  const [showSelector, setShowSelector] = useState(false);
  const [position, setPosition] = useState<Position>(() => {
    const saved = localStorage.getItem('ga_pet_pos');
    if (saved) return JSON.parse(saved);
    return { x: window.innerWidth / 2 - 40, y: window.innerHeight - 100 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef<Position>({ x: 0, y: 0 });
  const petRef = useRef<HTMLDivElement>(null);
  const walkTimer = useRef<ReturnType<typeof setInterval>>();
  const [direction, setDirection] = useState(1);

  const activeInstance = instances.find(i => i.id === activeInstanceId);
  const hasStreamingMsg = messages.some(m => m.status === 'streaming');
  const isWorking = activeInstance?.status === 'busy' || hasStreamingMsg;

  const petState: PetState = isWorking ? 'working' : 'idle';

  useEffect(() => {
    localStorage.setItem('ga_pet_type', petType);
  }, [petType]);

  useEffect(() => {
    if (!isDragging) {
      localStorage.setItem('ga_pet_pos', JSON.stringify(position));
    }
  }, [position, isDragging]);

  // Free roam when idle
  useEffect(() => {
    if (petState === 'idle' && !isDragging) {
      walkTimer.current = setInterval(() => {
        setPosition(prev => {
          const newDir = Math.random() > 0.3 ? direction : -direction;
          setDirection(newDir);
          const step = (Math.random() * 20 + 10) * newDir;
          const newX = Math.max(20, Math.min(window.innerWidth - 100, prev.x + step));
          return { ...prev, x: newX };
        });
      }, 3000);
      return () => clearInterval(walkTimer.current);
    } else {
      clearInterval(walkTimer.current);
    }
  }, [petState, isDragging, direction]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 80, e.clientY - dragOffset.current.y)),
      });
    };
    const handleUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [isDragging]);

  const handleDoubleClick = () => setShowSelector(s => !s);

  const PetSVG = PET_COMPONENTS[petType];

  return (
    <>
      <div
        ref={petRef}
        className={`desktop-pet ${petState}`}
        style={{ left: position.x, top: position.y, bottom: 'auto', transform: direction < 0 ? 'scaleX(-1)' : 'none' }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <div className="desktop-pet-container">
          <PetSVG state={petState} />
          <div className={`desktop-pet-status ${petState}`} />
        </div>
        <div className="desktop-pet-name" style={{ transform: direction < 0 ? 'scaleX(-1) translateX(50%)' : 'translateX(-50%)' }}>
          {PET_NAMES[petType]}
        </div>
      </div>

      {showSelector && (
        <div className="pet-selector" onClick={e => e.stopPropagation()}>
          {(Object.keys(PET_COMPONENTS) as PetType[]).map(type => {
            const Comp = PET_COMPONENTS[type];
            return (
              <div
                key={type}
                className={`pet-option ${petType === type ? 'active' : ''}`}
                onClick={() => { setPetType(type); setShowSelector(false); }}
                title={PET_NAMES[type]}
              >
                <Comp state="idle" />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
