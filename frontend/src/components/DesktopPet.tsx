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
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g className="pet-body">
        {/* Cape */}
        <path d="M25 35 L20 70 L60 70 L55 35 Z" fill="#1a1a2e" opacity="0.9">
          {state === 'working' && <animate attributeName="d" values="M25 35 L20 70 L60 70 L55 35 Z;M23 35 L18 72 L62 72 L57 35 Z;M25 35 L20 70 L60 70 L55 35 Z" dur="2s" repeatCount="indefinite"/>}
        </path>
        {/* Body */}
        <ellipse cx="40" cy="50" rx="14" ry="18" fill="#2d2d44"/>
        {/* Helmet */}
        <path d="M28 30 Q40 15 52 30 L52 38 Q40 42 28 38 Z" fill="#3d3d5c"/>
        {/* Visor */}
        <path d="M32 32 Q40 28 48 32 L47 36 Q40 38 33 36 Z" fill="#ec8fad" opacity="0.8">
          {state === 'working' && <animate attributeName="opacity" values="0.8;1;0.8" dur="1s" repeatCount="indefinite"/>}
        </path>
        {/* Eyes */}
        <ellipse cx="36" cy="34" rx="2" ry="2.5" fill="#fff">
          {state === 'idle' && <animate attributeName="ry" values="2.5;0.5;2.5" dur="3s" repeatCount="indefinite"/>}
        </ellipse>
        <ellipse cx="44" cy="34" rx="2" ry="2.5" fill="#fff">
          {state === 'idle' && <animate attributeName="ry" values="2.5;0.5;2.5" dur="3s" repeatCount="indefinite"/>}
        </ellipse>
        {/* Sword */}
        <rect x="56" y="25" width="3" height="30" rx="1" fill="#b8b8cc" transform="rotate(15 57 40)"/>
        <rect x="53" y="50" width="9" height="4" rx="2" fill="#ec8fad" transform="rotate(15 57 52)"/>
        {/* Feet */}
        <ellipse cx="34" cy="68" rx="6" ry="3" fill="#1a1a2e"/>
        <ellipse cx="46" cy="68" rx="6" ry="3" fill="#1a1a2e"/>
      </g>
    </svg>
  );
}

function SharkChiliSVG({ state }: { state: PetState }) {
  return (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g className="pet-body">
        {/* Body - shark shape */}
        <ellipse cx="40" cy="42" rx="22" ry="16" fill="#4a90d9"/>
        <ellipse cx="40" cy="42" rx="22" ry="16" fill="url(#sharkGrad)"/>
        {/* Belly */}
        <ellipse cx="40" cy="46" rx="14" ry="10" fill="#e8f4ff"/>
        {/* Dorsal fin */}
        <path d="M38 26 L40 18 L44 26 Z" fill="#3a7bc8">
          {state === 'walking' && <animate attributeName="d" values="M38 26 L40 18 L44 26 Z;M37 26 L39 16 L43 26 Z;M38 26 L40 18 L44 26 Z" dur="1s" repeatCount="indefinite"/>}
        </path>
        {/* Tail */}
        <path d="M60 40 L72 34 L70 42 L72 50 L60 44 Z" fill="#3a7bc8">
          {state !== 'working' && <animate attributeName="d" values="M60 40 L72 34 L70 42 L72 50 L60 44 Z;M60 40 L74 32 L72 42 L74 52 L60 44 Z;M60 40 L72 34 L70 42 L72 50 L60 44 Z" dur="1.5s" repeatCount="indefinite"/>}
        </path>
        {/* Chili hat */}
        <path d="M30 28 Q35 20 40 22 Q42 18 38 14 L36 16 Q38 20 36 22 Q32 24 30 28 Z" fill="#e74c3c"/>
        <circle cx="37" cy="14" r="2" fill="#27ae60"/>
        {/* Eyes */}
        <circle cx="33" cy="40" r="4" fill="#fff"/>
        <circle cx="33" cy="40" r="2.5" fill="#1a1a2e">
          {state === 'idle' && <animate attributeName="cx" values="33;34;33;32;33" dur="4s" repeatCount="indefinite"/>}
        </circle>
        <circle cx="47" cy="40" r="4" fill="#fff"/>
        <circle cx="47" cy="40" r="2.5" fill="#1a1a2e">
          {state === 'idle' && <animate attributeName="cx" values="47;48;47;46;47" dur="4s" repeatCount="indefinite"/>}
        </circle>
        {/* Mouth */}
        <path d="M35 50 Q40 54 45 50" stroke="#1a1a2e" strokeWidth="1.5" fill="none">
          {state === 'working' && <animate attributeName="d" values="M35 50 Q40 54 45 50;M35 49 Q40 52 45 49;M35 50 Q40 54 45 50" dur="2s" repeatCount="indefinite"/>}
        </path>
        {/* Teeth */}
        <path d="M36 50 L37 52 L38 50 M42 50 L43 52 L44 50" fill="#fff" stroke="#fff" strokeWidth="0.5"/>
        {/* Fire breath when working */}
        {state === 'working' && (
          <g>
            <ellipse cx="25" cy="48" rx="4" ry="3" fill="#ff6b35" opacity="0.8">
              <animate attributeName="rx" values="4;6;4" dur="0.5s" repeatCount="indefinite"/>
              <animate attributeName="opacity" values="0.8;0.4;0.8" dur="0.5s" repeatCount="indefinite"/>
            </ellipse>
            <ellipse cx="22" cy="48" rx="3" ry="2" fill="#ffd700" opacity="0.6">
              <animate attributeName="rx" values="3;5;3" dur="0.4s" repeatCount="indefinite"/>
            </ellipse>
          </g>
        )}
        <defs>
          <linearGradient id="sharkGrad" x1="18" y1="26" x2="62" y2="58">
            <stop offset="0%" stopColor="#5ba3e6" stopOpacity="0.3"/>
            <stop offset="100%" stopColor="#2d7bc4" stopOpacity="0.3"/>
          </linearGradient>
        </defs>
      </g>
    </svg>
  );
}

