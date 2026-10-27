import { lazy, useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { EffectComposer, Bloom, ToneMapping, Vignette, SMAA } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useGame } from '../state/store';
import { Hall } from './Hall';
import { Seats } from './Seats';
import { Screen } from './Screen';
import { LightSwitch } from './LightSwitch';
import { ProjectorBeam } from './ProjectorBeam';
import { LightingController } from './LightingController';
import { HallColliders } from './HallColliders';
import { Player } from '../player/Player';
import { Interaction } from '../interaction/Interaction';
import { RemotePlayers } from '../avatar/RemotePlayers';
import { Flashlights } from '../player/Flashlight';
import { VoiceSpatial } from '../voice/VoiceSpatial';
import { AvatarRig } from '../avatar/AvatarRig';
import { loadAvatar } from '../avatar/assets';
import { useActiveMap } from './mapContext';
import type { MapId } from '@shared/protocol.ts';

// O'rmon xaritasi alohida bo'lak (chunk) - faqat tanlanganda yuklanadi
const Forest = lazy(() => import('./forest/Forest'));

const DOWNLIGHTS: [number, number][] = [];
for (const x of [-6, -2, 2, 6]) for (const z of [8.8, 5.2, 1.6, -2, -5.6, -9.2]) DOWNLIGHTS.push([x, z]);

/** Metall va yog'och akslari uchun soddalashtirilgan zal muhiti (bir marta chiziladi). */
function HallEnvironment() {
  return (
    <Environment resolution={64} frames={1}>
      <color attach="background" args={['#030303']} />
      {DOWNLIGHTS.map(([x, z], i) => (
        <Lightformer key={i} form="circle" intensity={6} color="#ffd8a8" position={[x, 9.5, z]} rotation-x={Math.PI / 2} scale={0.5} />
      ))}
      <Lightformer form="rect" intensity={1.5} color="#9aa6c8" position={[0, 5, -12.8]} scale={[12.8, 7.2, 1]} />
      <Lightformer form="rect" intensity={0.6} color="#ffb070" position={[-8.8, 9, 0]} rotation-y={Math.PI / 2} scale={[23, 0.4, 1]} />
      <Lightformer form="rect" intensity={0.6} color="#ffb070" position={[8.8, 9, 0]} rotation-y={-Math.PI / 2} scale={[23, 0.4, 1]} />
    </Environment>
  );
}

function Effects() {
  const quality = useGame((s) => s.quality);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    // Post-processing yoqilganda tone mapping effekt ichida bajariladi
    gl.toneMapping = quality === 'low' ? THREE.AgXToneMapping : THREE.NoToneMapping;
    gl.toneMappingExposure = 1;
  }, [gl, quality]);

  if (quality === 'low') return null;
  return quality === 'high' ? (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.85} luminanceSmoothing={0.2} radius={0.75} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.25} darkness={0.5} />
      <SMAA />
    </EffectComposer>
  ) : (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.9} luminanceSmoothing={0.2} radius={0.6} levels={6} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.25} darkness={0.5} />
      <SMAA />
    </EffectComposer>
  );
}

/**
 * Barcha shaderlarni oldindan, parallel kompilyatsiya qiladi. Windows'da (ANGLE/D3D11) har bir
 * shader 1-2 soniya kompilyatsiya bo'ladi - buni yuklanish ekranida qilmasak o'yin qotib qoladi.
 */
function Precompile() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const quality = useGame((s) => s.quality);

  useEffect(() => {
    let alive = true;
    useGame.getState().setSceneReady(false);
    const ready = () => alive && useGame.getState().setSceneReady(true);
    // Xavfsizlik: drayver holat qaytarmasa ham o'yin cheksiz kutib qolmasin
    const timeout = setTimeout(ready, 30000);
    // Avatar shaderlari ham oldindan tayyorlanadi (birinchi player kirganda qotmasligi uchun):
    // pol ostida vaqtinchalik avatar qo'yiladi
    const dummy = new AvatarRig(useGame.getState().avatar, '');
    dummy.root.position.set(0, -40, 0);
    scene.add(dummy.root);
    let rt: THREE.WebGLRenderTarget | null = null;
    loadAvatar(useGame.getState().avatar)
      .catch(() => null)
      .then(() => new Promise((r) => setTimeout(r, 50)))
      .then(() => {
        if (!alive) return;
        // Post-processing yoqilganda sahna oraliq (half float) bufferga chiziladi - shu variantni kompilyatsiya qilamiz
        rt = quality === 'low' ? null : new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
        const prev = gl.getRenderTarget();
        gl.setRenderTarget(rt);
        const done = gl.compileAsync(scene, camera);
        gl.setRenderTarget(prev);
        return done;
      })
      .then(ready)
      .finally(() => {
        clearTimeout(timeout);
        rt?.dispose();
        dummy.dispose();
      });
    return () => {
      alive = false;
      clearTimeout(timeout);
      dummy.dispose();
    };
  }, [gl, scene, camera, quality]);
  return null;
}

/** Dev rejimida profil olish uchun: window.__debug.three */
function DebugExpose() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __debug?: Record<string, unknown> };
    w.__debug = { ...w.__debug, three: get, THREE };
  }, [get]);
  return null;
}

/** Har bir xaritada bir xil: player, boshqa avatarlar, fonarlar, ovoz, interaktivlik */
function Actors() {
  return (
    <>
      <Player />
      <RemotePlayers />
      <Flashlights />
      <VoiceSpatial />
      <Interaction />
    </>
  );
}

function HallMap() {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <HallEnvironment />
      <HallColliders />
      <Hall>
        <Seats />
        <Screen />
        <LightSwitch />
        <ProjectorBeam />
        <LightingController />
        <Actors />
      </Hall>
    </>
  );
}

function MapWorld({ map }: { map: MapId }) {
  return (
    <>
      <DebugExpose />
      <Physics timeStep="vary" gravity={[0, -9.81, 0]}>
        {map === 'forest' ? (
          <Forest>
            <Actors />
          </Forest>
        ) : (
          <HallMap />
        )}
      </Physics>
      <Effects />
      <Precompile />
    </>
  );
}

export function World() {
  const map = useActiveMap();
  // Xarita almashsa butun sahna (fizika, shaderlar, yuklanish) noldan quriladi
  return <MapWorld key={map} map={map} />;
}
