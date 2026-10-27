import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody, type RapierCollider } from '@react-three/rapier';
import { useGame } from '../state/store';
import { useMap, seatYaw } from '../scene/mapContext';
import { input, installInput, consumePress, consumeRelease } from './input';
import { playFootstep, playFlashlightClick } from '../audio/sfx';
import { requestPose, requestStand, sendState } from '../net/net';
import { toggleMic } from '../voice/voice';
import { POSE_MENU, wheelIndex } from './poses';
import type { Gait } from '@shared/protocol.ts';

const CAPSULE_HALF = 0.5;
const CAPSULE_RADIUS = 0.22;
const CENTER_TO_FEET = CAPSULE_HALF + CAPSULE_RADIUS;
const EYE_HEIGHT = 1.64;
const WALK = 1.5;
const RUN = 3.6;
const ACCEL = 10;
const GRAVITY = 9.81;
const MOUSE_SENS = 0.0021;
/** O'rindiqda ko'z joylashuvi (o'rindiq markaziga nisbatan, o'rindiq yo'nalishi -Z deb olinganda) */
const SEAT_EYE = new THREE.Vector3(0, 1.17, -0.12);
/** O'rindiqdan turganda oyoq qo'yish joyi (oldinda) */
const SEAT_EXIT = -0.62;
/** O'tirganda atrofga qarash chegarasi */
const SEAT_YAW_LIMIT = 1.9;

/** Mahalliy player holati - boshqa komponentlar (fonar, avatar) o'qiydi */
export const localPlayer = {
  feet: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  bodyYaw: 0,
  gait: 0 as Gait,
};

