import * as THREE from 'three';
import { ONE_SHOT_POSES, type AvatarId, type Pose } from '@shared/protocol.ts';
import { applyKnightTint, instantiate, loadAvatar, loadClip, rigOf, type ClipName, type RigKind } from './assets';
import { applyProbeLighting, createProbeUniforms, type ProbeUniforms } from '../scene/lighting';
import type { LightSample } from '../scene/probes';

/** Avatarni boshqarish uchun har kadrdagi ma'lumot. */
export interface AvatarDrive {
  /** Oyoq ostidagi nuqta */
  pos: THREE.Vector3;
  /** Tana va bosh burilishi (yaw), bosh pitch */
  bodyYaw: number;
  headYaw: number;
  headPitch: number;
  /** 0 - turish, 1 - yurish, 2 - yugurish */
  gait: number;
  speed: number;
  seated: boolean;
  /** O'tirgan o'rindiq yo'nalishi (yaw) */
  seatYaw: number;
  pose: Pose | null;
  poseAt: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const FADE = 0.35;
/** O'tirganda tos suyagi (son bo'g'imi) bo'lishi kerak bo'lgan nuqta - o'rindiq markaziga nisbatan */
const SEAT_PELVIS = new THREE.Vector3(0, 0.62, -0.02);
/** Yotganda tana qalinligining yarmi (orqa polga tegishi uchun) */
const LIE_LIFT = 0.12;
/**
 * Asosiy o'tirish: kino zalida kresloga suyanib, vaqti-vaqti bilan tabiiy harakatlar.
 * Ritsar (o'rmonda to'nkada, suyanchiqsiz) - tik o'tiradi.
 */
const SIT: Record<'human' | 'knight', { base: ClipName; variants: ClipName[] }> = {
  human: { base: 'sit_relaxed', variants: ['sit', 'sit_look', 'sit_yawn'] },
  knight: { base: 'sit', variants: [] },
};
/** Ritsar uzoqlashganda soddalashtirilgan modelga o'tish masofasi (m) */
const LOD_DIST = 14;

/** Suyaklar: Rocketbox (Bip01) va ritsar (Mixamo; glTF nomlaridan ':' olib tashlanadi) */
const BONES = {
  head: /^(Bip01_Head|mixamorigHead_\d+)$/,
  neck: /^(Bip01_Neck|mixamorigNeck_\d+)$/,
  rHand: /^(Bip01_R_Hand|mixamorigRightHand_\d+)$/,
  pelvis: /^(Bip01_Pelvis|mixamorigHips_\d+)$/,
};

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function poseClip(p: Pose): ClipName {
  return p === 'lie' ? 'idle' : (p as ClipName);
}

/** Oyoq ostidagi yumshoq kontakt soyasi (barcha avatarlar uchun umumiy texture). */
let blobTexture: THREE.Texture | null = null;
function createContactShadow() {
  if (!blobTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    blobTexture = new THREE.CanvasTexture(c);
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false, opacity: 0.55, color: 0x000000 }),
  );
  mesh.renderOrder = 1;
  return mesh;
}

/** Nom yorlig'idagi mikrofon holati: none - ovozga ulanmagan (belgi yo'q) */
export type VoiceBadge = 'none' | 'muted' | 'idle' | 'speaking';

/** Nickname va mikrofon belgisi (kanvasdan sprite). */
function createNameplate(nickname: string) {
  const W = 512, H = 112;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 10;
  sprite.scale.set(1.0, 1.0 * (H / W), 1);

  const draw = (badge: VoiceBadge) => {
    const speaking = badge === 'speaking', muted = badge === 'muted';
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    g.font = '600 44px Inter, "Segoe UI", sans-serif';
    const icon = badge === 'none' ? 0 : 1;
    const tw = Math.min(g.measureText(nickname).width, W - 150);
    const pw = tw + 60 + icon * 60, x0 = (W - pw) / 2;
    g.fillStyle = speaking ? 'rgba(12, 28, 18, 0.7)' : 'rgba(12, 12, 16, 0.62)';
    g.beginPath();
    g.roundRect(x0, 18, pw, 76, 38);
    g.fill();
    if (speaking) {
      g.strokeStyle = 'rgba(74, 222, 128, 0.85)';
      g.lineWidth = 4;
      g.stroke();
    }
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.fillText(nickname, x0 + 30 + icon * 50, 57, tw);
    tex.needsUpdate = true;
    if (!icon) return;
    // Mikrofon belgisi
    const cx = x0 + 46, cy = 56;
    g.fillStyle = speaking ? '#4ade80' : muted ? '#ef4444' : 'rgba(255,255,255,0.45)';
    if (speaking) {
      g.shadowColor = '#4ade80';
      g.shadowBlur = 18;
    }
    g.beginPath();
    g.roundRect(cx - 9, cy - 22, 18, 30, 9);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = g.fillStyle;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy - 2, 15, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    g.beginPath();
    g.moveTo(cx, cy + 13);
    g.lineTo(cx, cy + 22);
    g.stroke();
    if (muted) {
      g.strokeStyle = '#ef4444';
      g.beginPath();
      g.moveTo(cx - 18, cy - 24);
      g.lineTo(cx + 18, cy + 22);
      g.stroke();
    }
  };
  draw('none');
  return { sprite, draw };
}

