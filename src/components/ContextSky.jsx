import { useEffect, useRef } from 'react';
import { fraction } from '../lib/knowledgeGraph.js';

// Render the sky once per size. A CSS mask supplies the live accent and compositor-only drift.
function paintSky(stars, curtain, width, height) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  for (const canvas of [stars, curtain]) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.getContext('2d').scale(ratio, ratio);
  }
  const sky = stars.getContext('2d');
  const count = Math.min(1900, Math.ceil(width * height / 400));
  for (let i = 0; i < count; i++) {
    const x = fraction('x' + i) * width, y = fraction('y' + i) * height;
    const glow = fraction('light' + i);
    const r = 0.26 + glow ** 7 * 1.1;
    sky.fillStyle = 'rgba(211,222,244,' + (0.17 + glow * 0.62) + ')';
    sky.beginPath(); sky.arc(x, y, r, 0, Math.PI * 2); sky.fill();
    if (glow > 0.98) {
      const halo = sky.createRadialGradient(x, y, 0, x, y, r * 6);
      halo.addColorStop(0, 'rgba(210,224,255,.26)'); halo.addColorStop(1, 'transparent');
      sky.fillStyle = halo; sky.fillRect(x-r*6, y-r*6, r*12, r*12);
    }
  }
  const ink = curtain.getContext('2d');
  ink.globalCompositeOperation = 'lighter';
  for (let band = 0; band < 3; band++) {
    for (let i = 0; i <= 1600; i++) {
      const t = i / 1600;
      const fold = Math.sin(t * 12 + band * 1.1) * 0.07 + Math.sin(t * 28 + band) * 0.012;
      const x = (t * 1.34 - 0.17 + fold * 0.7) * width;
      const wave = 0.12 + 0.23 * Math.cos(t * 4.8) + fold + band * 0.032;
      const y = (band === 2 ? 1 - wave * 0.75 : wave) * height;
      const length = (0.11 + 0.14 * Math.sin(t * 6 + band) ** 2) * height * (band === 2 ? 1 : -1);
      const tail = x + length * 0.45;
      const gradient = ink.createLinearGradient(x, y, tail, y + length);
      const alpha = (0.045 + 0.065 * Math.sin(t * 90 + fold * 45) ** 2) * (band === 2 ? 0.75 : 1);
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(0.07, 'rgba(255,255,255,' + alpha + ')');
      gradient.addColorStop(0.34, 'rgba(255,255,255,' + alpha * 0.5 + ')');
      gradient.addColorStop(1, 'transparent');
      ink.strokeStyle = gradient; ink.lineWidth = Math.max(1.5, width / 260);
      ink.beginPath(); ink.moveTo(x, y); ink.quadraticCurveTo(x + length * 0.15, y + length * 0.64, tail, y + length); ink.stroke();
    }
  }
}

export default function ContextSky() {
  const backdrop = useRef(null), stars = useRef(null), aurora = useRef(null);
  useEffect(() => {
    const curtain = document.createElement('canvas');
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width < 1 || height < 1) return;
      paintSky(stars.current, curtain, width, height);
      aurora.current.style.maskImage = 'url(' + curtain.toDataURL() + ')';
    });
    observer.observe(backdrop.current);
    return () => observer.disconnect();
  }, []);
  return <div className="ctx-sky" aria-hidden="true" ref={backdrop}>
    <div className="ctx-nebula" /><div className="ctx-aurora" ref={aurora} /><canvas ref={stars} />
  </div>;
}
