import { useEffect, useRef } from 'react';

export default function SakuraPetals() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const createPetal = () => {
      const petal = document.createElement('div');
      petal.className = 'sakura-petal';
      petal.style.left = Math.random() * 100 + '%';
      petal.style.animationDuration = (Math.random() * 8 + 10) + 's';
      petal.style.animationDelay = Math.random() * 5 + 's';
      petal.style.width = (Math.random() * 6 + 6) + 'px';
      petal.style.height = (Math.random() * 6 + 6) + 'px';
      petal.style.opacity = String(Math.random() * 0.3 + 0.1);
      container.appendChild(petal);
      setTimeout(() => petal.remove(), 18000);
    };

    const interval = setInterval(createPetal, 2500);
    for (let i = 0; i < 5; i++) setTimeout(createPetal, i * 600);

    return () => clearInterval(interval);
  }, []);

  return <div ref={containerRef} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: -1, overflow: 'hidden' }} />;
}
