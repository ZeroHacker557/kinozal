import * as THREE from 'three';

/** Boshqa playerlarning joriy (interpolatsiya qilingan) ko'rinishi - fonarlar va boshqa tizimlar uchun. */
export interface RemoteView {
  head: THREE.Vector3;
  hand: THREE.Vector3;
  lookDir: THREE.Vector3;
  flashlight: boolean;
}

export const remoteView = new Map<string, RemoteView>();
