import { Component, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGame } from './state/store';
import { World } from './scene/World';
import { Overlay } from './ui/Overlay';
import { useScreen } from './screen/screenStore';
import { useRoom } from './net/roomStore';
import { useActiveMap } from './scene/mapContext';

/** Dev sinovi: ?lite=1 - 3D sahnasiz (faqat tarmoq va ovoz), ikkinchi "do'st" sifatida ochish uchun */
const LITE = import.meta.env.DEV && new URLSearchParams(location.search).has('lite');

/**
 * 3D yiqilsa (WebGL yaratilmadi, videokarta xotirasi yetmadi) butun ilova o'chmasin:
 * xabar ko'rsatiladi, ovoz va to'liq ekran video (V) ishlashda davom etadi.
 */
class GraphicsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error('[3d]', e);
    useGame.getState().setSceneReady(true);
  }
  render() {
    return this.state.failed ? <GraphicsFailed /> : this.props.children;
  }
}

function GraphicsFailed({ lost }: { lost?: boolean }) {
  return (
    <div className="gfx-failed">
      <strong>{lost ? "3D grafika to'xtadi" : '3D grafika ishga tushmadi'}</strong>
      <span>
        Videokarta yoki xotira yetmadi. Ovozli suhbat ishlayveradi, ekran ulashilganda <kbd>V</kbd> bilan videoni
        to'liq ekranda ko'rishingiz mumkin. Boshqa dasturlarni yopib, sahifani yangilang (grafika sifatini
        "Past" qilish ham yordam beradi).
      </span>
      <button className="primary" onClick={() => location.reload()}>
        Sahifani yangilash
      </button>
    </div>
  );
}

export default function App() {
  const quality = useGame((s) => s.quality);
  // To'liq ekran rejimida 3D zal chizilmaydi - videokarta video uchun bo'shaydi
  const fullscreen = useScreen((s) => s.fullscreen);
  const [lost, setLost] = useState(false);
  const map = useActiveMap();
  // Yangi xarita yuklanib, shaderlari tayyor bo'lguncha yuklanish ekrani ko'rsatiladi
  useEffect(() => useGame.getState().setSceneReady(false), [map]);
  if (LITE) return <Overlay />;
  const dpr: [number, number] = quality === 'low' ? [0.6, 0.85] : quality === 'medium' ? [1, 1] : [1, 1.5];

  return (
    <>
      <GraphicsBoundary>
        <Canvas
          frameloop={fullscreen ? 'never' : 'always'}
          // Yumshoq (PCFSoft) soya qimmat: faqat yuqori sifatda; o'rtada oddiy PCF
          shadows={quality === 'low' ? false : quality === 'high' ? 'soft' : true}
          dpr={dpr}
          gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
          camera={{ fov: 72, near: 0.05, far: 80 }}
          onCreated={({ gl }) => {
            const el = gl.domElement;
            el.addEventListener('webglcontextlost', (e) => {
              e.preventDefault(); // brauzer kontekstni qayta tiklashi mumkin bo'lsin
              setLost(true);
              useRoom.getState().toast("3D grafika to'xtadi (videokarta xotirasi yetmadi)");
            });
            el.addEventListener('webglcontextrestored', () => setLost(false));
          }}
        >
          <Suspense fallback={null}>
            <World />
          </Suspense>
        </Canvas>
      </GraphicsBoundary>
      {lost && <GraphicsFailed lost />}
      <Overlay />
    </>
  );
}
