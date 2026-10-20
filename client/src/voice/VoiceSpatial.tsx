import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { remoteView } from '../avatar/remoteView';
import { voiceFrame } from './voice';

/** Har kadr: eshituvchi = kamera, ovoz manbalari = avatarlar boshi. */
export function VoiceSpatial() {
  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3() }), []);
  const head = (id: string) => remoteView.get(id)?.head;
  useFrame(({ camera }) => {
    camera.getWorldPosition(tmp.pos);
    camera.getWorldDirection(tmp.fwd);
    tmp.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    voiceFrame(tmp.pos, tmp.fwd, tmp.up, head);
  });
  return null;
}
