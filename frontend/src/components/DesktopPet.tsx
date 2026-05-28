import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';

type PetType = 'pixel_cat' | 'xiao_dai' | 'nahida' | 'pixel_simei';
type PetState = 'idle' | 'walking' | 'working';

interface Position { x: number; y: number; }

const PET_NAMES: Record<PetType, string> = {
  pixel_cat: '像素猫',
  xiao_dai: '小呆',
  nahida: '纳西妲',
  pixel_simei: '像素四妹',
};

const PET_IMAGES: Record<PetType, string> = {
  pixel_cat: '/pets/pixel_cat.png',
  xiao_dai: '/pets/xiao_dai.png',
  nahida: '/pets/nahida.png',
  pixel_simei: '/pets/pixel_simei.png',
};

export default function DesktopPet() {
  const { instances, activeInstanceId, messages } = useStore();
  const [petType, setPetType] = useState<PetType>(() => {
    return (localStorage.getItem('ga_pet_type') as PetType) || 'pixel_cat';
  });
  const [showSelector, setShowSelector] = useState(false);
  const [position, setPosition] = useState<Position>(() => {
    const saved = localStorage.getItem('ga_pet_pos');
    if (saved) return JSON.parse(saved);
    return { x: window.innerWidth - 120, y: window.innerHeight - 120 };
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

  useEffect(() => { localStorage.setItem('ga_pet_type', petType); }, [petType]);
  useEffect(() => { if (!isDragging) localStorage.setItem('ga_pet_pos', JSON.stringify(position)); }, [position, isDragging]);

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

  return (
    <>
      <div
        ref={petRef}
        className={`desktop-pet ${petState}`}
        style={{ left: position.x, top: position.y, bottom: 'auto', transform: direction < 0 ? 'scaleX(-1)' : 'none' }}
        onMouseDown={handleMouseDown}
        onDoubleClick={() => setShowSelector(s => !s)}
      >
        <div className="desktop-pet-container">
          <img src={PET_IMAGES[petType]} alt={PET_NAMES[petType]} className="desktop-pet-img" draggable={false} />
          <div className={`desktop-pet-status ${petState}`} />
        </div>
        <div className="desktop-pet-name" style={{ transform: direction < 0 ? 'scaleX(-1) translateX(50%)' : 'translateX(-50%)' }}>
          {PET_NAMES[petType]}
        </div>
      </div>

      {showSelector && (
        <div className="pet-selector" onClick={e => e.stopPropagation()}>
          {(Object.keys(PET_IMAGES) as PetType[]).map(type => (
            <div
              key={type}
              className={`pet-option ${petType === type ? 'active' : ''}`}
              onClick={() => { setPetType(type); setShowSelector(false); }}
              title={PET_NAMES[type]}
            >
              <img src={PET_IMAGES[type]} alt={PET_NAMES[type]} style={{ width: 36, height: 36, objectFit: 'contain' }} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