function SakuraCatSVG({ state }: { state: PetState }) {
  return (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g className="pet-body">
        {/* Body */}
        <ellipse cx="40" cy="52" rx="16" ry="14" fill="#fce4ec"/>
        {/* Head */}
        <circle cx="40" cy="34" r="14" fill="#fce4ec"/>
        {/* Ears */}
        <path d="M28 24 L30 14 L36 22 Z" fill="#fce4ec"/>
        <path d="M28 24 L30 14 L36 22 Z" fill="#ec8fad" opacity="0.4"/>
        <path d="M44 22 L50 14 L52 24 Z" fill="#fce4ec"/>
        <path d="M44 22 L50 14 L52 24 Z" fill="#ec8fad" opacity="0.4"/>
        {/* Eyes */}
        <ellipse cx="35" cy="33" rx="3" ry="3.5" fill="#2d2d44">
          {state === 'idle' && <animate attributeName="ry" values="3.5;0.5;3.5" dur="4s" repeatCount="indefinite"/>}
        </ellipse>
        <ellipse cx="45" cy="33" rx="3" ry="3.5" fill="#2d2d44">
          {state === 'idle' && <animate attributeName="ry" values="3.5;0.5;3.5" dur="4s" repeatCount="indefinite"/>}
        </ellipse>
        <circle cx="34" cy="32" r="1" fill="#fff"/>
        <circle cx="44" cy="32" r="1" fill="#fff"/>
        {/* Blush */}
        <ellipse cx="30" cy="38" rx="3" ry="2" fill="#ec8fad" opacity="0.4"/>
        <ellipse cx="50" cy="38" rx="3" ry="2" fill="#ec8fad" opacity="0.4"/>
        {/* Nose */}
        <path d="M39 36 L40 37.5 L41 36 Z" fill="#ec8fad"/>
        {/* Mouth */}
        <path d="M37 39 Q40 41 43 39" stroke="#b8687a" strokeWidth="1" fill="none"/>
        {/* Whiskers */}
        <line x1="22" y1="35" x2="32" y2="36" stroke="#ccc" strokeWidth="0.5"/>
        <line x1="22" y1="38" x2="32" y2="38" stroke="#ccc" strokeWidth="0.5"/>
        <line x1="48" y1="36" x2="58" y2="35" stroke="#ccc" strokeWidth="0.5"/>
        <line x1="48" y1="38" x2="58" y2="38" stroke="#ccc" strokeWidth="0.5"/>
        {/* Sakura on head */}
        <g transform="translate(46, 20)">
          <circle cx="0" cy="0" r="2.5" fill="#ffb7c5" opacity="0.8"/>
          <circle cx="2" cy="-2" r="2.5" fill="#ffb7c5" opacity="0.8"/>
          <circle cx="-2" cy="-2" r="2.5" fill="#ffb7c5" opacity="0.8"/>
          <circle cx="0" cy="-1" r="1.5" fill="#fff" opacity="0.6"/>
        </g>
        {/* Tail */}
        <path d="M54 55 Q62 48 58 40 Q56 36 60 34" stroke="#fce4ec" strokeWidth="4" fill="none" strokeLinecap="round">
          {state === 'idle' && <animate attributeName="d" values="M54 55 Q62 48 58 40 Q56 36 60 34;M54 55 Q64 50 60 42 Q58 38 62 36;M54 55 Q62 48 58 40 Q56 36 60 34" dur="3s" repeatCount="indefinite"/>}
        </path>
        {/* Paws */}
        <ellipse cx="34" cy="64" rx="5" ry="3" fill="#fce4ec"/>
        <ellipse cx="46" cy="64" rx="5" ry="3" fill="#fce4ec"/>
        {/* Working: laptop */}
        {state === 'working' && (
          <g>
            <rect x="28" y="56" width="24" height="14" rx="2" fill="#333" opacity="0.8"/>
            <rect x="30" y="58" width="20" height="9" rx="1" fill="#4a90d9" opacity="0.6">
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
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g className="pet-body">
        {/* Body */}
        <path d="M24 40 Q24 20 40 20 Q56 20 56 40 L56 62 L52 58 L48 62 L44 58 L40 62 L36 58 L32 62 L28 58 L24 62 Z" fill="#a78bfa" opacity="0.85">
          {state === 'idle' && <animate attributeName="opacity" values="0.85;0.6;0.85" dur="3s" repeatCount="indefinite"/>}
        </path>
        {/* Inner glow */}
        <path d="M28 40 Q28 24 40 24 Q52 24 52 40 L52 58 L48 54 L44 58 L40 54 L36 58 L32 54 L28 58 Z" fill="#c4b5fd" opacity="0.4"/>
        {/* Eyes */}
        <circle cx="34" cy="38" r="4" fill="#fff"/>
        <circle cx="46" cy="38" r="4" fill="#fff"/>
        <circle cx="35" cy="38" r="2.5" fill="#1a1a2e">
          {state === 'idle' && <animate attributeName="cy" values="38;37;38;39;38" dur="3s" repeatCount="indefinite"/>}
        </circle>
        <circle cx="47" cy="38" r="2.5" fill="#1a1a2e">
          {state === 'idle' && <animate attributeName="cy" values="38;37;38;39;38" dur="3s" repeatCount="indefinite"/>}
        </circle>
        {/* Blush */}
        <ellipse cx="30" cy="44" rx="3" ry="2" fill="#ec8fad" opacity="0.5"/>
        <ellipse cx="50" cy="44" rx="3" ry="2" fill="#ec8fad" opacity="0.5"/>
        {/* Mouth */}
        <path d="M37 47 Q40 49 43 47" stroke="#6d28d9" strokeWidth="1.5" fill="none"/>
        {/* Crown/halo when working */}
        {state === 'working' && (
          <ellipse cx="40" cy="18" rx="10" ry="3" fill="none" stroke="#fbbf24" strokeWidth="1.5" opacity="0.7">
            <animate attributeName="opacity" values="0.7;1;0.7" dur="1.5s" repeatCount="indefinite"/>
            <animate attributeName="ry" values="3;4;3" dur="2s" repeatCount="indefinite"/>
          </ellipse>
        )}
        {/* Sparkles when idle */}
        {state === 'idle' && (
          <g>
            <circle cx="18" cy="30" r="1.5" fill="#fbbf24" opacity="0.6">
              <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite"/>
            </circle>
            <circle cx="62" cy="35" r="1" fill="#fbbf24" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0;0.4" dur="2.5s" repeatCount="indefinite"/>
            </circle>
            <circle cx="58" cy="25" r="1.5" fill="#ec8fad" opacity="0.5">
              <animate attributeName="opacity" values="0.5;0;0.5" dur="3s" repeatCount="indefinite"/>
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