/**
 * Bitta playerning realistik avatari: animatsiyalar (turish/yurish/o'tirish/harakatlar),
 * bosh qarash yo'nalishi, probe yoritish va nickname.
 */
export class AvatarRig {
  readonly root = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<ClipName, THREE.AnimationAction>();
  private loading = new Set<ClipName>();
  private current: { name: ClipName; action: THREE.AnimationAction } | null = null;
  private head: THREE.Bone | null = null;
  private neck: THREE.Bone | null = null;
  private rHand: THREE.Bone | null = null;
  private pelvis: THREE.Bone | null = null;
  private seatFix = new THREE.Vector3();
  private contact = createContactShadow();
  private tmpV = new THREE.Vector3();
  private tmpTarget = new THREE.Vector3();
  private probe: ProbeUniforms = createProbeUniforms();
  private rig: RigKind;
  private lods: THREE.Object3D[][] = [[], []];
  private lodLevel = -1;
  private nameplate;
  private oneShotDoneAt = -1;
  private sitVariantAt = 0;
  private idleLookAt = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private lie = 0;
  private disposed = false;
  /** Bosh va qo'l joylashuvi (fonar uchun) */
  readonly headPos = new THREE.Vector3();
  readonly handPos = new THREE.Vector3();

  constructor(readonly avatarId: AvatarId, nickname: string) {
    this.rig = rigOf(avatarId);
    this.nameplate = createNameplate(nickname);
    this.root.add(this.nameplate.sprite);
    this.root.add(this.contact);
    loadAvatar(avatarId).then((t) => {
      if (this.disposed) return;
      const model = instantiate(t);
      model.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isMesh) {
          const list = Array.isArray(m.material) ? m.material : [m.material];
          const mats = list.map((src) => {
            const mat = (src as THREE.MeshStandardMaterial).clone();
            if (this.rig === 'knight') applyKnightTint(mat, avatarId);
            applyProbeLighting(mat, this.probe);
            return mat;
          });
          m.material = Array.isArray(m.material) ? mats : mats[0];
          // Oy, gulxan va fonar nurida odamning soyasi
          m.castShadow = true;
          if (this.rig === 'knight') this.lods[m.userData.lod === 1 ? 1 : 0].push(m);
        }
        if ((o as THREE.Bone).isBone) {
          if (BONES.head.test(o.name)) this.head = o as THREE.Bone;
          if (BONES.neck.test(o.name)) this.neck = o as THREE.Bone;
          if (BONES.rHand.test(o.name)) this.rHand = o as THREE.Bone;
          if (BONES.pelvis.test(o.name)) this.pelvis = o as THREE.Bone;
        }
      });
      this.model = model;
      this.mixer = new THREE.AnimationMixer(model);
      this.root.add(model);
    });
    this.idleLookAt = performance.now() + 6000 + Math.random() * 8000;
  }

  private badge: VoiceBadge = 'none';

  setNickname(n: string) {
    this.root.remove(this.nameplate.sprite);
    this.nameplate = createNameplate(n);
    this.nameplate.draw(this.badge);
    this.root.add(this.nameplate.sprite);
  }

  /** Mikrofon belgisi (faqat o'zgarganda qayta chiziladi) */
  setVoice(badge: VoiceBadge) {
    if (badge === this.badge) return;
    this.badge = badge;
    this.nameplate.draw(badge);
  }

  setLight(s: LightSample) {
    this.probe.uPH.value.copy(s.house);
    this.probe.uPB.value.copy(s.base);
    this.probe.uPS.value.copy(s.screen);
  }

  private action(name: ClipName): THREE.AnimationAction | null {
    const a = this.actions.get(name);
    if (a) return a;
    if (this.mixer && !this.loading.has(name)) {
      this.loading.add(name);
      loadClip(this.rig, name).then((clip) => {
        if (this.disposed || !this.mixer) return;
        this.actions.set(name, this.mixer.clipAction(clip));
      });
    }
    return null;
  }

  /** Kerakli clipga silliq o'tish. Clip hali yuklanmagan bo'lsa, joriy holat davom etadi. */
  private play(name: ClipName, opts: { once?: boolean; timeScale?: number; fade?: number } = {}) {
    if (this.current?.name === name) {
      if (opts.timeScale != null) this.current.action.timeScale = opts.timeScale;
      return;
    }
    const next = this.action(name);
    if (!next) return;
    next.reset();
    next.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = !!opts.once;
    next.timeScale = opts.timeScale ?? 1;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (this.current) next.crossFadeFrom(this.current.action, opts.fade ?? FADE, true);
    this.current = { name, action: next };
  }

  update(dt: number, d: AvatarDrive, cameraPos: THREE.Vector3) {
    // Joylashuv va burilish (model +Z ga qaragan, o'yinda oldinga -Z)
    if (d.seated) {
      // Mocap'dagi stul joyi bizning o'rindiqdan farq qiladi - tos suyagi o'lchanib, tuzatma qo'shiladi
      this.root.position.copy(d.pos).add(this.seatFix);
      this.root.rotation.set(0, d.seatYaw + Math.PI, 0);
    } else {
      this.seatFix.set(0, 0, 0);
      this.root.position.copy(d.pos);
      this.root.rotation.set(0, d.bodyYaw + Math.PI, 0);
    }

    // Yotish: model gorizontal holatga silliq o'tadi (orqa bilan polga)
    this.lie = THREE.MathUtils.damp(this.lie, d.pose === 'lie' && !d.seated ? 1 : 0, 5, dt);
    if (this.model) {
      this.model.rotation.x = -Math.PI / 2 * this.lie;
      this.model.position.y = LIE_LIFT * this.lie;
    }
    // Kontakt soyasi: turganda oyoq ostida, yotganda butun tana bo'ylab; o'tirganda o'rindiq soya beradi
    this.contact.visible = !d.seated;
    this.contact.position.set(0, 0.012, -0.8 * this.lie);
    this.contact.scale.set(0.8 + 0.1 * this.lie, 1, 0.8 + 1.3 * this.lie);

    // Ritsar: uzoqda soddalashtirilgan model (ozgina oraliq bilan - chegarada miltillamasin)
    if (this.rig === 'knight' && this.lods[1].length) {
      const dist = cameraPos.distanceTo(this.root.position);
      const want = this.lodLevel === 1 ? (dist < LOD_DIST - 1.5 ? 0 : 1) : dist > LOD_DIST + 1.5 ? 1 : 0;
      if (want !== this.lodLevel) {
        this.lodLevel = want;
        for (const m of this.lods[0]) m.visible = want === 0;
        for (const m of this.lods[1]) m.visible = want === 1;
      }
    }

    if (this.mixer) {
      const now = performance.now();
      const sit = SIT[this.rig === 'knight' ? 'knight' : 'human'];
      if (d.seated) {
        if (sit.variants.length && now > this.sitVariantAt && this.current?.name === sit.base) {
          // Vaqti-vaqti bilan tabiiy harakatlar (atrofga qarash, esnash...)
          this.play(sit.variants[Math.floor(Math.random() * sit.variants.length)], { once: true, fade: 0.6 });
          this.sitVariantAt = now + 12000 + Math.random() * 15000;
        } else if (this.current?.name !== sit.base && (!sit.variants.includes(this.current?.name as ClipName) || this.finished())) {
          this.play(sit.base, { fade: 0.6 });
          if (!this.sitVariantAt) this.sitVariantAt = now + 8000 + Math.random() * 10000;
        }
      } else if (d.pose && !(ONE_SHOT_POSES.includes(d.pose) && this.oneShotDoneAt === d.poseAt)) {
        const once = ONE_SHOT_POSES.includes(d.pose);
        this.play(poseClip(d.pose), { once });
        if (once && this.current?.name === poseClip(d.pose) && this.finished()) this.oneShotDoneAt = d.poseAt;
      } else if (d.gait === 0) {
        if (this.current?.name === 'idle_look' && !this.finished()) {
          /* atrofga qarash tugashini kutamiz */
        } else if (now > this.idleLookAt && this.current?.name === 'idle') {
          this.play('idle_look', { once: true, fade: 0.5 });
          this.idleLookAt = now + 10000 + Math.random() * 12000;
        } else {
          this.play('idle', { fade: 0.4 });
        }
      } else if (d.gait === 1) {
        this.play('walk', { timeScale: THREE.MathUtils.clamp(d.speed / 1.45, 0.6, 1.5), fade: 0.25 });
      } else {
        this.play('run', { timeScale: THREE.MathUtils.clamp(d.speed / 3.6, 0.7, 1.4), fade: 0.25 });
      }
      this.mixer.update(dt);
      this.root.updateMatrixWorld(true);
      if (d.seated && this.pelvis) {
        // Tos suyagini o'rindiq yostig'iga "o'tqazish" (silliq yaqinlashadi)
        this.pelvis.getWorldPosition(this.tmpV);
        this.tmpTarget.copy(SEAT_PELVIS).applyAxisAngle(UP, d.seatYaw).add(d.pos).sub(this.tmpV);
        this.seatFix.addScaledVector(this.tmpTarget, 1 - Math.exp(-12 * dt));
        this.root.position.copy(d.pos).add(this.seatFix);
        this.root.updateMatrixWorld(true);
      }
      this.applyHeadLook(dt, d);
    }

    // Nickname bosh ustida; uzoqlashgan sari biroz kattalashadi va xiralashadi
    if (this.head) this.head.getWorldPosition(this.headPos);
    else this.headPos.copy(this.root.position).y += 1.7;
    if (this.rHand) this.rHand.getWorldPosition(this.handPos);
    else this.handPos.copy(this.headPos).y -= 0.4;
    const plate = this.nameplate.sprite;
    plate.position.copy(this.headPos).y += 0.33;
    this.root.worldToLocal(plate.position);
    const dist = cameraPos.distanceTo(this.headPos);
    const s = THREE.MathUtils.clamp(0.55 + dist * 0.035, 0.6, 1.4);
    plate.scale.set(s, s * (112 / 512), 1);
    (plate.material as THREE.SpriteMaterial).opacity = 1 - THREE.MathUtils.smoothstep(dist, 14, 24);
  }

  private finished() {
    const a = this.current?.action;
    return !a || (a.loop === THREE.LoopOnce && a.time >= a.getClip().duration - 0.05);
  }

  /** Bosh va bo'yinni qarash yo'nalishiga burish (animatsiya ustidan). */
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private qp = new THREE.Quaternion();
  private axis = new THREE.Vector3();

  private applyHeadLook(dt: number, d: AvatarDrive) {
    const allow = !(d.pose === 'lie' || d.pose === 'dance' || d.pose === 'dance2');
    const yawRef = d.seated ? d.seatYaw : d.bodyYaw;
    const ty = allow ? THREE.MathUtils.clamp(angleDiff(d.headYaw, yawRef), -1.2, 1.2) : 0;
    const tp = allow ? THREE.MathUtils.clamp(d.headPitch, -0.7, 0.6) : 0;
    this.lookYaw = THREE.MathUtils.damp(this.lookYaw, ty, 10, dt);
    this.lookPitch = THREE.MathUtils.damp(this.lookPitch, tp, 10, dt);
    const forwardYaw = yawRef + this.lookYaw;
    // Oldinga yo'nalish (o'yin konvensiyasi: yaw 0 -> -Z)
    const fx = -Math.sin(forwardYaw), fz = -Math.cos(forwardYaw);
    this.axis.set(fx, 0, fz).cross(UP).normalize(); // F x Y: musbat burchak - yuqoriga
    for (const [bone, w] of [[this.neck, 0.4], [this.head, 0.6]] as const) {
      if (!bone || !bone.parent) continue;
      this.qa.setFromAxisAngle(UP, this.lookYaw * w);
      this.qb.setFromAxisAngle(this.axis, this.lookPitch * w);
      this.qa.premultiply(this.qb);
      bone.getWorldQuaternion(this.qb);
      this.qb.premultiply(this.qa);
      bone.parent.getWorldQuaternion(this.qp);
      bone.quaternion.copy(this.qp.invert().multiply(this.qb));
      bone.updateMatrixWorld(true);
    }
  }

  dispose() {
    this.disposed = true;
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
    this.nameplate.sprite.material.map?.dispose();
    this.nameplate.sprite.material.dispose();
    this.contact.geometry.dispose();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) (m.material as THREE.Material).dispose();
    });
  }
}