/** Vektorni o'rindiq yo'nalishiga burish (yaw 0 -> -Z) */
function rotateYaw(v: THREE.Vector3, yaw: number, out: THREE.Vector3) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return out.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Birinchi shaxs kamerasi: yurish, o'rindiqda o'tirish, harakatlar (poza), fonar. */
export function Player() {
  const map = useMap();
  const { world } = useRapier();
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);

  const state = useRef({
    yaw: 0,
    pitch: -0.05,
    bodyYaw: 0,
    vel: new THREE.Vector3(),
    vy: 0,
    grounded: false,
    camPos: new THREE.Vector3(),
    camY: 0,
    bob: 0,
    bobAmp: 0,
    seatedIn: null as string | null,
    wheel: new THREE.Vector2(),
  });

  const seatById = useMemo(() => new Map(map.seats.map((s) => [s.id, s])), [map]);

  const spawn = useMemo(() => {
    const [x, y, z] = map.spawn.position;
    const [lx, , lz] = map.spawn.lookAt;
    state.current.yaw = Math.atan2(-(lx - x), -(lz - z));
    state.current.bodyYaw = state.current.yaw;
    state.current.camY = y + EYE_HEIGHT;
    state.current.camPos.set(x, y + EYE_HEIGHT, z);
    return [x, y + CENTER_TO_FEET + 0.05, z] as [number, number, number];
  }, [map]);

  const controllerRef = useRef<ReturnType<typeof world.createCharacterController> | null>(null);
  useEffect(() => {
    const c = world.createCharacterController(0.02);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.enableAutostep(0.27, 0.15, false); // zinalar 0.2 m
    c.enableSnapToGround(0.3);
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    c.setSlideEnabled(true);
    controllerRef.current = c;
    return () => {
      controllerRef.current = null;
      world.removeCharacterController(c);
    };
  }, [world]);
  useEffect(() => installInput(gl.domElement), [gl]);

  const teleport = (x: number, y: number, z: number) => {
    body.current?.setTranslation({ x, y: y + CENTER_TO_FEET + 0.05, z }, true);
    body.current?.setNextKinematicTranslation({ x, y: y + CENTER_TO_FEET + 0.05, z });
    state.current.vel.set(0, 0, 0);
    state.current.vy = 0;
  };

  // Dev rejimida test uchun: window.__debug.teleport(x, y, z, yaw, pitch)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __debug?: Record<string, unknown> };
    w.__debug = {
      ...w.__debug,
      teleport: (x: number, y: number, z: number, yaw = state.current.yaw, pitch = 0) => {
        teleport(x, y, z);
        state.current.yaw = yaw;
        state.current.pitch = pitch;
        state.current.camY = y + EYE_HEIGHT;
        state.current.camPos.set(x, y + EYE_HEIGHT, z);
      },
      look: (yaw: number, pitch: number) => {
        state.current.yaw = yaw;
        state.current.pitch = pitch;
      },
      setLights: (on: boolean) => useGame.getState().setLightsOn(on),
      input: () => ({ ...input, keys: [...input.keys], pressed: [...input.pressed], phase: useGame.getState().phase }),
      state: () => ({ ...body.current?.translation(), yaw: state.current.yaw, pitch: state.current.pitch }),
    };
  }, []);

  const fwd = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const wish = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const tmpSeat = useMemo(() => new THREE.Vector3(), []);
  const euler = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), []);

  useFrame((_, rawDt) => {
    const b = body.current, col = collider.current, controller = controllerRef.current;
    if (!b || !col || !controller) return;
    const dt = Math.min(rawDt, 0.05);
    const s = state.current;
    const game = useGame.getState();
    const playing = game.phase === 'playing';
    const k = input.keys;

    // ---------------------------------------------------------------- tugmalar
    if (playing) {
      if (consumePress('KeyM')) void toggleMic();
      if (consumePress('KeyF')) {
        game.setFlashlight(!game.flashlight);
        playFlashlightClick(!game.flashlight);
      }
      // Harakatlar g'ildiragi: Q bosib turiladi, sichqoncha bilan tanlanadi
      if (consumePress('KeyQ')) {
        s.wheel.set(0, 0);
        game.setWheelOpen(true);
      }
      if (consumeRelease('KeyQ') && useGame.getState().wheelOpen) {
        const i = wheelIndex(s.wheel.x, s.wheel.y);
        game.setWheelOpen(false);
        if (i >= 0) requestPose(POSE_MENU[i].pose === game.pose ? null : POSE_MENU[i].pose);
      }
      for (const item of POSE_MENU) {
        if (consumePress('Digit' + item.key)) requestPose(item.pose === game.pose ? null : item.pose);
      }
      if (consumePress('Digit0')) requestPose(null);
    }

    // ---------------------------------------------------------------- qarash
    const wheelOpen = useGame.getState().wheelOpen;
    if (playing && wheelOpen) {
      s.wheel.x = THREE.MathUtils.clamp(s.wheel.x + input.mouseDX, -160, 160);
      s.wheel.y = THREE.MathUtils.clamp(s.wheel.y + input.mouseDY, -160, 160);
      game.setWheelSel(wheelIndex(s.wheel.x, s.wheel.y));
    } else if (playing) {
      s.yaw -= input.mouseDX * MOUSE_SENS;
      s.pitch = THREE.MathUtils.clamp(s.pitch - input.mouseDY * MOUSE_SENS, -1.45, 1.45);
    }
    input.mouseDX = input.mouseDY = 0;

    const seat = game.seat ? seatById.get(game.seat) : undefined;
    const pose = useGame.getState().pose;
    const moveKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    const wantsMove = playing && moveKeys.some((c) => k.has(c));

    // ---------------------------------------------------------------- o'rindiqda o'tirish
    if (seat) {
      const sy = seatYaw(seat);
      if (s.seatedIn !== seat.id) {
        s.seatedIn = seat.id;
        s.yaw = sy; // o'tirganda o'rindiq yo'nalishiga (ekranga) qaraladi
        s.pitch = 0.05;
      }
      s.yaw = sy + THREE.MathUtils.clamp(angleDiff(s.yaw, sy), -SEAT_YAW_LIMIT, SEAT_YAW_LIMIT);
      s.pitch = THREE.MathUtils.clamp(s.pitch, -1.0, 1.2);
      if (playing && (consumePress('KeyE') || consumePress('Space') || wantsMove)) {
        requestStand();
      }
      const [x, y, z] = seat.position;
      rotateYaw(SEAT_EYE, sy, target).add(tmpSeat.set(x, y, z));
      s.camPos.lerp(target, 1 - Math.exp(-6 * dt));
      s.bodyYaw = sy;
      localPlayer.feet.set(x, y, z);
      localPlayer.gait = 0;
      applyCamera(0);
      return;
    }
    if (s.seatedIn) {
      // Turish: oyoq qo'yiladigan joyga (qator oldiga) o'tkazamiz
      const prev = seatById.get(s.seatedIn);
      s.seatedIn = null;
      if (prev) {
        const [x, y, z] = prev.position;
        const py = seatYaw(prev);
        teleport(x + Math.sin(py) * SEAT_EXIT, y, z + Math.cos(py) * SEAT_EXIT);
        s.camY = y + SEAT_EYE.y;
        return;
      }
    }

    // Harakatlanishni boshlash pozani bekor qiladi
    if (pose && wantsMove) requestPose(null);

    // ---------------------------------------------------------------- yurish
    fwd.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    right.set(-fwd.z, 0, fwd.x);
    wish.set(0, 0, 0);
    if (playing && !pose) {
      if (k.has('KeyW') || k.has('ArrowUp')) wish.add(fwd);
      if (k.has('KeyS') || k.has('ArrowDown')) wish.sub(fwd);
      if (k.has('KeyD') || k.has('ArrowRight')) wish.add(right);
      if (k.has('KeyA') || k.has('ArrowLeft')) wish.sub(right);
    }
    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(running ? RUN : WALK);
    s.vel.lerp(wish, 1 - Math.exp(-ACCEL * dt));

    s.vy = s.grounded ? -1 : s.vy - GRAVITY * dt;
    controller.computeColliderMovement(col, { x: s.vel.x * dt, y: s.vy * dt, z: s.vel.z * dt });
    const m = controller.computedMovement();
    s.grounded = controller.computedGrounded();
    const p = b.translation();
    const next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z };
    b.setNextKinematicTranslation(next);
    const feetY = next.y - CENTER_TO_FEET;
    localPlayer.feet.set(next.x, feetY, next.z);

    // Tana burilishi: yurganda harakat yo'nalishiga, turganda bosh juda burilsa
    const speed = Math.hypot(s.vel.x, s.vel.z);
    if (speed > 0.3) s.bodyYaw += angleDiff(Math.atan2(-s.vel.x, -s.vel.z), s.bodyYaw) * (1 - Math.exp(-8 * dt));
    else if (Math.abs(angleDiff(s.yaw, s.bodyYaw)) > 1.1) s.bodyYaw += angleDiff(s.yaw, s.bodyYaw) * (1 - Math.exp(-4 * dt));
    localPlayer.gait = speed < 0.3 ? 0 : speed > (WALK + RUN) / 2 ? 2 : 1;

    // Kamera: poza bo'yicha balandlik (yotish - polda, cho'kkalash - past)
    const eye = pose === 'lie' ? 0.32 : pose === 'crouch' ? 1.0 : EYE_HEIGHT;
    s.camY = THREE.MathUtils.damp(s.camY, feetY + eye, pose ? 5 : 14, dt);
    s.bobAmp = THREE.MathUtils.damp(s.bobAmp, s.grounded && speed > 0.3 ? 1 : 0, 8, dt);
    const prevBob = s.bob;
    s.bob += dt * speed * 2.4;
    if (s.grounded && speed > 0.6 && Math.floor(prevBob / Math.PI) !== Math.floor(s.bob / Math.PI)) playFootstep(running);
    const bobY = Math.sin(s.bob * 2) * 0.022 * s.bobAmp * (running ? 1.4 : 1);
    const bobX = Math.sin(s.bob) * 0.012 * s.bobAmp;
    // Yotganda kamera bosh tomonga (tananing orqasiga) suriladi
    const lieBack = pose === 'lie' ? 0.75 : 0;
    s.camPos.set(
      next.x + right.x * bobX + Math.sin(s.bodyYaw) * lieBack,
      s.camY + bobY,
      next.z + right.z * bobX + Math.cos(s.bodyYaw) * lieBack,
    );
    applyCamera(Math.sin(s.bob) * 0.003 * s.bobAmp);

    function applyCamera(roll: number) {
      camera.position.copy(s.camPos);
      euler.set(s.pitch, s.yaw, roll);
      camera.quaternion.setFromEuler(euler);
      localPlayer.yaw = s.yaw;
      localPlayer.pitch = s.pitch;
      localPlayer.bodyYaw = s.bodyYaw;
      sendState({
        p: [localPlayer.feet.x, localPlayer.feet.y, localPlayer.feet.z],
        ry: s.bodyYaw,
        hy: s.yaw,
        hp: s.pitch,
        g: localPlayer.gait,
        fl: useGame.getState().flashlight,
      });
    }
  });

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={spawn} enabledRotations={[false, false, false]}>
      <CapsuleCollider ref={collider} args={[CAPSULE_HALF, CAPSULE_RADIUS]} />
    </RigidBody>
  );
}
