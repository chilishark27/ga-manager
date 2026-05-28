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
        <path d="M12 38 C12 22 20 12 32 12 C44 12 52 22 52 38 C52 50 44 56 32 56 C20 56 12 50 12 38 Z" fill="#2d2b55" stroke="#1e1b3a" strokeWidth="1.5"/>
        <path d="M16 40 C16 30 22 22 32 22 C42 22 48 30 48 40 C48 48 42 52 32 52 C22 52 16 48 16 40 Z" fill="#3d3a6e" opacity="0.5"/>
        <ellipse cx="25" cy="35" rx="5" ry="5.5" fill="#fff"/>
        <ellipse cx="39" cy="35" rx="5" ry="5.5" fill="#fff"/>
        <circle cx="26" cy="36" r="3" fill="#1a1a2e">
          {state === 'idle' && <animate attributeName="cy" values="36;35;36" dur="3s" repeatCount="indefinite"/>}
        </circle>
        <circle cx="40" cy="36" r="3" fill="#1a1a2e">
          {state === 'idle' && <animate attributeName="cy" values="36;35;36" dur="3s" repeatCount="indefinite"/>}
        </circle>
        <circle cx="24" cy="34" r="1.5" fill="#fff" opacity="0.8"/>
        <circle cx="38" cy="34" r="1.5" fill="#fff" opacity="0.8"/>
        <path d="M28 44 Q32 47 36 44" stroke="#1e1b3a" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        <rect x="26" y="10" width="12" height="6" rx="3" fill="#d4729a" opacity="0.9">
          {state === 'working' && <animate attributeName="opacity" values="0.9;0.5;0.9" dur="1s" repeatCount="indefinite"/>}
        </rect>
        <path d="M20 16 L18 10 M44 16 L46 10" stroke="#3d3a6e" strokeWidth="2" strokeLinecap="round"/>
      </g>
    </svg>
  );
}

