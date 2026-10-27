import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { remoteView } from '../avatar/remoteView';
import { voiceFrame } from './voice';
import { updateListener } from '../audio/context';

/** Har kadr: eshituvchi = kamera (barcha fazoviy ovozlar uchun), suhbat ovozlari = avatarlar boshi. */
export function VoiceSpatial() {
  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3() }), []);
  const head = (id: string) => remoteView.get(id)?.head;
  useFrame(({ camera }) => {
    camera.getWorldPosition(tmp.pos);
    camera.getWorldDirection(tmp.fwd);
    tmp.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    updateListener(tmp.pos, tmp.fwd, tmp.up);
    voiceFrame(head);
  });
  return null;
}
