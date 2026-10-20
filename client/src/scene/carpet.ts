import * as THREE from 'three';

/**
 * Kinoteatr gilami naqshi (protsedural): to'q bordo fon, romb panjara, kesishmalarda
 * oltinrang yulduzchalar, kataklar o'rtasida halqalar va tola shovqini.
 * Bitta plitka ~1.6 m ni qoplaydi (repeat materials.ts'da).
 */
export function createCarpetTexture(size = 1024): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;

  g.fillStyle = '#3a0d16';
  g.fillRect(0, 0, size, size);

  const cell = size / 4;

  // Romb panjara (to'qroq chiziqlar)
  g.strokeStyle = 'rgba(20, 4, 9, 0.85)';
  g.lineWidth = size * 0.007;
  for (let k = -4; k <= 8; k++) {
    g.beginPath();
    g.moveTo(k * cell, 0);
    g.lineTo(k * cell + size, size);
    g.stroke();
    g.beginPath();
    g.moveTo(k * cell, size);
    g.lineTo(k * cell + size, 0);
    g.stroke();
  }

  // Ingichka ikkinchi chiziq (naqshni boyitadi)
  g.strokeStyle = 'rgba(120, 40, 50, 0.35)';
  g.lineWidth = size * 0.002;
  for (let k = -4; k <= 8; k++) {
    const o = size * 0.012;
    g.beginPath();
    g.moveTo(k * cell + o, 0);
    g.lineTo(k * cell + size + o, size);
    g.stroke();
    g.beginPath();
    g.moveTo(k * cell + o, size);
    g.lineTo(k * cell + size + o, 0);
    g.stroke();
  }

  const star = (x: number, y: number, r: number) => {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = i % 2 === 0 ? r : r * 0.35;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  };

  // Kesishmalar - oltinrang yulduzchalar (plitka chetlarida ham uzluksiz bo'lishi uchun 0..4)
  g.fillStyle = 'rgba(176, 128, 58, 0.75)';
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      star(i * cell, j * cell, size * 0.022);
    }
  }
  // Kataklar o'rtasida halqalar
  g.strokeStyle = 'rgba(150, 60, 70, 0.55)';
  g.lineWidth = size * 0.004;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      g.beginPath();
      g.arc((i + 0.5) * cell, (j + 0.5) * cell, size * 0.03, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(30, 90, 95, 0.45)';
      g.beginPath();
      g.arc((i + 0.5) * cell, (j + 0.5) * cell, size * 0.008, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Tola shovqini (yorqinlik farqi)
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < d.length; i += 4) {
    const n = 0.86 + rnd() * 0.24;
    d[i] = Math.min(255, d[i] * n);
    d[i + 1] = Math.min(255, d[i + 1] * n);
    d[i + 2] = Math.min(255, d[i + 2] * n);
  }
  g.putImageData(img, 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
