import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { Ghost, Cat, Planet, IceCream } from 'react-kawaii';

type PetType = 'dark_knight' | 'shark_chili' | 'sakura_cat' | 'pixel_ghost';
type PetState = 'idle' | 'walking' | 'working';

interface Position { x: number; y: number; }

const PET_NAMES: Record<PetType, string> = {
  dark_knight: '暗夜骑士',
  shark_chili: '鲨鱼辣椒',
  sakura_cat: '樱花猫',
  pixel_ghost: '像素幽灵',
};

const PET_COLORS: Record<PetType, string> = {
  dark_knight: '#2d2b55',
  shark_chili: '#5ba3e6',
  sakura_cat: '#fce4ec',
  pixel_ghost: '#b39ddb',
};

function PetRenderer({ type, state }: { type: PetType; state: PetState }) {
  const mood = state === 'working' ? 'excited' : state === 'idle' ? 'blissful' : 'happy';
  const color = PET_COLORS[type];

  switch (type) {
    case 'dark_knight':
      return <Planet size={68} mood={mood} color={color} />;
    case 'shark_chili':
      return <IceCream size={68} mood={mood} color={color} />;
    case 'sakura_cat':
      return <Cat size={68} mood={mood} color={color} />;
    case 'pixel_ghost':
      return <Ghost size={68} mood={mood} color={color} />;
  }
}

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
          <PetRenderer type={petType} state={petState} />
          <div className={`desktop-pet-status ${petState}`} />
        </div>
        <div className="desktop-pet-name" style={{ transform: direction < 0 ? 'scaleX(-1) translateX(50%)' : 'translateX(-50%)' }}>
          {PET_NAMES[petType]}
        </div>
      </div>

      {showSelector && (
        <div className="pet-selector" onClick={e => e.stopPropagation()}>
          {(['dark_knight', 'shark_chili', 'sakura_cat', 'pixel_ghost'] as PetType[]).map(type => (
            <div
              key={type}
              className={`pet-option ${petType === type ? 'active' : ''}`}
              onClick={() => { setPetType(type); setShowSelector(false); }}
              title={PET_NAMES[type]}
            >
              <PetRenderer type={type} state="idle" />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