function SharkChiliSVG({ state }: { state: PetState }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g className="pet-body">
        <path d="M8 34 C8 20 18 12 32 12 C46 12 56 20 56 34 C56 48 46 54 32 54 C18 54 8 48 8 34 Z" fill="#5ba3e6" stroke="#3a7bc8" strokeWidth="1.5"/>
        <path d="M14 38 C14 30 20 24 32 24 C44 24 50 30 50 38 C50 46 44 50 32 50 C20 50 14 46 14 38 Z" fill="#e8f4ff" opacity="0.7"/>
        <path d="M30 10 L32 4 L34 10" fill="#3a7bc8" stroke="#2d6db5" strokeWidth="0.8" strokeLinejoin="round"/>
        <path d="M50 30 Q58 26 56 34 Q58 42 50 38" fill="#3a7bc8" stroke="#2d6db5" strokeWidth="0.8">
          {state !== 'working' && <animate attributeName="d" values="M50 30 Q58 26 56 34 Q58 42 50 38;M50 30 Q60 24 58 34 Q60 44 50 38;M50 30 Q58 26 56 34 Q58 42 50 38" dur="2s" repeatCount="indefinite"/>}
        </path>
        <ellipse cx="24" cy="33" rx="5.5" ry="6" fill="#fff"/>
        <ellipse cx="40" cy="33" rx="5.5" ry="6" fill="#fff"/>
        <circle cx="25" cy="34" r="3.2" fill="#1a1a2e">
          {state === 'idle' && <animate attributeName="cx" values="25;26;25;24;25" dur="4s" repeatCount="indefinite"/>}
        </circle>
        <circle cx="41" cy="34" r="3.2" fill="#1a1a2e">
          {state === 'idle' && <animate attributeName="cx" values="41;42;41;40;41" dur="4s" repeatCount="indefinite"/>}
        </circle>
        <circle cx="23" cy="32" r="1.5" fill="#fff" opacity="0.8"/>
        <circle cx="39" cy="32" r="1.5" fill="#fff" opacity="0.8"/>
        <path d="M27 44 Q32 48 37 44" stroke="#1a1a2e" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        <path d="M28 44 L29 46 L30 44 M34 44 L35 46 L36 44" fill="#fff" stroke="#fff" strokeWidth="0.5"/>
        <path d="M16 16 Q20 10 24 14 Q25 9 22 6" fill="#e74c3c" stroke="#c0392b" strokeWidth="0.8" strokeLinejoin="round"/>
        <circle cx="21.5" cy="6" r="2" fill="#27ae60"/>
        {state === 'working' && (
          <g opacity="0.8">
            <ellipse cx="6" cy="36" rx="4" ry="3" fill="#ff6b35">
              <animate attributeName="rx" values="4;6;4" dur="0.6s" repeatCount="indefinite"/>
            </ellipse>
            <ellipse cx="3" cy="36" rx="2.5" ry="2" fill="#ffd700" opacity="0.7">
              <animate attributeName="rx" values="2.5;4;2.5" dur="0.5s" repeatCount="indefinite"/>
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
        <path d="M10 36 C10 20 19 12 32 12 C45 12 54 20 54 36 C54 50 45 56 32 56 C19 56 10 50 10 36 Z" fill="#fce4ec" stroke="#f8bbd0" strokeWidth="1.5"/>
        <path d="M18 14 L16 4 L24 12" fill="#fce4ec" stroke="#f8bbd0" strokeWidth="1.2" strokeLinejoin="round"/>
        <path d="M19 10 L17 5 L23 11" fill="#f48fb1" opacity="0.35"/>
        <path d="M40 12 L48 4 L46 14" fill="#fce4ec" stroke="#f8bbd0" strokeWidth="1.2" strokeLinejoin="round"/>
        <path d="M41 11 L47 5 L45 13" fill="#f48fb1" opacity="0.35"/>
        <ellipse cx="24" cy="34" rx="5.5" ry="6" fill="#fff"/>
        <ellipse cx="40" cy="34" rx="5.5" ry="6" fill="#fff"/>
        <ellipse cx="25" cy="35" rx="3.5" ry="4" fill="#37474f">
          {state === 'idle' && <animate attributeName="ry" values="4;1;4" dur="4s" repeatCount="indefinite"/>}
        </ellipse>
        <ellipse cx="41" cy="35" rx="3.5" ry="4" fill="#37474f">
          {state === 'idle' && <animate attributeName="ry" values="4;1;4" dur="4s" repeatCount="indefinite"/>}
        </ellipse>
        <circle cx="23" cy="33" r="1.8" fill="#fff" opacity="0.85"/>
        <circle cx="39" cy="33" r="1.8" fill="#fff" opacity="0.85"/>
        <ellipse cx="18" cy="40" rx="4" ry="2.5" fill="#f48fb1" opacity="0.25"/>
        <ellipse cx="46" cy="40" rx="4" ry="2.5" fill="#f48fb1" opacity="0.25"/>
        <ellipse cx="32" cy="39" rx="2" ry="1.5" fill="#f48fb1"/>
        <path d="M28 43 Q32 46 36 43" stroke="#795548" strokeWidth="1" fill="none" strokeLinecap="round"/>
        <line x1="6" y1="34" x2="16" y2="35" stroke="#e0bfbf" strokeWidth="0.8" strokeLinecap="round"/>
        <line x1="6" y1="38" x2="16" y2="38" stroke="#e0bfbf" strokeWidth="0.8" strokeLinecap="round"/>
        <line x1="48" y1="35" x2="58" y2="34" stroke="#e0bfbf" strokeWidth="0.8" strokeLinecap="round"/>
        <line x1="48" y1="38" x2="58" y2="38" stroke="#e0bfbf" strokeWidth="0.8" strokeLinecap="round"/>
        <path d="M50 48 Q56 42 54 36" stroke="#fce4ec" strokeWidth="4" fill="none" strokeLinecap="round">
          {state === 'idle' && <animate attributeName="d" values="M50 48 Q56 42 54 36;M50 48 Q58 44 56 38;M50 48 Q56 42 54 36" dur="2.5s" repeatCount="indefinite"/>}
        </path>
      </g>
    </svg>
  );
}

function PixelGhostSVG({ state }: { state: PetState }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g className="pet-body">
        <path d="M14 32 C14 16 22 8 32 8 C42 8 50 16 50 32 L50 52 L46 48 L42 52 L38 48 L34 52 L30 48 L26 52 L22 48 L18 52 L14 48 Z" fill="#b39ddb" stroke="#9575cd" strokeWidth="1.5">
          {state === 'idle' && <animate attributeName="opacity" values="0.9;0.65;0.9" dur="3.5s" repeatCount="indefinite"/>}
        </path>
        <path d="M18 32 C18 20 24 14 32 14 C40 14 46 20 46 32 L46 46 L43 43 L40 46 L37 43 L34 46 L31 43 L28 46 L25 43 L22 46 L18 43 Z" fill="#d1c4e9" opacity="0.4"/>
        <ellipse cx="26" cy="30" rx="5.5" ry="6" fill="#fff"/>
        <ellipse cx="38" cy="30" rx="5.5" ry="6" fill="#fff"/>
        <circle cx="27" cy="31" r="3.2" fill="#311b92">
          {state === 'idle' && <animate attributeName="cy" values="31;30;31;32;31" dur="3s" repeatCount="indefinite"/>}
        </circle>
        <circle cx="39" cy="31" r="3.2" fill="#311b92">
          {state === 'idle' && <animate attributeName="cy" values="31;30;31;32;31" dur="3s" repeatCount="indefinite"/>}
        </circle>
        <circle cx="25" cy="29" r="1.8" fill="#fff" opacity="0.8"/>
        <circle cx="37" cy="29" r="1.8" fill="#fff" opacity="0.8"/>
        <ellipse cx="21" cy="37" rx="3.5" ry="2" fill="#f48fb1" opacity="0.3"/>
        <ellipse cx="43" cy="37" rx="3.5" ry="2" fill="#f48fb1" opacity="0.3"/>
        <path d="M29 40 Q32 43 35 40" stroke="#7c4dff" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        {state === 'working' && (
          <ellipse cx="32" cy="6" rx="9" ry="3" fill="none" stroke="#ffd54f" strokeWidth="1.8" opacity="0.7">
            <animate attributeName="opacity" values="0.7;1;0.7" dur="1.5s" repeatCount="indefinite"/>
          </ellipse>
        )}
        {state === 'idle' && (
          <g>
            <circle cx="8" cy="20" r="1.5" fill="#ffd54f" opacity="0.5">
              <animate attributeName="opacity" values="0.5;0;0.5" dur="2.5s" repeatCount="indefinite"/>
            </circle>
            <circle cx="56" cy="24" r="1.2" fill="#ffd54f" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0;0.4" dur="3s" repeatCount="indefinite"/>
            </circle>
            <circle cx="54" cy="14" r="1.5" fill="#ce93d8" opacity="0.4">
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
