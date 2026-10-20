import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGame } from '../state/store';
import { interactables, type Interactable } from './interactables';
import { consumePress, input } from '../player/input';

/** Ekran markazidan nur tashlab, qaralayotgan interaktiv obyektni topadi; E - ishlatish. */
export function Interaction() {
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const center = useMemo(() => new THREE.Vector2(0, 0), []);

  useFrame(({ camera }) => {
    const { phase, setPrompt, seat, wheelOpen } = useGame.getState();
    // O'tirganda E - turish (Player boshqaradi), menyuda - hech narsa
    if (phase !== 'playing' || seat || wheelOpen) {
      setPrompt(null);
      input.pressed.clear();
      input.released.clear();
      return;
    }
    raycaster.setFromCamera(center, camera);
    let best: { it: Interactable; hit: THREE.Intersection } | null = null;
    for (const it of interactables.all()) {
      raycaster.far = it.maxDistance;
      const targets = Array.isArray(it.target) ? it.target : [it.target];
      const hit = raycaster.intersectObjects(targets, true)[0];
      if (hit && (!best || hit.distance < best.hit.distance)) best = { it, hit };
    }
    const label = best ? best.it.label(best.hit) : null;
    setPrompt(label);
    if (best && label && consumePress('KeyE')) best.it.use(best.hit);
    // Kadr oxirida: ishlatilmagan bir martalik bosilishlar tashlanadi (Interaction oxirgi ishlaydi)
    input.pressed.clear();
    input.released.clear();
  });

  return null;
}
