import { FollowCam } from './camera';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { positionLocal, normalLocal, normalView, positionViewDirection, materialColor, mix, smoothstep, dot, vec3, attribute, float, step, pass, uniform } from 'three/tsl';
import { rgbShift } from 'three/addons/tsl/display/RGBShiftNode.js';
import { Game, L, W, CR, GL, GOAL_HALF, NET_DEPTH, TEAM, TeamDef, Ev, Skater, PR } from './sim';

// GLB assets (see assets/PLAN.md). Each one replaces a procedural model after it loads;
// if a file is missing or broken the procedural model simply stays.
const ASSET_URL = {
  crowd: new URL('../assets/models/crowd.glb', import.meta.url).href,
  // animated, skinned skater (assets/src/skater/): idle, stride, glide, wrist_shot, slapshot, check
  player: new URL('../assets/models/skater.glb', import.meta.url).href,
  net: new URL('../assets/models/net.glb', import.meta.url).href,
};
export type AssetState = 'procedural' | 'glb' | 'failed';

const BLUE = 0x1e90ff;

interface SkaterAnim {
  mixer: THREE.AnimationMixer; acts: Record<string, THREE.AnimationAction>; cur: string;
  shotT: number; shotKind: 'wrist' | 'slap'; prevWind: number; checkLen: number;
  rate: number;   // this skater's own rhythm (0.9 to 1.12), so the team doesn't stride in step
}
interface SkaterView {
  root: THREE.Group; body: THREE.Group; shadow: THREE.Mesh; fall: number; spin: number;
  anim?: SkaterAnim;
  /** skating feel (display only): smoothed heading, lean into turns, forward lean, hockey stop */
  feel?: { yaw: number; face: number; sp: number; lean: number; pitch: number; stopT: number; stopSide: number; effort: number; turn: number; hd: number };
  /** upper-body layer over the clips: spine and head bones, and this skater's own posture and rhythm */
  bones?: { sp2: THREE.Object3D; sp3: THREE.Object3D; head: THREE.Object3D };
  mb?: { twist: number; phase: number; posture: number; sway: number };
  stick?: THREE.Object3D; bladeDbg?: THREE.Mesh;
  /** goalie gear pieces and the skater-only kit (helmet, visor, stick); which set is showing; a save clip playing */
  gear?: THREE.Object3D[]; skaterKit?: THREE.Object3D[]; goalieLook?: boolean; outfit?: THREE.SkinnedMesh;
  gsave?: { clip: string; t: number; len: number };
  /** hit impact: a quick squash and lurch along the hit, so the contact lands with weight */
  /** squash and stretch from the feedback system: a > 0 squashes and lurches along (dx, dy), a < 0 stretches */
  crunch?: { t: number; len: number; dx: number; dy: number; a: number };
  /** stick IK: arm bones, and how strongly the blade is being driven to its target (0..1, eased) */
  arms?: { ua_r: THREE.Object3D; la_r: THREE.Object3D; h_r: THREE.Object3D; ua_l: THREE.Object3D; la_l: THREE.Object3D; h_l: THREE.Object3D };
  ikW?: number; ikT?: THREE.Vector3;
  /** test: how many frames the arm-clip guard had to drop the arm IK */
  ikGuard?: number;
  /** the stick prop's resting position in the glove (the IK moves it; restored every frame) */
  stickRest?: THREE.Vector3;
  /** the cloned skater model (mirrored on x for a left shot) */
  model?: THREE.Object3D;
  /** bones the upper-body layer and stick IK turn: the clip's pose for each, and what the layers left last frame */
  layer?: { bones: THREE.Object3D[]; base: THREE.Quaternion[]; out: THREE.Quaternion[]; ready: boolean };
}
/** locomotion loops and the phase (0..1) at which the left skate's push peaks in each, for phase-synced blends */
/** height the IK aims the blade's lowest band at: just above the ice, so the blade sits on it rather than in it */
const IK_Y = 0.12;
const LOCO: Record<string, number> = { stride: 0, cross_r: 0, cross_l: 0.5, back: 0 };
/** ground covered per clip cycle (sim units), for distance matching: play rate = speed x duration / distance */
const CYCLE_DIST: Record<string, number> = { stride: 6.7, cross_r: 5.2, cross_l: 5.2, back: 4.2 };
const wrapA = (a: number) => { if (!Number.isFinite(a)) return 0; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
/** Head and chest look (upper-body layer): gain on the angle to the puck, the yaw limit off the body (rad, split
 *  over spine and head), how fast it follows (per s), a deadzone against jitter at rest, and the angle past which
 *  the puck counts as behind (the head keeps the side it already looks over instead of whipping across). */
const HEAD = { gain: 0.55, max: 0.75, rate: 6, dead: 0.02, behind: 2.4 };
/** Stick IK limits (rad from the clip pose). The stick turns in the bottom glove first (stickAim); the arms only
 *  correct what is left, and are dropped if they would end up inside or behind the torso: torsoHalf is the torso's
 *  half width and chestFront how far in front of the chest centre a hand must stay (model metres), slack the margin. */
const ARM = { floor: 0.015, stickAim: 1.0, hand: 0.35, elbow: 0.3, shoulder: 0.3, topElbow: 0.5, topShoulder: 0.4, torsoHalf: 0.2, chestFront: 0.08, slack: 0.01 };
/** drawn look: two flat tones per colour plus a highlight, ink outline around every skater */
// debug switches for the look: ?nohull (no outline shell), ?noink (no contour ink), ?hulldbg (shell in magenta),
// ?nomask (old uniform shell), ?pose=clip:fraction (hold every skater in one pose)
const DBG = new URLSearchParams(location.search);
const PMAX = 900, PF = 12;
const INK = 0x2a3140, INK_W = 0.014, SKATER_SCALE = 1.4;

function roundedOutline(off: number, seg = 10): [number, number][] {
  const pts: [number, number][] = [];
  const ix = L - CR, iy = W - CR, r = CR + off;
  const corners: [number, number, number][] = [[ix, iy, 0], [-ix, iy, Math.PI / 2], [-ix, -iy, Math.PI], [ix, -iy, Math.PI * 1.5]];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  return pts;
}

// vertical camera: distance, elevation (rad) and how far ahead of the focus it looks
// pitch measured from the reference: about 38 degrees above the ice, not overhead
const CAM_DIST = 25, CAM_EL = 0.66, CAM_LEAD = 3;   // closer: skaters about as big on screen as the reference

export class View {
  renderer!: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 16 / 9, 1, 200);
  backend = 'unknown';
  private skaters: SkaterView[] = [];
  private teamMat: { body: THREE.MeshStandardMaterial; trim: THREE.MeshStandardMaterial }[] = [];
  private puck!: THREE.Mesh; private puckMat!: THREE.MeshStandardMaterial; private puckGlow!: THREE.Mesh; private puckStreak!: THREE.Mesh; private puckRing!: THREE.Mesh;
  /** high-visibility puck cue: a neon glow on the ice under it, and an x-ray ring drawn over anything in front of it */
  private puckHalo!: THREE.Mesh; private puckXray!: THREE.Mesh;
  /** dropped sticks lying on the ice */
  private looseSticks: THREE.Group[] = [];
  private ghosts: THREE.Mesh[] = [];
  private arrow!: THREE.Mesh; private disc!: THREE.Mesh; private discMat!: THREE.MeshBasicMaterial;
  private ring!: THREE.Mesh;
  private discInk!: THREE.Mesh; private beam!: THREE.Mesh; private toPuck!: THREE.Group;
  private camZ = 0; private camD = CAM_DIST; private cam = new FollowCam(CAM_DIST);
  /** test hook: camera follow state (look-ahead and lag) */
  camState() { return { ...this.cam.last, x: this.cam.x, z: this.cam.z, dist: this.cam.dist }; }
  private gems: THREE.Mesh[] = [];
  private parts!: THREE.InstancedMesh;
  /** pooled particles, PF floats each: x y z vx vy vz life size kind gravity maxLife drag */
  private pp = new Float32Array(PMAX * PF);
  private pcol: THREE.Color[] = [];
  private pn = 0; private pSteal = 0;
  /** particle budget (the feedback config can lower it) */
  pBudget = PMAX;
  /** ring pulses on the ice (catch pulse, release ring, impact ring) */
  private rings: { m: THREE.Mesh; t: number; life: number; r0: number; r1: number }[] = [];
  private ringI = 0;
  /** puck release snap: stretched along its path for a moment */
  private snapT = 0; private snapA = 0;
  /** camera offsets the feedback system writes every frame (shake, kick, punch, roll, fov) */
  fxCam = { ox: 0, oz: 0, roll: 0, fov: 0, punch: 0 };
  /** chromatic pulse: amount and direction; the post pass only runs while it is non-zero */
  private chromaAmt = uniform(0); private chromaAng = uniform(0);
  private post: THREE.RenderPipeline | null = null; private postWarm = 0;
  private decals: THREE.Mesh[] = []; private decalI = 0;
  private nets: THREE.Group[] = []; private lamps: THREE.MeshBasicMaterial[] = [];
  private bulge = [0, 0]; private lampT = [0, 0];
  private crowd!: THREE.InstancedMesh; private crowdBase: number[] = []; private cheer = 0;
  private fans: THREE.InstancedMesh[] = []; private fanSeat: number[] = []; // per seat: variant, index, rotY, scale
  /** which version of each swappable asset is on screen */
  assets: Record<string, AssetState> = { crowd: 'procedural', player: 'procedural', net: 'procedural' };
  // player GLB: the source texture has a white jersey and red gear, recoloured per team
  private playerSrc: ImageData | null = null;
  private playerTex: { cv: HTMLCanvasElement; tex: THREE.CanvasTexture }[] = [];
  private teamHex: [number, number][] = [[0xffffff, 0x222222], [0xffffff, 0x222222]];
  private helmetMat: THREE.MeshToonNodeMaterial[] = [];
  private gearBodyMat: THREE.MeshToonNodeMaterial[] = [];
  private gearTrimMat: THREE.MeshToonNodeMaterial[] = [];
  private outfitMats: THREE.MeshToonNodeMaterial[] = []; private goalieOutfit: THREE.MeshToonNodeMaterial[] = []; private goalieInk: THREE.MeshBasicNodeMaterial | null = null;
  assetsReady: Promise<void> = Promise.resolve();
  private hemi!: THREE.HemisphereLight; private sun!: THREE.DirectionalLight; private lightK = 1;
  private laneMesh!: THREE.Mesh; private laneMat!: THREE.MeshBasicMaterial;
  private zam!: THREE.Group;
  private shockMesh!: THREE.Mesh; private shockT = 0; private shockR = 1;
  private pow!: THREE.Group; private powT = 0; private powS = 1;
  private camX = 0; private t = 0;
  private dummy = new THREE.Object3D();
  private v3 = new THREE.Vector3();

  async init(canvas: HTMLCanvasElement, forceWebGL: boolean, assetMode: 'on' | 'off' | 'break' = 'on') {
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
    await this.renderer.init();
    this.backend = (this.renderer.backend as any).isWebGPUBackend ? 'webgpu' : 'webgl2';
    // at least 1.5x even on a 1x screen: the skaters are small on screen and soften badly at 1x
    this.renderer.setPixelRatio(Math.min(2, Math.max(window.devicePixelRatio, 1.5)));
    this.scene.background = new THREE.Color(0x0d1018);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x7f8fb5, 1.25);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.7);
    this.sun.position.set(6, 20, 9);
    this.scene.add(this.hemi, this.sun);
    this.buildRink();
    this.buildCrowd();
    this.buildActors();
    // assets load in the background so the game still starts at once
    if (assetMode !== 'off') this.assetsReady = this.loadAssets(assetMode === 'break');
    // chromatic pulse: a post pass used only while a pulse is running (plain render otherwise)
    if (!DBG.has('nopost')) {
      try {
        this.post = new THREE.RenderPipeline(this.renderer);
        this.post.outputNode = rgbShift(pass(this.scene, this.camera), this.chromaAmt, this.chromaAng);
        this.postWarm = 2;   // compile it on the first frames, not in the middle of the first goal
        this.assetsReady.then(() => { this.postWarm = 2; });
      } catch { this.post = null; }
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the full rink width on screen on tall windows
    this.camera.fov = 38;
    this.camera.updateProjectionMatrix();
  }

  private std(color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, flatShading: true, ...extra });
  }

  private buildRink() {
    // ice texture, drawn procedurally
    const cw = 3072, ch = Math.round(3072 * W / L), k = cw / (2 * L), px = (n: number) => n * k / 46.5;
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d')!;
    const X = (x: number) => (x + L) * k, Y = (y: number) => (y + W) * k;
    g.fillStyle = '#1a1e28'; g.fillRect(0, 0, cw, ch);
    g.beginPath();
    const out = roundedOutline(0, 16);
    out.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    g.closePath(); g.save(); g.clip();
    g.fillStyle = '#eaf2f9'; g.fillRect(0, 0, cw, ch);
    // skate scratches
    let sd = 7; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    g.lineWidth = px(1.2);
    for (let i = 0; i < 1400; i++) {
      g.strokeStyle = `rgba(150,180,215,${0.1 + r() * 0.22})`;
      const x = r() * cw, y = r() * ch, a = r() * 6.28, l = 20 + r() * 110;
      g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 40, y + Math.sin(a) * l * 0.5 + (r() - 0.5) * 40, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    // creases
    for (const s of [-1, 1]) {
      g.fillStyle = 'rgba(70,160,255,0.28)'; g.strokeStyle = '#d83a3a'; g.lineWidth = px(5);
      // half-circle crease in front of the net, which now stands out from the end boards
      const a0 = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.beginPath(); g.arc(X(s * GL), Y(0), 3.1 * k, a0, a0 + Math.PI); g.closePath(); g.fill(); g.stroke();
    }
    // lines
    g.fillStyle = '#d83a3a'; g.fillRect(X(0) - px(6), 0, px(12), ch);
    const BL = 0.3 * L;
    g.fillStyle = '#2f62d8'; g.fillRect(X(-BL) - px(7), 0, px(14), ch); g.fillRect(X(BL) - px(7), 0, px(14), ch);
    g.fillStyle = '#d83a3a'; g.fillRect(X(-GL) - px(3), 0, px(6), ch); g.fillRect(X(GL) - px(3), 0, px(6), ch);   // goal lines
    g.lineWidth = px(5); g.strokeStyle = '#d83a3a';
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      g.beginPath(); g.arc(X(sx * 0.66 * L), Y(sy * 0.5 * W), 4 * k, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#d83a3a'; g.beginPath(); g.arc(X(sx * 0.66 * L), Y(sy * 0.5 * W), 0.4 * k, 0, Math.PI * 2); g.fill();
    }
    // centre logo: a bolt in a ring
    const CC = 4.5;
    g.fillStyle = '#f6fafe'; g.beginPath(); g.arc(X(0), Y(0), CC * k, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2f62d8'; g.lineWidth = px(7); g.beginPath(); g.arc(X(0), Y(0), CC * k, 0, Math.PI * 2); g.stroke();
    // turn the bolt and wordmark so they read upright from the up-ice camera
    g.translate(X(0), Y(0)); g.rotate(Math.PI / 2); g.translate(-X(0), -Y(0));
    g.fillStyle = '#ffb400'; g.strokeStyle = '#23263a'; g.lineWidth = px(5); g.lineJoin = 'round';
    g.beginPath();
    const bolt = [[0.5, -2.4], [-1.3, 0.3], [-0.1, 0.3], [-0.6, 2.4], [1.3, -0.5], [0.1, -0.5]];
    bolt.forEach(([x, y], i) => (i ? g.lineTo(X(x * 1.3), Y(y * 1.3)) : g.moveTo(X(x * 1.3), Y(y * 1.3))));
    g.closePath(); g.fill(); g.stroke();
    g.font = `800 ${Math.round(px(44) * 1.3)}px system-ui, sans-serif`; g.textAlign = 'center'; g.fillStyle = '#23263a';
    g.fillText('FACEOFF', X(0), Y(0) - (CC + 0.4) * k);
    g.fillText('ARENA', X(0), Y(0) + (CC + 1.3) * k);
    g.restore();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const ice = new THREE.Mesh(new THREE.PlaneGeometry(2 * L, 2 * W), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0 }));
    ice.rotation.x = -Math.PI / 2;
    this.scene.add(ice);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4 * L + 60, 4 * W + 60), this.std(0x151923));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.03;
    this.scene.add(floor);

    // boards as instanced segments; the end boards are solid (the nets stand out in front of them)
    const segs: [number, number, number, number][] = [];
    const o = roundedOutline(0, 10);
    for (let i = 0; i < o.length; i++) { const a = o[i], b = o[(i + 1) % o.length]; segs.push([a[0], a[1], b[0], b[1]]); }
    const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1.1, 0.4), this.std(0xf4f6fa), segs.length);
    const cap = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.14, 0.5), this.std(0x2f62d8), segs.length);
    const kick = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.22, 0.46), this.std(0xffc93d), segs.length);
    segs.forEach(([x1, y1, x2, y2], i) => {
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      // push outward from rink centre
      const nx = -dy / len, ny = dx / len, sgn = nx * mx + ny * my > 0 ? 1 : -1;
      const d = this.dummy;
      d.position.set(mx + nx * sgn * 0.2, 0.55, my + ny * sgn * 0.2);
      d.rotation.set(0, -Math.atan2(dy, dx), 0); d.scale.set(len + 0.12, 1, 1); d.updateMatrix();
      wall.setMatrixAt(i, d.matrix);
      d.position.y = 1.15; d.updateMatrix(); cap.setMatrixAt(i, d.matrix);
      d.position.y = 0.11; d.updateMatrix(); kick.setMatrixAt(i, d.matrix);
    });
    this.scene.add(wall, cap, kick);

    // nets on the goal lines, with room to skate behind them
    for (const s of [-1, 1]) {
      const net = new THREE.Group();
      const red = this.std(0xe03131);
      const mesh = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, roughness: 1 });
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(NET_DEPTH, GOAL_HALF * 2), this.std(0xc9d6e6));
      fl.rotation.x = -Math.PI / 2; fl.position.set(NET_DEPTH / 2, 0.01, 0);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, GOAL_HALF * 2), mesh); back.position.set(NET_DEPTH, 0.65, 0);
      const top = new THREE.Mesh(new THREE.BoxGeometry(NET_DEPTH, 0.06, GOAL_HALF * 2), mesh); top.position.set(NET_DEPTH / 2, 1.3, 0);
      net.add(fl, back, top); back.userData.proc = top.userData.proc = true;
      for (const z of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.35, 0.16), red); post.position.set(0, 0.67, z * GOAL_HALF);
        const side = new THREE.Mesh(new THREE.BoxGeometry(NET_DEPTH, 1.3, 0.08), mesh); side.position.set(NET_DEPTH / 2, 0.65, z * GOAL_HALF);
        net.add(post, side); post.userData.proc = side.userData.proc = true;
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, GOAL_HALF * 2 + 0.16), red); bar.position.set(0, 1.35, 0);
      net.add(bar); bar.userData.proc = true;
      const lm = new THREE.MeshBasicMaterial({ color: 0x551111 });
      const lamp = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), lm); lamp.position.set(NET_DEPTH + 0.5, 1.8, 0);
      net.add(lamp); this.lamps.push(lm);
      net.position.set(s * GL, 0, 0); net.scale.x = s;
      this.scene.add(net); this.nets.push(net);
    }

    // gimmick props
    this.laneMat = new THREE.MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0, depthWrite: false });
    this.laneMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 2 * W), this.laneMat);
    this.laneMesh.rotation.x = -Math.PI / 2; this.laneMesh.position.y = 0.025; this.laneMesh.visible = false;
    this.scene.add(this.laneMesh);
    this.zam = new THREE.Group();
    const zb = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.5, 3.0), this.std(0x2a4fd0)); zb.position.y = 0.95;
    const zc = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.4), this.std(0xff8a1e)); zc.position.set(0, 2.1, -0.5);
    const zs = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.3, 0.5), this.std(0xdddddd)); zs.position.set(0, 0.2, 1.7);
    this.zam.add(zb, zc, zs); this.zam.visible = false; this.scene.add(this.zam);
    this.shockMesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0, depthWrite: false }));
    this.shockMesh.rotation.x = -Math.PI / 2; this.shockMesh.position.y = 0.06; this.scene.add(this.shockMesh);

    // impact ring: a quick, tight ring on the ice where a check lands
    this.pow = new THREE.Group();
    const pr = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    this.pow.add(pr); this.pow.rotation.x = -Math.PI / 2; this.pow.visible = false;
    this.scene.add(this.pow);

    // scuff decals
    const dg = new THREE.CircleGeometry(1, 10);
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ color: 0x7f9cc4, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.012 + i * 0.0003; m.visible = false;
      this.scene.add(m); this.decals.push(m);
    }
  }

  private buildCrowd() {
    const seats: [number, number, number][] = [];
    for (let row = 0; row < 4; row++) {
      const o = roundedOutline(2.6 + row * 1.15, 8);
      for (let i = 0; i < o.length; i++) {
        const a = o[i], b = o[(i + 1) % o.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / 1.0));
        for (let j = 0; j < n; j++) {
          const t = (j + 0.5) / n;
          seats.push([a[0] + (b[0] - a[0]) * t, 0.9 + row * 0.75, a[1] + (b[1] - a[1]) * t]);
        }
      }
    }
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
    this.crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 1.0, 0.7), mat, seats.length);
    const pal = [0xffb400, 0xe8e8ee, 0x394260, 0xc94a4a, 0x4a7bc9, 0x56a36c, 0x8a5fc9, 0x2a2e3d];
    const c = new THREE.Color();
    let sd = 11; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    seats.forEach(([x, y, z], i) => {
      this.dummy.position.set(x, y, z); this.dummy.rotation.set(0, 0, 0); this.dummy.scale.set(1, 0.8 + r() * 0.5, 1); this.dummy.updateMatrix();
      this.crowd.setMatrixAt(i, this.dummy.matrix);
      c.setHex(pal[Math.floor(r() * pal.length)]).multiplyScalar(0.55 + r() * 0.3);
      this.crowd.setColorAt(i, c);
      this.crowdBase.push(x, y, z, r() * 6.28);
    });
    this.scene.add(this.crowd);
  }

  /** view index -> team: skaters first, then one goalie per team */
  private static teamOf(i: number) { return i < TEAM * 2 ? (i < TEAM ? 0 : 1) : i - TEAM * 2; }

  // ------------------------------------------------------------ GLB assets
  private async loadAssets(breakUrls: boolean) {
    const loader = new GLTFLoader();
    const url = (k: keyof typeof ASSET_URL) => ASSET_URL[k] + (breakUrls ? '.missing' : '');
    const jobs: [string, () => Promise<void>][] = [
      ['crowd', () => this.loadCrowd(loader, url('crowd'))],
      ['player', () => this.loadPlayer(loader, url('player'))],
      ['net', () => this.loadNet(loader, url('net'))],
    ];
    await Promise.all(jobs.map(async ([name, job]) => {
      try { await job(); this.assets[name] = 'glb'; }
      catch (e) { this.assets[name] = 'failed'; console.warn(`[assets] ${name} did not load, keeping the procedural model`, e); }
    }));
  }

  /** every mesh in a GLB, with its node transform baked in */
  private static meshes(root: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    root.updateMatrixWorld(true);
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry = m.geometry.clone().applyMatrix4(m.matrixWorld);
      out.push(m);
    });
    return out;
  }

  /** spectators: low-poly people instanced onto the same seats the boxes used */
  private async loadCrowd(loader: GLTFLoader, url: string) {
    const gltf = await loader.loadAsync(url);
    const src = View.meshes(gltf.scene).sort((a, b) => a.name.localeCompare(b.name));
    if (!src.length) throw new Error('crowd.glb has no meshes');
    const B = this.crowdBase, n = B.length / 4;
    let sd = 23; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    const count = new Array(src.length).fill(0);
    const seat: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = Math.floor(r() * src.length);
      const x = B[i * 4], z = B[i * 4 + 2];
      // face the nearest point of the ice
      const tx = Math.max(-(L - CR), Math.min(L - CR, x)), tz = Math.max(-(W - CR), Math.min(W - CR, z));
      seat.push(v, count[v]++, Math.atan2(-(tz - z), tx - x) + (r() - 0.5) * 0.5, 1.25 + r() * 0.2);
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const fans = src.map((m, v) => new THREE.InstancedMesh(m.geometry, mat, Math.max(1, count[v])));
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const v = seat[i * 4];
      fans[v].setColorAt(seat[i * 4 + 1], c.setScalar(0.62 + r() * 0.3));
    }
    fans.forEach((f, v) => { f.count = count[v]; f.frustumCulled = false; });
    this.fans = fans; this.fanSeat = seat;
    this.placeFans(0);
    // the boxes stay as dark seating blocks under the spectators
    (this.crowd.material as THREE.MeshStandardMaterial).color.setHex(0x3a424e);
    const d = this.dummy;
    for (let i = 0; i < n; i++) {
      d.position.set(B[i * 4], B[i * 4 + 1] - 0.55, B[i * 4 + 2]); d.rotation.set(0, 0, 0); d.scale.set(1.5, 1, 1.5); d.updateMatrix();
      this.crowd.setMatrixAt(i, d.matrix);
      this.crowd.setColorAt(i, c.setScalar(0.5));
    }
    this.crowd.instanceMatrix.needsUpdate = true;
    if (this.crowd.instanceColor) this.crowd.instanceColor.needsUpdate = true;
    this.scene.add(...fans);
  }

  /** toon material that also inks contours: wherever the surface turns away from the camera it goes to ink,
   *  which outlines arms, helmet and breezers inside the silhouette, not just around it */
  private static inkToon(params: THREE.MeshToonMaterialParameters, band: [number, number] = [0.1, 0.24]): THREE.MeshToonNodeMaterial {
    const m = new THREE.MeshToonNodeMaterial(params);
    const facing = dot(normalView, positionViewDirection).abs();
    const keep = smoothstep(band[0], band[1], facing);   // edge ink on the surface itself: outlines without poking through
    const ink = new THREE.Color(INK);
    if (!DBG.has('noink')) m.colorNode = mix(vec3(ink.r, ink.g, ink.b), materialColor, keep);
    return m;
  }

  /** Per-vertex goalie bulk (0..1), stored as the 'bulk' attribute on the outfit: how much each vertex rides on the
   *  torso and arm bones (chest protector and arm pads sit there), nothing on the legs (the pads cover them), hands
   *  or head. Computed once per geometry from the skin weights. */
  private static goalieBulk(m: THREE.SkinnedMesh) {
    const g = m.geometry; if (g.getAttribute('bulk')) return;
    const W: Record<string, number> = { spine_01: 0.45, spine_02: 1, spine_03: 1, clavicle_l: 0.9, clavicle_r: 0.9, upperarm_l: 0.8, upperarm_r: 0.8, lowerarm_l: 0.55, lowerarm_r: 0.55, neck_01: 0.25, pelvis: 0.35 };
    const per = m.skeleton.bones.map(b => W[b.name] ?? 0);
    const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight'), n = g.getAttribute('position').count;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { let b = 0; for (let k = 0; k < 4; k++) b += per[si.getComponent(i, k)] * sw.getComponent(i, k); out[i] = Math.min(1, b); }
    // Where the arm rests against the torso, both surfaces are pushed out along their own normals, toward each other,
    // so they cut into each other and the outline shell shows along the cut (a dark line across the chest). The
    // inner side of the arm and the sides of the torso are pushed out less. (Bind pose: the body's midline is x = 0.)
    {
      const p = g.getAttribute('position'), nr = g.getAttribute('normal');
      const armBone = m.skeleton.bones.map(b => /^(upperarm|lowerarm)/.test(b.name) ? 1 : 0);
      const trunkBone = m.skeleton.bones.map(b => /^(spine|clavicle|pelvis)/.test(b.name) ? 1 : 0);
      const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      for (let i = 0; i < n; i++) {
        let arm = 0, trunk = 0;
        for (let k = 0; k < 4; k++) { const j = si.getComponent(i, k), w = sw.getComponent(i, k); arm += armBone[j] * w; trunk += trunkBone[j] * w; }
        const px = p.getX(i), nx = nr.getX(i);
        if (arm > 0.5 && Math.abs(px) > 1e-3) out[i] *= 1 - 0.65 * ss(0.2, 0.6, -Math.sign(px) * nx);   // inner arm faces the midline
        if (trunk > 0.5) out[i] *= 1 - 0.45 * ss(0.45, 0.8, Math.abs(nx));                             // flanks face the arms
      }
    }
    // Smooth it over the surface: a sharp step in bulk (spine_01 0.45 next to spine_02 1, the pelvis 0.35) creases
    // the inflated jersey, and the outline shell pokes out of the crease as a dark slash. Vertices that share a
    // position (UV seams) are one point here.
    const p = g.getAttribute('position'), idx = g.getIndex();
    const key = (i: number) => `${Math.round(p.getX(i) * 2000)},${Math.round(p.getY(i) * 2000)},${Math.round(p.getZ(i) * 2000)}`;
    const ids = new Map<string, number>(), vid = new Int32Array(n);
    for (let i = 0; i < n; i++) { const k = key(i); let v = ids.get(k); if (v === undefined) { v = ids.size; ids.set(k, v); } vid[i] = v; }
    const nv = ids.size, nb: number[][] = Array.from({ length: nv }, () => []);
    const tri = idx ? idx.count : n;
    for (let t = 0; t < tri; t += 3) {
      const a = vid[idx ? idx.getX(t) : t], b = vid[idx ? idx.getX(t + 1) : t + 1], c = vid[idx ? idx.getX(t + 2) : t + 2];
      nb[a].push(b, c); nb[b].push(a, c); nb[c].push(a, b);
    }
    let val = new Float32Array(nv); const cnt = new Float32Array(nv);
    for (let i = 0; i < n; i++) { val[vid[i]] += out[i]; cnt[vid[i]]++; }
    for (let j = 0; j < nv; j++) val[j] /= cnt[j] || 1;
    for (let pass = 0; pass < 4; pass++) {
      const nx = new Float32Array(nv);
      for (let j = 0; j < nv; j++) { let s = val[j], c = 1; for (const q of nb[j]) { s += val[q]; c++; } nx[j] = s / c; }
      val = nx;
    }
    for (let i = 0; i < n; i++) out[i] = val[vid[i]];
    g.setAttribute('bulk', new THREE.BufferAttribute(out, 1));
    // the shins, knees and boots stand behind the leg pads; pulled in a little they stay behind the pads when the
    // knee bends (the 'gleg' weight: calf, foot and ball bones, and half the thigh)
    const legBone = m.skeleton.bones.map(b => /^(calf|foot|ball)_/.test(b.name) ? 1 : /^thigh_/.test(b.name) ? 0.5 : 0);
    const leg = new Float32Array(n);
    for (let i = 0; i < n; i++) { let l = 0; for (let k = 0; k < 4; k++) l += legBone[si.getComponent(i, k)] * sw.getComponent(i, k); leg[i] = Math.min(1, l); }
    g.setAttribute('gleg', new THREE.BufferAttribute(leg, 1));
    // the bare hands sit inside the blocker and catching glove; on a goalie they are not drawn (the 'ghand' weight:
    // hand and finger bones)
    const handBone = m.skeleton.bones.map(b => /^(hand|thumb|index|middle|ring|pinky)_/.test(b.name) ? 1 : 0);
    const hand = new Float32Array(n);
    for (let i = 0; i < n; i++) { let h = 0; for (let k = 0; k < 4; k++) h += handBone[si.getComponent(i, k)] * sw.getComponent(i, k); hand[i] = Math.min(1, h); }
    g.setAttribute('ghand', new THREE.BufferAttribute(hand, 1));
  }

  /** Per-vertex outline-shell thickness (0..1), stored as the 'outlineW' attribute. The inflated shell pokes
   *  through the body where two parts fold against each other, so it shrinks to near zero there:
   *  - skinned meshes: vertices shared between a tight pair of bones (torso/upper arm = shoulder and armpit,
   *    neck/collar, hip/thigh) by how evenly they are shared; the neck itself; the collarbone area
   *  - the helmet (one bone): its lower rim, which sits on the shoulders and collar
   *  - anything else (stick): full thickness */
  private static outlineWeights(mesh: THREE.Mesh, kind: 'body' | 'helmet' | 'rigid') {
    const g = mesh.geometry;
    if (g.getAttribute('outlineW')) return;
    const n = g.getAttribute('position').count, w = new Float32Array(n).fill(1);
    if (DBG.has('nomask')) { g.setAttribute('outlineW', new THREE.BufferAttribute(w, 1)); return; }   // old uniform shell, for comparisons
    const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    if (kind === 'body') {
      const sk = mesh as THREE.SkinnedMesh, si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
      const part = (b: number) => sk.skeleton.bones[b].name.replace(/_[lr]$/, '').replace(/^lowerarm_twist.*/, 'lowerarm');
      const tight = new Set(['spine_03|upperarm', 'clavicle|upperarm', 'spine_02|upperarm', 'clavicle|spine_03', 'clavicle|neck_01',
        'neck_01|spine_03', 'Head|neck_01', 'pelvis|thigh', 'spine_01|thigh']);
      for (let v = 0; v < n; v++) {
        const pairs = [0, 1, 2, 3].map(k => [sw.getComponent(v, k), si.getComponent(v, k)] as [number, number]).sort((x, y) => y[0] - x[0]);
        const a = part(pairs[0][1]), b = pairs[1][0] > 0.02 ? part(pairs[1][1]) : a;
        let k = 1;
        if (a !== b && tight.has([a, b].sort().join('|'))) k = 1 - ss(0.06, 0.32, pairs[1][0]);   // evenly shared = deep in the fold
        if (a === 'neck_01' || a === 'Head') k = Math.min(k, 0.05);   // under the helmet and behind the clear visor: an outline here only shows through the visor
        if (a === 'clavicle') k = Math.min(k, 0.3);
        w[v] = Math.max(0.05, k);
      }
    } else if (kind === 'helmet') {
      g.computeBoundingBox(); const bb = g.boundingBox!, p = g.getAttribute('position');
      const lo = bb.min.y, h = bb.max.y - bb.min.y;
      for (let v = 0; v < n; v++) w[v] = 0.1 + 0.9 * ss(0.15, 0.45, (p.getY(v) - lo) / h);   // thin at the rim, full on the dome
    }
    g.setAttribute('outlineW', new THREE.BufferAttribute(w, 1));
  }

  /** skaters: one animated, skinned skater per view, drawn with flat cel shading and an ink outline.
   *  The box skater stays underneath, hidden, as the fallback. */
  private async loadPlayer(loader: GLTFLoader, url: string) {
    const gltf = await loader.loadAsync(url);
    let map: THREE.Texture | null = null;
    gltf.scene.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && (m.material as THREE.MeshStandardMaterial).map) map = (m.material as THREE.MeshStandardMaterial).map; });
    const src = map as THREE.Texture | null;
    if (!src || !src.image || gltf.animations.length < 4) throw new Error('skater.glb is missing its textured outfit or its clips');
    const img = src.image as CanvasImageSource & { width: number; height: number };
    const read = document.createElement('canvas'); read.width = img.width; read.height = img.height;
    const rc = read.getContext('2d', { willReadFrequently: true })!;
    rc.drawImage(img, 0, 0);
    this.playerSrc = rc.getImageData(0, 0, read.width, read.height);
    // comic shading: one crisp shadow tone and one light tone
    const ramp = new THREE.DataTexture(new Uint8Array([172, 176, 190, 255, 244, 245, 248, 255]), 2, 1);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
    const outfitMats = [0, 1].map(() => {
      const cv = document.createElement('canvas'); cv.width = read.width; cv.height = read.height;
      const tex = new THREE.CanvasTexture(cv);
      tex.flipY = src.flipY; tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = src.wrapS; tex.wrapT = src.wrapT;
      tex.anisotropy = 8;   // stripes stay crisp on surfaces seen at an angle
      this.playerTex.push({ cv, tex });
      return View.inkToon({ map: tex, gradientMap: ramp });
    });
    this.tintPlayers();
    // Goalies wear the same jersey, filled out over chest protector and arm pads: the jersey itself is pushed out
    // along its normals by the per-vertex 'bulk' attribute (torso and arms only, see goalieBulk), so he stays a
    // human shape, just bigger up top, instead of having shapes stuck on.
    const BULK = 0.05, LEG_IN = 0.02;   // legs pulled in 2 cm (behind the pads)
    const goaliePush = attribute('bulk', 'float').mul(BULK).sub(attribute('gleg', 'float').mul(LEG_IN));
    // A goalie's bare hands are always inside the blocker and catching glove, so they are not drawn at all (the 'ghand'
    // weight: hand and finger bones): pulled in, the knuckles still showed through the glove's pocket.
    const noHands = float(1).sub(step(0.5, attribute('ghand', 'float')));
    const bulkPos = positionLocal.add(normalLocal.mul(goaliePush));
    this.outfitMats = outfitMats;
    this.goalieOutfit = outfitMats.map(m => { const g = View.inkToon({ map: m.map, gradientMap: ramp }); g.positionNode = bulkPos; g.opacityNode = noHands; g.alphaTest = 0.5; return g; });
    this.helmetMat = [0, 1].map(t => View.inkToon({ color: new THREE.Color(this.teamHex[t][1]).lerp(new THREE.Color(0x8a8f99), 0.25), gradientMap: ramp }));
    // Goalie gear is hard-surface (panels, split normals at creases): it has no outline shell and only a narrow
    // contour band, so just faces seen nearly edge-on ink: lines at panel edges and silhouettes. With the body's
    // wide band, whole panels turned a little from the camera went black.
    const GEAR_INK: [number, number] = [0.03, 0.09];
    this.gearBodyMat = [0, 1].map(t => View.inkToon({ color: new THREE.Color(this.teamHex[t][0]).lerp(new THREE.Color(0x8a8f99), 0.25), gradientMap: ramp }, GEAR_INK));
    this.gearTrimMat = [0, 1].map(t => View.inkToon({ color: new THREE.Color(this.teamHex[t][1]).lerp(new THREE.Color(0x8a8f99), 0.25), gradientMap: ramp }, GEAR_INK));
    let gearDarkMat: THREE.Material | null = null;
    // ?hulldbg paints the shell magenta so any poke-through is easy to spot in test frames
    const ink = new THREE.MeshBasicNodeMaterial({ color: DBG.has('hulldbg') ? 0xff00ff : INK, side: THREE.BackSide,
      // pushed slightly back in depth: a sliver of shell just in front of the body loses to the body
      polygonOffset: !DBG.has('nomask'), polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
    ink.positionNode = positionLocal.add(normalLocal.mul(attribute('outlineW', 'float').mul(INK_W)));
    // the goalie's outline shell follows the bulked jersey
    this.goalieInk = ink.clone() as THREE.MeshBasicNodeMaterial;
    this.goalieInk.positionNode = positionLocal.add(normalLocal.mul(attribute('outlineW', 'float').mul(INK_W).add(goaliePush)));
    this.goalieInk.opacityNode = noHands; this.goalieInk.alphaTest = 0.5;
    const toon = new Map<THREE.Material, THREE.Material>();
    const toToon = (m: THREE.Material) => {
      let t = toon.get(m);
      if (!t) {
        const s = m as THREE.MeshStandardMaterial;
        t = s.transparent ? new THREE.MeshToonMaterial({ color: s.color, map: s.map, gradientMap: ramp, transparent: true, opacity: s.opacity, side: s.side })
          : View.inkToon({ color: s.color, map: s.map, gradientMap: ramp, side: s.side });
        toon.set(m, t);
      }
      return t;
    };
    this.skaters.forEach((v, i) => {
      const team = View.teamOf(i);
      const model = SkeletonUtils.clone(gltf.scene) as THREE.Object3D;
      const hulls: THREE.Object3D[] = [];
      model.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const name = (m.material as THREE.Material).name || '';
        if ((m as THREE.SkinnedMesh).isSkinnedMesh && (m.material as THREE.MeshStandardMaterial).map) { m.material = outfitMats[team]; v.outfit = m as THREE.SkinnedMesh; View.goalieBulk(m as THREE.SkinnedMesh); }
        else if (name.startsWith('helmet')) m.material = this.helmetMat[team];
        else if (name === 'gear_body') m.material = this.gearBodyMat[team];   // goalie gear: white takes the team colour
        else if (name === 'gear_trim') m.material = this.gearTrimMat[team];   // and red the trim, like the helmets
        else if (name === 'gear_dark') m.material = gearDarkMat ??= View.inkToon({ color: (m.material as THREE.MeshStandardMaterial).color, gradientMap: ramp }, GEAR_INK);
        else m.material = toToon(m.material as THREE.Material);
        m.frustumCulled = false;
        // no outline shell on the visor, the thin skate blades or the goalie's cage bars: there it pokes through
        // as dark spikes (the stick is a plain box, so its shell is clean)
        // Nor on any goalie gear (g_*: pads, blocker, glove, mask, cage, stick): hard props built from panels, where a
        // shell shows through holes and gaps or pokes through the panel over it as black shards. Their outlines are
        // the contour ink on their split normals (GEAR_INK).
        const gear = /^g_/.test(o.name) || /^g_/.test(o.parent?.name ?? '');
        if (name.startsWith('visor') || name.startsWith('blade') || gear) return;
        const sk = m as THREE.SkinnedMesh;
        View.outlineWeights(m, sk.isSkinnedMesh && !name.startsWith('helmet') ? 'body' : name.startsWith('helmet') ? 'helmet' : 'rigid');
        let hull: THREE.Mesh;
        if (sk.isSkinnedMesh) { const h = new THREE.SkinnedMesh(sk.geometry, ink); h.bind(sk.skeleton, sk.bindMatrix); hull = h; }
        else hull = new THREE.Mesh(m.geometry, ink);
        hull.position.copy(m.position); hull.quaternion.copy(m.quaternion); hull.scale.copy(m.scale);
        hull.frustumCulled = false; hulls.push(hull); m.userData.hull = hull; (m.parent as THREE.Object3D).userData.hulls ??= [];
        ((m.parent as THREE.Object3D).userData.hulls as THREE.Object3D[]).push(hull);
      });
      if (!DBG.has('nohull')) model.traverse(o => { for (const h of (o.userData.hulls as THREE.Object3D[] | undefined) ?? []) o.add(h); });
      // the model faces +Z and is 1.8 m tall; the box skater faces +X and is about 2.25 units
      model.rotation.y = Math.PI / 2; model.scale.setScalar(SKATER_SCALE);
      model.position.y = 0.02;   // blades sit exactly on the ice in Blender; a hair above stops them flickering into it
      for (const c of v.body.children) c.visible = false;
      v.body.add(model); v.model = model;
      // goalie gear (g_* pieces) vs the skater's helmet, visor and stick: one or the other is shown
      v.gear = []; v.skaterKit = [];
      model.traverse(o => {
        if (o.name.startsWith('g_')) v.gear!.push(o);   // a gear piece: a mesh, or a group of meshes (several materials)
        else if (((o as THREE.Mesh).isMesh && /^(helmet|visor)/.test(o.name)) || (o.name === 'stick' && o.parent?.name === 'hand_r')) v.skaterKit!.push(o);
      });
      this.setGoalieLook(v, false);
      const sp2 = model.getObjectByName('spine_02'), sp3 = model.getObjectByName('spine_03'), head = model.getObjectByName('Head');
      if (sp2 && sp3 && head) v.bones = { sp2, sp3, head };
      v.mb = { twist: 0, phase: Math.random() * Math.PI * 2, posture: (Math.random() - 0.5) * 0.12, sway: 0.6 + Math.random() * 0.8 };
      const mixer = new THREE.AnimationMixer(model), acts: Record<string, THREE.AnimationAction> = {};
      for (const clip of gltf.animations) {
        const a = mixer.clipAction(clip);
        if (!['idle', 'stride', 'glide', 'goalie', 'cross_l', 'cross_r', 'back', 'handle'].includes(clip.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        acts[clip.name] = a;
      }
      acts.idle.play();
      v.anim = { mixer, acts, cur: 'idle', shotT: 0, shotKind: 'wrist', prevWind: -1, checkLen: 0, rate: 0.9 + Math.random() * 0.22 };
    });
  }

  /** The stick's blade and the bottom hand's grip, in the stick mesh's own space. Found once from the geometry in
   *  the first animated pose (lowest vertices = blade; the point on the shaft nearest the left hand = grip), so it
   *  does not depend on how the exporter laid out the mesh. */
  private stickGeo: { blade: THREE.Vector3; top: THREE.Vector3; gripT: number; band?: THREE.Vector3[] } | null = null;
  private stickOf(v: SkaterView) {
    // the stick node (a group of wood and tape meshes, parented to the top hand)
    if (!v.stick) v.body.traverse(o => { if (!v.stick && o.name === 'stick' && o.parent?.name === 'hand_r') v.stick = o; });
    const st = v.stick; if (!st) return null;
    if (!this.stickGeo) {
      // The stick mesh is stored in its ready pose with +Y up (Blender Z-up becomes glTF Y-up), so the blade is the
      // lowest band of vertices in the stick's own space, and the knob is the vertex furthest from it.
      v.root.updateMatrixWorld(true);
      const all: THREE.Vector3[] = [];
      st.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh || (m.material as THREE.Material).side === THREE.BackSide) return;   // skip outline shells
        const pos = m.geometry.attributes.position, toSt = new THREE.Matrix4().copy(st.matrixWorld).invert().multiply(m.matrixWorld);
        for (let i = 0; i < pos.count; i++) all.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toSt));
      });
      if (all.length < 8) return st;
      all.sort((a, b) => a.y - b.y);
      const n = Math.max(3, Math.floor(all.length * 0.08)), blade = new THREE.Vector3();
      for (let i = 0; i < n; i++) blade.add(all[i]); blade.divideScalar(n);
      const top = all.reduce((b, a) => a.distanceTo(blade) > b.distanceTo(blade) ? a : b, blade).clone();
      // heel and toe: the two ends of the blade's bottom band (keeping the whole blade above the ice, not just its middle)
      const low = all.slice(0, n), heel = low.reduce((b, a) => a.distanceTo(blade) > b.distanceTo(blade) ? a : b, blade).clone();
      const toe = low.reduce((b, a) => a.distanceTo(heel) > b.distanceTo(heel) ? a : b, heel).clone();
      this.stickGeo = { blade, top, gripT: -1, band: [blade, heel, toe] };
    }
    if (this.stickGeo.gripT < 0 && v.anim && v.anim.cur !== 'idle') {
      // where the other (top) hand holds the shaft, read once from a real pose with the stick pointing down
      v.root.updateMatrixWorld(true);
      const g = this.stickGeo, wb = g.blade.clone().applyMatrix4(st.matrixWorld), wt = g.top.clone().applyMatrix4(st.matrixWorld);
      const hl = v.body.getObjectByName('hand_l');
      if (hl && wt.y > wb.y + 0.5) {
        const hw = new THREE.Vector3(); hl.getWorldPosition(hw); const ax = g.top.clone().sub(g.blade);
        g.gripT = Math.max(0.05, Math.min(1, st.worldToLocal(hw).sub(g.blade).dot(ax) / ax.lengthSq()));
      }
    }
    return st;
  }

  /** test hook: the stick geometry found, and world heights of its two ends and the hands for skater i */
  stickDebug(i: number) {
    const v = this.skaters[i]; if (!v) return null; const st = this.stickOf(v); if (!st || !this.stickGeo) return { found: !!st };
    v.root.updateMatrixWorld(true);
    const wb = this.stickGeo.blade.clone().applyMatrix4(st.matrixWorld), wt = this.stickGeo.top.clone().applyMatrix4(st.matrixWorld);
    const hl = new THREE.Vector3(), hr = new THREE.Vector3(); v.body.getObjectByName('hand_l')?.getWorldPosition(hl); v.body.getObjectByName('hand_r')?.getWorldPosition(hr);
    const r = (q: THREE.Vector3) => [+q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2)];
    let meshes = 0; const lo = new THREE.Vector3(0, 1e9, 0), w = new THREE.Vector3(); const info: string[] = [];
    st.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; meshes++; info.push(`${m.type}:${m.name}:${(m.material as THREE.Material).side}:${(m as THREE.SkinnedMesh).isSkinnedMesh ? 'skinned' : ''}`);
      if ((m.material as THREE.Material).side === THREE.BackSide) return;
      const pos = m.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { w.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); if (w.y < lo.y) lo.copy(w); } });
    return { meshes, info, lowestWorld: r(lo), gripT: +this.stickGeo.gripT.toFixed(2), bladeL: r(this.stickGeo.blade), topL: r(this.stickGeo.top), blade: r(wb), top: r(wt), handL: r(hl), handR: r(hr), root: r(v.root.position) };
  }

  /** The upper-body layer and the stick IK turn bones on top of the clip pose. three.js's mixer only writes a bone
   *  when its clip value changed since last frame, so on a frame where the pose is static (title screen and
   *  pre-game run the clips at dt 0, hit stop, a held wind-up, any scrubbed clip) the bone still holds last frame's
   *  layered rotation, and turning it again would stack: the head, spine and arms spin. So before layering, a bone
   *  the mixer left alone is put back to its clip pose, and the clip pose is remembered whenever the mixer wrote. */
  private layerBones(v: SkaterView) {
    if (v.layer) return v.layer;
    const bones = ['spine_02', 'spine_03', 'Head', 'upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l']
      .map(n => v.body.getObjectByName(n)).filter((b): b is THREE.Object3D => !!b);
    const st = this.stickOf(v);   // the stick prop is never animated, so its turn in the glove would stack too
    if (st) { bones.push(st); v.stickRest = st.position.clone(); }
    return (v.layer = { bones, base: bones.map(() => new THREE.Quaternion()), out: bones.map(() => new THREE.Quaternion()), ready: false });
  }
  private layerRestore(v: SkaterView) {
    const L = this.layerBones(v);
    if (v.stick && v.stickRest) v.stick.position.copy(v.stickRest);
    L.bones.forEach((b, i) => {
      if (L.ready && b.quaternion.equals(L.out[i])) { if (!DBG.has('nolayerfix')) b.quaternion.copy(L.base[i]); }   // mixer skipped it: back to the clip pose (?nolayerfix shows the old bug)
      else L.base[i].copy(b.quaternion);   // the mixer wrote a fresh clip pose
    });
  }
  private layerSave(v: SkaterView) {
    const L = this.layerBones(v);
    L.bones.forEach((b, i) => L.out[i].copy(b.quaternion));
    L.ready = true;
  }

  /** test hook: upper-body look (twist) and how far each layered bone sits from its clip pose (rad). Bounded when
   *  the layer is healthy; it grows without limit if layered rotations stack (the old spinning-head bug). */
  headState(i: number) {
    const v = this.skaters[i], L = v?.layer; if (!v || !L || !L.ready) return null;
    const dev = L.bones.map((b, k) => b.quaternion.angleTo(L.base[k]));
    const bad = L.bones.some(b => !Number.isFinite(b.quaternion.x + b.quaternion.y + b.quaternion.z + b.quaternion.w));
    return { twist: v.mb?.twist ?? 0, head: dev[2] ?? 0, spine: Math.max(dev[0] ?? 0, dev[1] ?? 0), arms: Math.max(0, ...dev.slice(3)), nan: bad, mirrored: (v.model?.scale.x ?? 1) < 0 };
  }

  /** test hook: arm clipping. Closest distance (model units, 1 = skater height / 1.8 m) from each elbow and hand to the
   *  torso's centre line (pelvis to neck), and where the blade is relative to the puck target. */
  armState(i: number) {
    const v = this.skaters[i]; if (!v?.model) return null;
    v.root.updateMatrixWorld(true);
    const P = (n: string) => { const o = v.body.getObjectByName(n); return o ? o.getWorldPosition(new THREE.Vector3()) : null; };
    const a = P('pelvis'), b = P('neck_01'); if (!a || !b) return null;
    const seg = (q: THREE.Vector3) => { const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / ab.lengthSq())); return q.distanceTo(a.clone().addScaledVector(ab, t)) / SKATER_SCALE; };
    const r: Record<string, number> = {};
    for (const n of ['lowerarm_r', 'hand_r', 'lowerarm_l', 'hand_l']) { const q = P(n); if (q) r[n] = +seg(q).toFixed(3); }
    return { ...r, ikW: +(v.ikW ?? 0).toFixed(2), clip: v.anim?.cur, guard: v.ikGuard ?? 0 };
  }

  /** test hook: lowest point of skater i's stick blade (world height, ice = 0) and, for the carrier, how far the
   *  drawn puck is from the drawn blade, and the puck's side offset toward the shot side */
  stickState(i: number) {
    const v = this.skaters[i], st = v ? this.stickOf(v) : null, g = this.stickGeo; if (!v || !st || !g || !st.visible) return null;
    st.updateWorldMatrix(true, false);
    const low = this.bladeLow(st), bw = g.blade.clone().applyMatrix4(st.matrixWorld);
    const s = this.game?.skaters[i], p = this.game?.pucks[0];
    if (!s || !p || p.owner !== s) return { low };
    const px = this.puck.position.x, pz = this.puck.position.z;
    return { low, gap: Math.hypot(bw.x - px, bw.z - pz), lat: (-Math.sin(s.face) * (px - s.x) + Math.cos(s.face) * (pz - s.y)) * s.hand };
  }

  /** debug overlay (; key or ?movedbg): white arrow = facing, yellow = skating direction and speed */
  moveDbg = DBG.has('movedbg');
  private dbgArrows: THREE.ArrowHelper[][] = [];
  private drawMoveDbg(i: number, s: Skater) {
    const a = this.dbgArrows[i] ??= [0xffffff, 0xffd400].map(c => { const h = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, c, 0.45, 0.3); this.scene.add(h); return h; });
    const sp = Math.hypot(s.vx, s.vy);
    a[0].visible = s.out <= 0; a[0].position.set(s.x, 0.2, s.y); a[0].setDirection(new THREE.Vector3(Math.cos(s.face), 0, Math.sin(s.face))); a[0].setLength(2.2, 0.45, 0.3);
    a[1].position.set(s.x, 0.25, s.y); a[1].visible = sp > 0.3 && s.out <= 0;
    if (sp > 0.3) { a[1].setDirection(new THREE.Vector3(s.vx / sp, 0, s.vy / sp)); a[1].setLength(0.6 + sp * 0.22, 0.4, 0.28); }
  }

  /** turn the stick in the bottom glove, about the glove, so `from` (a point on the stick) heads toward `to` */
  private tsA = new THREE.Vector3(); private tsB = new THREE.Vector3();
  private turnStick(v: SkaterView, st: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, lim: number) {
    const glove = v.arms?.h_r ?? st.parent!, a = glove.getWorldPosition(this.tsA);
    const e = from.sub(a), t = to.clone().sub(a);
    if (e.lengthSq() < 1e-6 || t.lengthSq() < 1e-6) return;
    const ang = Math.min(lim, e.angleTo(t)); if (!(ang >= 1e-4)) return;
    const pivL = st.worldToLocal(a.clone());
    this.rotWorld(st, this.tsB.crossVectors(e, t), ang);
    const moved = st.localToWorld(pivL);   // keep the glove's grip point where it was
    st.position.add(st.parent!.worldToLocal(a.clone()).sub(st.parent!.worldToLocal(moved)));
    st.updateMatrixWorld(true);
  }

  /** Keep the whole blade (heel, middle, toe) on or above the ice: the clips swing it through the floor on the
   *  stride and the IK can aim a little low, so after both the stick turns up in the glove until it clears. */
  private stickFloor(v: SkaterView) {
    const st = v.stick, g = this.stickGeo; if (!st || !g || !st.visible) return;
    st.updateWorldMatrix(true, false);
    for (let it = 0; it < 6; it++) {
      const low = this.bladeLow(st); if (low >= ARM.floor) return;
      const c = g.blade.clone().applyMatrix4(st.matrixWorld);
      this.turnStick(v, st, c.clone(), c.clone().setY(c.y + (ARM.floor - low) + 0.01), 0.8);
    }
  }

  /** lowest world height of the blade: its centre and the two ends of the bottom band (heel and toe) */
  private bladeLow(st: THREE.Object3D): number {
    const g = this.stickGeo!; let m = 1e9; const q = new THREE.Vector3();
    for (const pt of g.band ?? [g.blade]) m = Math.min(m, q.copy(pt).applyMatrix4(st.matrixWorld).y);
    return m;
  }

  /** Turn a bone by `ang` about a world-space axis. A left shot's model is mirrored (negative x scale), and a
   *  rotation seen through a mirror turns the other way about the mirrored axis, so the axis and angle are taken
   *  through the parent's full transform, reflection included (decompose puts the reflection on x). */
  private rwP = new THREE.Vector3(); private rwS = new THREE.Vector3(); private rwQ = new THREE.Quaternion(); private rwD = new THREE.Quaternion(); private rwA = new THREE.Vector3();
  private rotWorld(bone: THREE.Object3D, axis: THREE.Vector3, ang: number) {
    if (!(Math.abs(ang) > 1e-5) || !(axis.lengthSq() > 1e-10)) return;   // also rejects NaN
    bone.parent!.updateWorldMatrix(true, false);
    bone.parent!.matrixWorld.decompose(this.rwP, this.rwQ, this.rwS);
    const ax = this.rwA.copy(axis).normalize().applyQuaternion(this.rwQ.invert());   // scratch vector: called ~30x per skater per frame
    if (this.rwS.x < 0) { ax.x = -ax.x; ang = -ang; }
    bone.quaternion.premultiply(this.rwD.setFromAxisAngle(ax.normalize(), ang));
    bone.updateMatrixWorld(true);
  }

  /** Stick IK, applied after the clip and the upper-body layer each frame.
   *  The stick is held by the right (bottom) hand. CCD (cyclic coordinate descent) turns hand_r, lowerarm_r and
   *  upperarm_r, each a little per pass and within a limit from the animated pose, so the blade lands on its target;
   *  then the left (top) arm is solved the same way so that hand stays on the shaft at its grip.
   *  Targets: the puck while carrying it (the sim stickhandles it side to side, so the stick works with it), an
   *  incoming pass or a loose puck close by (the blade reaches for it), and the puck during a poke (the stick
   *  shoots out to it). Weight eases in and out so the clip and the IK blend instead of popping. */
  private ikV = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Quaternion(), pq: new THREE.Quaternion(), bq: new THREE.Quaternion() };
  private stickIK(v: SkaterView, s: Skater, p: { x: number; y: number; vx: number; vy: number; owner: Skater | null; kind: string; target: Skater | null }, rdt: number) {
    const st = this.stickOf(v), g = this.stickGeo;
    if (!st || !g || !v.anim) return;
    if (!v.arms) {
      const b = (n: string) => v.body.getObjectByName(n);
      const ua_r = b('upperarm_r'), la_r = b('lowerarm_r'), h_r = b('hand_r'), ua_l = b('upperarm_l'), la_l = b('lowerarm_l'), h_l = b('hand_l');
      if (!ua_r || !la_r || !h_r || !ua_l || !la_l || !h_l) return;
      v.arms = { ua_r, la_r, h_r, ua_l, la_l, h_l };
    }
    const A = v.arms, T = (v.ikT ??= new THREE.Vector3());
    const busy = ['wrist_shot', 'slapshot', 'fall', 'check'].includes(v.anim.cur) || s.wind >= 0 || s.stun > 0 || s.air;
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    let want = 0;
    if (!busy) {
      if (s.pokeT > 0) { want = 1; T.set(s.pokeX, IK_Y, s.pokeY); }
      else if (p.owner === s) { want = 1; T.set(p.x, IK_Y, p.y); }
      else if (p.kind === 'pass' && p.target === s && d < 5) { want = 0.85; T.set(p.x + p.vx * 0.08, IK_Y, p.y + p.vy * 0.08); }
      else if (!p.owner && d < 2.6) { want = 0.7; T.set(p.x, IK_Y, p.y); }
      // defending, squared to the carrier: blade flat on the ice in the passing lane the sim has it sealing
      else if ((s.faceMode === 'back' || s.faceMode === 'square') && p.owner && p.owner.team !== s.team) { want = 0.75; T.set(s.stickX, IK_Y, s.stickY); }
    }
    v.ikW = (v.ikW ?? 0) + (want - (v.ikW ?? 0)) * Math.min(1, rdt * (want > (v.ikW ?? 0) ? 14 : 6));
    const w = v.ikW;
    if (w < 0.02) return;
    v.root.updateMatrixWorld(true);
    const { a, b, c } = this.ikV;
    const blade = () => c.copy(g.blade).applyMatrix4(st.matrixWorld);
    // one CCD step on a bone: turn it so (effector - joint) points at (target - joint), by at most `step`,
    // and never further than `limit` from where the clip put it
    const turn = (bone: THREE.Object3D, eff: THREE.Vector3, tgt: THREE.Vector3, step: number, orig: THREE.Quaternion, limit: number) => {
      bone.getWorldPosition(a);
      const e = eff.clone().sub(a), t = tgt.clone().sub(a);
      if (e.lengthSq() < 1e-6 || t.lengthSq() < 1e-6) return;
      e.normalize(); t.normalize();
      const ang = Math.min(step, e.angleTo(t)) * w; if (!(ang >= 1e-4)) return;
      this.rotWorld(bone, b.crossVectors(e, t), ang);   // no-op when e and t are parallel (zero axis)
      if (bone.quaternion.angleTo(orig) > limit) { bone.quaternion.copy(orig).rotateTowards(bone.quaternion, limit); bone.updateMatrixWorld(true); }
    };
    // How far behind the chest each hand and elbow sits, inside the torso's width (0 = clear). The clip pose is
    // the reference: the IK may never push an arm further into or behind the body than the clip had it.
    const chest = new THREE.Vector3(), fwd = new THREE.Vector3(Math.cos(s.face), 0, Math.sin(s.face)), side = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const inside = () => {
      (v.bones?.sp3 ?? A.ua_r.parent!).getWorldPosition(chest);   // upper spine: chest height and centre
      let worst = 0; const q = new THREE.Vector3();
      for (const bn of [A.h_r, A.la_r, A.h_l, A.la_l]) {
        bn.getWorldPosition(q).sub(chest);
        const lat = Math.abs(q.dot(side)) / SKATER_SCALE, f = q.dot(fwd) / SKATER_SCALE;
        if (lat < ARM.torsoHalf) worst = Math.max(worst, (ARM.chestFront - f) * (1 - lat / ARM.torsoHalf));
      }
      return worst;
    };
    const before = inside();
    const armBones = [A.h_r, A.la_r, A.ua_r, A.la_l, A.ua_l], clipPose = armBones.map(bn => bn.quaternion.clone());
    // 1. turn the stick in the bottom glove, about the glove, toward the target: no arm moves, nothing can clip
    const aim = (lim: number) => this.turnStick(v, st, blade().clone(), T, lim * w);
    aim(ARM.stickAim);
    // 2. the bottom arm makes the rest up, in small turns
    const R: [THREE.Object3D, number, number][] = [[A.h_r, 0.15, ARM.hand], [A.la_r, 0.12, ARM.elbow], [A.ua_r, 0.1, ARM.shoulder]];
    const origR = R.map(([bn]) => bn.quaternion.clone());
    for (let it = 0; it < 4; it++) R.forEach(([bn, step, lim], i) => turn(bn, blade().clone(), T, step, origR[i], lim));
    aim(ARM.stickAim * 0.5);
    // 3. top hand back onto the shaft at its grip
    if (g.gripT > 0) {
      const grip = g.blade.clone().lerp(g.top, g.gripT).applyMatrix4(st.matrixWorld);
      const Lc: [THREE.Object3D, number, number][] = [[A.la_l, 0.2, ARM.topElbow], [A.ua_l, 0.15, ARM.topShoulder]];
      const origL = Lc.map(([bn]) => bn.quaternion.clone());
      const hand = new THREE.Vector3();
      for (let it = 0; it < 4; it++) Lc.forEach(([bn, step, lim], i) => { A.h_l.getWorldPosition(hand); turn(bn, hand, grip, step, origL[i], lim); });
    }
    // 4. guard: if the arms ended up deeper in or behind the body than the clip had them, drop the arm part and
    // keep only the stick turn (the blade lands a little off the puck rather than a glove coming out the back)
    if (inside() > Math.max(before, 0) + ARM.slack) {
      armBones.forEach((bn, i) => { bn.quaternion.copy(clipPose[i]); bn.updateMatrixWorld(true); });
      v.ikGuard = (v.ikGuard ?? 0) + 1;
    }
  }

  /** test hook: where skater i's blade is, in the sim frame of that skater: forward along his facing, lateral to his right */
  bladeOffset(i: number, face: number, x: number, y: number) {
    const v = this.skaters[i]; if (!v) return null;
    const st = this.stickOf(v); if (!st || !this.stickGeo) return null;
    v.root.updateMatrixWorld(true);
    const w = this.stickGeo.blade.clone().applyMatrix4(st.matrixWorld);
    const dx = w.x - x, dy = w.z - y;
    return { fwd: +(dx * Math.cos(face) + dy * Math.sin(face)).toFixed(3), lat: +(-dx * Math.sin(face) + dy * Math.cos(face)).toFixed(3), h: +w.y.toFixed(3), clip: v.anim?.cur };
  }

  /** test hook: the drawn body's forward and up directions in sim coordinates (x up-ice, y screen right) */
  bodyFrame(i: number) {
    const v = this.skaters[i]; if (!v) return null;
    v.body.updateWorldMatrix(true, false);
    const e = v.body.matrixWorld.elements;   // columns: local X (the body faces local +X), local Y (up)
    return { fwd: [e[0], e[2]], up: [e[4], e[5], e[6]], lean: v.feel?.lean ?? 0, rot: [v.body.rotation.x, v.body.rotation.y, v.body.rotation.z], order: v.body.rotation.order };
  }

  /** test hook: for each view, whether its goalie gear is showing and whether its skater kit is (goalies: gear only) */
  gearCheck() {
    return this.skaters.map((v, i) => ({ i, gear: (v.gear ?? []).filter(o => o.visible).length, kit: (v.skaterKit ?? []).filter(o => o.visible).length, root: v.root.visible }));
  }

  /** test hook: which clip each skater is playing and where it is */
  animStates() {
    return this.skaters.map(v => v.anim ? { clip: v.anim.cur, t: +v.anim.acts[v.anim.cur].time.toFixed(3), w: +v.anim.acts[v.anim.cur].getEffectiveWeight().toFixed(2), rate: +v.anim.rate.toFixed(3), twist: +(v.mb?.twist ?? 0).toFixed(3) } : null);
  }

  /** Skating feel on top of the clips (display only, the sim is unchanged):
   *  - the body turns smoothly toward the heading instead of snapping
   *  - it leans into turns by speed x turn rate, like a skater carving an edge
   *  - it leans forward when accelerating and back when slowing
   *  - a hard stop at speed turns the body side-on for a moment and throws an ice spray */
  private skateFeel(v: SkaterView, s: Skater, dt: number, rdt: number) {
    const sp = Math.hypot(s.vx, s.vy);
    const f = v.feel ??= { yaw: -s.face, face: s.face, sp, lean: 0, pitch: 0, stopT: 0, stopSide: 1, effort: 0, turn: 0, hd: Math.atan2(s.vy, s.vx) };
    if (dt > 0) {
      const turn = wrapA(s.face - f.face) / dt, acc = (sp - f.sp) / dt;
      f.face = s.face; f.sp = sp;
      const k = Math.min(1, rdt * 7);
      f.lean += (Math.max(-0.38, Math.min(0.38, turn * sp * 0.02)) - f.lean) * k;   // into the turn (physics_probe: up vector toward the turn centre)
      f.pitch += (Math.max(-0.1, Math.min(0.14, acc * 0.01)) - f.pitch) * k;
      f.effort += (Math.max(0, Math.min(1, acc / 18)) - f.effort) * Math.min(1, rdt * 10);   // 1 = digging hard to build speed
      const hd = Math.atan2(s.vy, s.vx), pathTurn = sp > 3 ? wrapA(hd - f.hd) / dt : 0;   // how fast the path itself bends
      f.hd = hd;
      f.turn += (Math.max(-8, Math.min(8, pathTurn)) - f.turn) * Math.min(1, rdt * 10);
      if (acc < -20 && sp > 1.5 && f.stopT <= 0 && s.stun <= 0 && s.checkT <= 0) {
        f.stopT = 0.45; f.stopSide = turn >= 0 ? 1 : -1;
        this.spray(s.x, s.y, s.vx / (sp || 1), s.vy / (sp || 1), 16, 0xe8f4ff, 8);
      }
      f.stopT -= dt;
    }
    // shooting: the body comes round to the net with the shot instead of easing round after it
    const shooting = (v.anim?.shotT ?? 0) > 0 || (s.wind >= 0 && this.game?.pucks[0].owner === s);
    f.yaw = wrapA(f.yaw + wrapA(-s.face - f.yaw) * Math.min(1, rdt * (shooting ? 40 : 14)));
    const st = f.stopT > 0 ? Math.sin(Math.PI * Math.min(1, (0.45 - f.stopT) / 0.45)) : 0;
    v.body.rotation.order = 'YXZ';
    v.body.rotation.y = f.yaw;   // the facing itself turns through the stop: no extra spin on top
    v.body.rotation.x = f.lean - f.stopSide * st * 0.2;   // dig the edges in, leaning back from the stop
    v.body.rotation.z = -f.pitch;
  }

  /** show the goalie gear (pads, blocker, glove, mask, chest, goalie stick) or the skater kit, with their outlines */
  private setGoalieLook(v: SkaterView, on: boolean) {
    if (v.goalieLook === on) return;
    v.goalieLook = on;
    const show = (o: THREE.Object3D, vis: boolean) => { o.visible = vis; const h = o.userData.hull as THREE.Object3D | undefined; if (h) h.visible = vis; };
    for (const o of v.gear ?? []) show(o, on);
    // the skater's helmet and stick give way only to a goalie mask and goalie stick that are actually there
    const hasMask = (v.gear ?? []).some(o => o.name.startsWith('g_mask')), hasStick = (v.gear ?? []).some(o => o.name.startsWith('g_stick'));
    for (const o of v.skaterKit ?? []) show(o, !on || (o.name === 'stick' ? !hasStick : !hasMask));
    const team = v.outfit && this.skaters.indexOf(v) >= 0 ? View.teamOf(this.skaters.indexOf(v)) : 0;
    if (v.outfit && this.goalieOutfit.length) {
      v.outfit.material = on ? this.goalieOutfit[team] : this.outfitMats[team];
      const h = v.outfit.userData.hull as THREE.Mesh | undefined;
      if (h && this.goalieInk) { h.userData.ink ??= h.material; h.material = on ? this.goalieInk : h.userData.ink; }
    }
  }

  /** a goalie's save: play the clip so its reach peaks when the puck arrives (`arrive` seconds from now) */
  private goalieSave(team: number, kind: string, arrive: number) {
    const v = this.skaters[(this.game?.skaters.length ?? 0) + team];
    const clip = kind === 'butterfly' ? 'g_butterfly' : kind === 'glove' ? 'g_glove' : kind === 'blocker' ? 'g_blocker' : kind === 'pad_l' ? 'g_pad_l' : kind === 'pad_r' ? 'g_pad_r' : '';
    if (!v || !v.anim || !clip || !v.anim.acts[clip]) return;
    if (v.gsave && v.gsave.clip === clip && v.gsave.t < v.gsave.len * 0.5) return;   // already making this save
    const len = 0.75, peak = len * 0.2;   // the clips reach full extension about a fifth of the way in
    v.gsave = { clip, t: Math.max(0, Math.min(peak, peak - arrive)), len };
  }

  /** choose and advance the skater's clip from what the sim says it is doing */
  private animate(v: SkaterView, s: Skater | null, has: boolean, shotByMe: boolean, dt: number) {
    const a = v.anim!;
    const play = (name: string, fade = 0.15) => {
      if (a.cur === name) return a.acts[name];
      const next = a.acts[name], prev = a.acts[a.cur]; next.reset(); next.enabled = true; next.setEffectiveWeight(1); next.play();
      // foot-phase sync between locomotion loops (as in Gears of War 4's locomotion): the new clip starts with the
      // same skate pushing as the old one, so a stride -> crossover -> backward change never double-steps.
      // From anything else, loops start at a random point so nobody on the ice strides in lockstep.
      if (name in LOCO && a.cur in LOCO) {
        const u = prev.time / prev.getClip().duration - LOCO[a.cur] + LOCO[name];
        next.time = (((u % 1) + 1) % 1) * next.getClip().duration;
      } else if (next.loop === THREE.LoopRepeat) next.time = Math.random() * next.getClip().duration;
      a.acts[a.cur].crossFadeTo(next, fade, false); a.cur = name; return next;
    };
    // scrubbed clips: time follows game state, not the clock
    const scrub = (name: string, f: number) => {
      const act = play(name, 0.08); act.paused = false; act.timeScale = 0;
      act.time = Math.max(0, Math.min(0.999, f)) * act.getClip().duration;
    };
    const forced = DBG.get('pose');   // ?pose=slapshot:0.45 holds every skater in that clip and moment (test frames)
    if (forced) { const [c, f] = forced.split(':'); if (a.acts[c]) { scrub(c, parseFloat(f || '0.5')); a.mixer.update(dt); return; } }
    if (!s) {   // goalie: wide, low stance, or a save in progress (scrubbed so its reach meets the puck)
      const gs = v.gsave;
      if (gs && gs.t < gs.len && a.acts[gs.clip]) { gs.t += dt; scrub(gs.clip, gs.t / gs.len); }
      else { v.gsave = undefined; play(a.acts.goalie ? 'goalie' : 'glide', 0.2); }
      a.mixer.update(dt); return;
    }
    const sp = Math.hypot(s.vx, s.vy);
    // knocked down: fall (Quaternius library clip, joined after its standing start), lie there, then
    // blend back to the stance when the sim lets him up
    if (s.stun > 0.25 && !s.air && a.acts.fall) {
      if (a.cur !== 'fall') { const f = play('fall', 0.1); f.time = 0.45; f.timeScale = 1.7; f.paused = false; }
      a.mixer.update(dt); return;
    }
    if (s.wind >= 0 && has) { a.prevWind = s.wind; scrub('slapshot', Math.min(1, s.wind / 0.6) * 0.5); }
    else {
      if (a.prevWind >= 0 && shotByMe) { a.shotT = 0.35; a.shotKind = 'slap'; }
      else if (shotByMe && a.shotT <= 0 && a.cur !== 'wrist_shot' && a.cur !== 'slapshot') { a.shotT = 0.35; a.shotKind = 'wrist'; }
      a.prevWind = -1;
      if (a.shotT > 0) {
        a.shotT -= dt; const f = 1 - Math.max(0, a.shotT) / 0.35;
        if (a.shotKind === 'slap') scrub('slapshot', 0.5 + 0.5 * f); else scrub('wrist_shot', 0.3 + 0.7 * f);
      } else if (s.checkT > 0) {
        if (a.cur !== 'check') a.checkLen = s.checkT;
        scrub('check', 0.3 + 0.7 * (1 - s.checkT / Math.max(0.05, a.checkLen)));
      } else if (sp > 1.2 && (s.vx * Math.cos(s.face) + s.vy * Math.sin(s.face)) / sp < -0.3 && a.acts.back) {
        // skating backward, facing the play: C-cuts, quicker as he works harder to hold the gap
        const act = play('back', 0.15); act.timeScale = Math.max(0.6, Math.min(1.6, sp * act.getClip().duration / CYCLE_DIST.back)) * a.rate;
      } else if (has && sp < 6.5 && s.wind < 0 && a.acts.handle) {
        const act = play('handle', 0.15); act.timeScale = (1 + sp * 0.06) * a.rate;   // working the puck
      } else if (sp > 2.2 && s.drive) {
        // short, quick pushes while building speed; longer, slower strides once at speed.
        // a hard carve at speed switches to crossovers, stepping the outside skate over the inside one
        const e = v.feel?.effort ?? 0, tr = v.feel?.turn ?? 0;
        const cx = (tr > 0) === (s.hand > 0) ? 'cross_r' : 'cross_l';   // sim facing grows clockwise on screen: tr > 0 is a right turn; a mirrored (left shot) model plays the other clip
        const cross = !!a.acts[cx] && Math.abs(tr) > 1.6 && sp > 5;
        const act = play(cross ? cx : 'stride', 0.12);
        // distance matching: cadence follows ground speed, so pushes look like they produce the speed; building speed
        // (effort) means shorter, quicker pushes, as real skaters do out of a stop
        act.timeScale = Math.max(0.7, Math.min(1.9, sp * act.getClip().duration / CYCLE_DIST[cross ? cx : 'stride'] * (1 + 0.7 * e))) * a.rate;
      }
      else if (sp > 0.6) play('glide');
      else play('idle');
    }
    a.mixer.update(dt);
  }

  /** Upper-body layer applied after the clip each frame (the mixer rewrites the bones every update, so these
   *  offsets never accumulate). It decouples the chest and head from the legs, the way games layer an upper
   *  body over locomotion:
   *  - the chest and head turn toward the puck (split across two spine bones and the head), so a skater
   *    gliding one way can watch play the other way, and a defender's shoulders track the carrier
   *  - each skater carries his own posture (more or less hunched) and a slow weight shift with his own phase
   *  Rotations are built about world axes converted into each bone's parent space, so they don't depend on
   *  how the rig's bones happen to be oriented. */
  private mbA = new THREE.Vector3();
  private microBlend(v: SkaterView, s: Skater, p: { x: number; y: number }, rdt: number) {
    const b = v.bones, m = v.mb; if (!b || !m || !v.anim) return;
    const busy = ['wrist_shot', 'slapshot', 'check', 'fall'].includes(v.anim.cur);
    const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy);
    // sim angles grow from +x toward +y, which is a negative turn about world +Y
    let rel = d > 0.8 ? wrapA(Math.atan2(dy, dx) - s.face) : 0;
    // puck behind him: keep looking over the shoulder he already uses; the old clamp flipped +max to -max as he
    // turned through it, whipping the head across on every turn
    if (Math.abs(rel) > HEAD.behind && Math.abs(m.twist) > 0.05) rel = Math.sign(m.twist) * Math.abs(rel);
    let want = busy ? 0 : Math.max(-HEAD.max, Math.min(HEAD.max, rel * HEAD.gain)) * Math.min(1, d / 3) * (d < 22 ? 1 : 0);
    if (!Number.isFinite(want)) want = 0;
    if (Math.abs(want - m.twist) > HEAD.dead || want === 0) m.twist += (want - m.twist) * Math.min(1, rdt * HEAD.rate);
    if (!Number.isFinite(m.twist)) m.twist = 0;
    const t = this.t * m.sway + m.phase, shift = Math.sin(t) * 0.035, nod = Math.sin(t * 1.7 + 1) * 0.02;
    v.root.updateMatrixWorld(true);
    const fwd = this.mbA;
    const rot = (bone: THREE.Object3D, axis: THREE.Vector3, ang: number) => this.rotWorld(bone, axis, ang);
    const up = new THREE.Vector3(0, 1, 0);
    fwd.set(Math.cos(s.face), 0, Math.sin(s.face));
    const side = new THREE.Vector3().crossVectors(up, fwd).normalize();
    rot(b.sp2, up, -m.twist * 0.4); rot(b.sp3, up, -m.twist * 0.35); rot(b.head, up, -m.twist * 0.25);
    rot(b.sp2, side, m.posture + nod); rot(b.sp3, fwd, shift);
  }

  /** repaint both team textures: white cloth takes the team colour, red gear takes the trim colour */
  private tintPlayers() {
    const src = this.playerSrc;
    if (!src) return;
    const S = src.data, ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    this.playerTex.forEach(({ cv, tex }, team) => {
      const [bodyHex, trimHex] = this.teamHex[team];
      // team colours a quarter toward grey, so the skaters sit in the rink instead of glowing on it
      const soften = (h: number) => { const c = [h >> 16 & 255, h >> 8 & 255, h & 255], l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; return c.map(v => v * 0.75 + l * 0.25); };
      const B = soften(bodyHex), T = soften(trimHex);
      const out = new ImageData(src.width, src.height), O = out.data;
      for (let i = 0; i < S.length; i += 4) {
        const r = S[i], g = S[i + 1], b = S[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        const sat = mx ? d / mx : 0, val = mx / 255;
        const redHue = r === mx && d > 0 && (g - b) / d < 0.24 && (g - b) / d > -0.34;
        // wt: how much of the pixel is gear; w: how much of it is tinted at all
        const wt = redHue ? ss(0.18, 0.45, sat) : 0;
        const w = redHue && sat >= 0.18 ? ss(0.2, 0.32, val) : sat < 0.18 ? ss(0.38, 0.5, val) : 0;
        // keep shading gentle so the colour blocks stay clean
        const kb = Math.max(0.82, Math.min(1.12, val / 0.765)), kt = Math.max(0.8, Math.min(1.2, val / 0.65));
        for (let c = 0; c < 3; c++) {
          const tint = B[c] * kb * (1 - wt) + (T[c] * 0.85 + 22) * kt * wt;
          O[i + c] = S[i + c] * (1 - w) + tint * w;
        }
        O[i + 3] = 255;
      }
      cv.getContext('2d')!.putImageData(out, 0, 0);
      tex.needsUpdate = true;
    });
  }

  /** goal frame and netting; the floor plate and goal lamp stay procedural */
  private async loadNet(loader: GLTFLoader, url: string) {
    const gltf = await loader.loadAsync(url);
    const parts = View.meshes(gltf.scene).filter(m => m.name.startsWith('net_'));
    if (parts.length < 2) throw new Error('net.glb is missing the frame or the netting');
    for (const m of parts) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.side = THREE.DoubleSide;
      if (mat.map) { mat.map.magFilter = THREE.NearestFilter; mat.alphaTest = 0.5; }
    }
    for (const net of this.nets) {
      for (const c of net.children) if (c.userData.proc) c.visible = false;
      for (const m of parts) net.add(new THREE.Mesh(m.geometry, m.material));
    }
  }

  private placeFans(amp: number) {
    const B = this.crowdBase, S = this.fanSeat, d = this.dummy;
    for (let i = 0; i < B.length / 4; i++) {
      const hop = amp > 0 ? Math.abs(Math.sin(this.t * 11 + B[i * 4 + 3])) * amp : 0;
      d.position.set(B[i * 4], B[i * 4 + 1] - 0.05 + hop, B[i * 4 + 2]);
      d.rotation.set(0, S[i * 4 + 2], 0); d.scale.setScalar(S[i * 4 + 3]); d.updateMatrix();
      this.fans[S[i * 4]].setMatrixAt(S[i * 4 + 1], d.matrix);
    }
    for (const f of this.fans) f.instanceMatrix.needsUpdate = true;
  }

  private buildActors() {
    const dark = this.std(0x15171f), stickM = this.std(0xd9c9a3), visor = new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 0.15, metalness: 0.4 });
    const leg = new THREE.BoxGeometry(0.3, 0.62, 0.28);
    const hips = new THREE.BoxGeometry(0.46, 0.34, 0.74);
    const torso = new THREE.BoxGeometry(0.48, 0.62, 0.8);
    const band = new THREE.BoxGeometry(0.5, 0.12, 0.82);
    const pads = new THREE.BoxGeometry(0.56, 0.2, 1.14);
    const arm = new THREE.BoxGeometry(0.56, 0.22, 0.22);
    const glove = new THREE.BoxGeometry(0.24, 0.24, 0.26);
    const head = new THREE.IcosahedronGeometry(0.3, 1);
    const vis = new THREE.BoxGeometry(0.12, 0.14, 0.42);
    const skate = new THREE.BoxGeometry(0.5, 0.14, 0.2);
    const shaft = new THREE.BoxGeometry(1.5, 0.07, 0.07);
    const blade = new THREE.BoxGeometry(0.42, 0.12, 0.08);
    // soft round shadow under the skates, as in the reference: darkest in the middle, fading out
    const sc = document.createElement('canvas'); sc.width = sc.height = 128;
    const sg = sc.getContext('2d')!, grad = sg.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(40,46,62,0.55)'); grad.addColorStop(0.55, 'rgba(40,46,62,0.32)'); grad.addColorStop(1, 'rgba(40,46,62,0)');
    sg.fillStyle = grad; sg.fillRect(0, 0, 128, 128);
    const shadowTex = new THREE.CanvasTexture(sc); shadowTex.colorSpace = THREE.SRGBColorSpace;
    const shadowG = new THREE.PlaneGeometry(1.9, 1.35);
    const shadowM = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
    for (let t = 0; t < 2; t++) this.teamMat.push({ body: this.std(0xffffff), trim: this.std(0x222222) });
    for (let i = 0; i < TEAM * 2 + 2; i++) {
      const tm = this.teamMat[View.teamOf(i)];
      const root = new THREE.Group(), body = new THREE.Group();
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
        const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); body.add(m); return m;
      };
      for (const z of [-0.22, 0.22]) { add(skate, dark, 0.08, 0.07, z); add(leg, tm.trim, 0, 0.45, z); }
      add(hips, tm.trim, 0, 0.86, 0);
      const tr = add(torso, tm.body, 0.06, 1.28, 0); tr.rotation.z = -0.18;
      const bd = add(band, tm.trim, 0.03, 1.02, 0); bd.rotation.z = -0.18;
      add(pads, tm.body, 0.1, 1.6, 0);
      for (const z of [-0.5, 0.5]) { const a = add(arm, tm.body, 0.34, 1.34, z); a.rotation.z = -0.75; a.rotation.y = z > 0 ? 0.25 : -0.25; }
      add(glove, tm.trim, 0.56, 1.08, 0.36); add(glove, tm.trim, 0.52, 1.12, -0.3);
      add(head, tm.trim, 0.2, 1.96, 0);
      add(vis, visor, 0.44, 1.93, 0);
      const st = add(shaft, stickM, 1.0, 0.6, 0.36); st.rotation.z = -0.72;
      add(blade, dark, 1.66, 0.06, 0.36);
      const shadow = new THREE.Mesh(shadowG, shadowM); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02;
      root.add(body); this.scene.add(root, shadow);
      this.skaters.push({ root, body, shadow, fall: 0, spin: 0 });
    }
    // human markers
    this.discMat = new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.75, depthWrite: false });
    this.disc = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.4, 32), this.discMat);
    this.disc.rotation.x = -Math.PI / 2; this.disc.position.y = 0.04;
    this.discInk = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.58, 32), new THREE.MeshBasicMaterial({ color: 0x1d1b26, depthWrite: false }));
    this.discInk.rotation.x = -Math.PI / 2; this.discInk.position.y = 0.038;
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 5, 6), new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.55, depthWrite: false }));
    // flat arrow on the ice that points from you to the puck
    const tri = (r: number) => { const sh = new THREE.Shape(); sh.moveTo(r, 0); sh.lineTo(-r * 0.7, r * 0.75); sh.lineTo(-r * 0.3, 0); sh.lineTo(-r * 0.7, -r * 0.75); sh.closePath(); return new THREE.ShapeGeometry(sh); };
    this.toPuck = new THREE.Group();
    const t1 = new THREE.Mesh(tri(0.62), new THREE.MeshBasicMaterial({ color: 0x1d1b26, depthWrite: false }));
    const t2 = new THREE.Mesh(tri(0.42), new THREE.MeshBasicMaterial({ color: 0xe5482d, depthWrite: false }));
    t2.position.z = 0.002; this.toPuck.add(t1, t2);
    this.scene.add(this.discInk, this.beam, this.toPuck);
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.0, 4), new THREE.MeshBasicMaterial({ color: BLUE }));
    this.arrow.rotation.x = Math.PI;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.22, 28), new THREE.MeshBasicMaterial({ color: 0xfff06a, transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.04; this.ring.visible = false;
    this.scene.add(this.disc, this.arrow, this.ring);
    for (let i = 0; i < 8; i++) {
      const gm = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      gm.visible = false; this.scene.add(gm); this.gems.push(gm);
    }
    // puck
    this.puckMat = new THREE.MeshStandardMaterial({ color: 0x1d1b26, roughness: 0.8 });
    // slimmer, smoother puck (about 3:1 like a real one, 48 sides); the top face is a touch lighter so it reads as a disc
    const puckTop = new THREE.MeshStandardMaterial({ color: 0x3a3846, roughness: 0.6 });
    // small, like the real thing next to a skater (about twice true scale so it still reads from the camera)
    this.puck = new THREE.Mesh(new THREE.CylinderGeometry(PR, PR, 0.065, 40), [this.puckMat, puckTop, this.puckMat]);   // drawn exactly at its collision size
    this.puckGlow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 40), new THREE.MeshBasicMaterial({ color: 0xe5482d, depthWrite: false }));
    this.puckGlow.rotation.x = -Math.PI / 2;
    // outline halo on the ice: a thin white gap then a crisp dark ring, so the small puck has a hard edge against the
    // bright ice (figure-ground contrast) and stays readable at shot speed; the ink colour matches the skater outlines
    this.puckRing = new THREE.Mesh(new THREE.RingGeometry(PR + 0.06, PR + 0.13, 48), new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.9, depthWrite: false }));
    const gapRing = new THREE.Mesh(new THREE.RingGeometry(PR, PR + 0.06, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
    this.puckRing.add(gapRing);
    this.puckRing.rotation.x = -Math.PI / 2; this.scene.add(this.puckRing);
    // speed streak: a fast puck is a blur, so a hard shot reads as a line to the net rather than a dot crawling
    const stc = document.createElement('canvas'); stc.width = 128; stc.height = 8;
    const stg = stc.getContext('2d')!, gr = stg.createLinearGradient(0, 0, 128, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(235,245,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0.95)');
    stg.fillStyle = gr; stg.fillRect(0, 0, 128, 8);
    const sgeo = new THREE.PlaneGeometry(1, 1); sgeo.translate(-0.5, 0, 0); sgeo.rotateX(-Math.PI / 2);
    this.puckStreak = new THREE.Mesh(sgeo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(stc), transparent: true, depthWrite: false }));
    this.puckStreak.visible = false;
    this.scene.add(this.puck, this.puckGlow, this.puckStreak);
    // High-visibility cue (the reference marks its puck the same way): a soft neon-lime glow, a colour no team
    // wears and that stands out from both the white ice and the blue lines, so the puck can't get lost in a scrum,
    // a rebound or a hard pass. It stretches along the puck's path when it moves fast. The x-ray ring ignores depth,
    // so it still shows the puck's spot when skaters or pads are in front of it.
    const hc = document.createElement('canvas'); hc.width = hc.height = 64;
    const hg = hc.getContext('2d')!, rg = hg.createRadialGradient(32, 32, 4, 32, 32, 32);
    rg.addColorStop(0, 'rgba(200,255,40,0.95)'); rg.addColorStop(0.45, 'rgba(190,255,30,0.55)'); rg.addColorStop(1, 'rgba(190,255,30,0)');
    hg.fillStyle = rg; hg.fillRect(0, 0, 64, 64);
    this.puckHalo = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(hc), transparent: true, depthWrite: false }));
    this.puckXray = new THREE.Mesh(new THREE.RingGeometry(PR + 0.22, PR + 0.32, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xb8ff1a, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false }));
    this.puckXray.renderOrder = 998; this.puckHalo.renderOrder = 1;
    this.scene.add(this.puckHalo, this.puckXray);
    for (let i = 0; i < 4; i++) {
      const gp = new THREE.Mesh(this.puck.geometry, new THREE.MeshBasicMaterial({ color: 0x575266 }));
      gp.visible = false; this.scene.add(gp); this.ghosts.push(gp);
    }
    // particles
    this.parts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), PMAX);
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < PMAX; i++) { this.parts.setColorAt(i, c); this.pcol.push(new THREE.Color()); }
    this.parts.count = 0; this.parts.frustumCulled = false;
    this.scene.add(this.parts);
    const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 2; this.scene.add(m);
      this.rings.push({ m, t: 0, life: 1, r0: 0.3, r1: 2 });
    }
  }

  setTeams(home: TeamDef, away: TeamDef, gemColors: number[]) {
    this.teamMat[0].body.color.setHex(home.color); this.teamMat[0].trim.color.setHex(home.trim);
    this.teamMat[1].body.color.setHex(away.color); this.teamMat[1].trim.color.setHex(away.trim);
    this.teamHex = [[home.color, home.trim], [away.color, away.trim]];
    this.tintPlayers();
    this.helmetMat.forEach((m, t) => m.color.setHex(this.teamHex[t][1]).lerp(new THREE.Color(0x8a8f99), 0.25));
    this.gearBodyMat.forEach((m, t) => m.color.setHex(this.teamHex[t][0]).lerp(new THREE.Color(0x8a8f99), 0.25));
    this.gearTrimMat.forEach((m, t) => m.color.setHex(this.teamHex[t][1]).lerp(new THREE.Color(0x8a8f99), 0.25));
    this.gems.forEach((g, i) => {
      g.visible = i < gemColors.length;
      if (g.visible) (g.material as THREE.MeshBasicMaterial).color.setHex(gemColors[i]);
    });
    for (const d of this.decals) d.visible = false;
    this.pn = 0; this.lightK = 1; this.bulge = [0, 0]; this.lampT = [0, 0];
    for (const r of this.rings) { r.t = 0; r.m.visible = false; }
  }

  // ------------------------------------------------------------ effects
  /** a pool slot: the next free one, or (budget full) an old one is recycled so big moments always show */
  private slot(): number {
    if (this.pn < this.pBudget) return this.pn++;
    return (this.pSteal = (this.pSteal + 7) % this.pn);
  }
  get particleCount() { return this.pn; }

  /** Pooled particles. kind: 0 chunk (gravity), 1 spark (stretched along its path, light gravity),
   *  2 confetti (flat, flutters down slowly), 3 speed line (no gravity), 4 trail (stays put and shrinks) */
  emit(kind: number, x: number, y: number, n: number, color: number | number[], speed: number,
    o: { up?: number; size?: number; life?: number; h?: number; dx?: number; dy?: number; spread?: number; vx?: number; vy?: number } = {}) {
    const up = o.up ?? 4, size = o.size ?? 0.14, h = o.h ?? 0.3, life = o.life ?? 0.6;
    const dir = o.dx !== undefined || o.dy !== undefined ? Math.atan2(o.dy ?? 0, o.dx ?? 0) : null;
    const G = [18, 7, 2.2, 0, 0][kind] ?? 18, drag = [0, 1.2, 1.8, 0, 0][kind] ?? 0;
    for (let i = 0; i < n; i++) {
      const k = this.slot(), b = k * PF;
      const a = dir === null ? Math.random() * 6.283 : dir + (Math.random() - 0.5) * (o.spread ?? 1.1);
      const sp = speed * (0.3 + Math.random() * 0.7);
      this.pp[b] = x; this.pp[b + 1] = h + (kind === 2 ? Math.random() * 1.5 : 0); this.pp[b + 2] = y;
      this.pp[b + 3] = Math.cos(a) * sp + (o.vx ?? 0); this.pp[b + 4] = kind >= 3 ? 0 : up * (0.4 + Math.random()); this.pp[b + 5] = Math.sin(a) * sp + (o.vy ?? 0);
      const l = life * (0.6 + Math.random() * 0.8);
      this.pp[b + 6] = l; this.pp[b + 7] = size * (0.6 + Math.random() * 0.8);
      this.pp[b + 8] = kind; this.pp[b + 9] = G; this.pp[b + 10] = l; this.pp[b + 11] = drag;
      this.pcol[k].setHex(Array.isArray(color) ? color[(Math.random() * color.length) | 0] : color);
    }
  }
  burst(x: number, y: number, n: number, color: number, speed: number, up = 4, size = 0.14, h = 0.3) {
    this.emit(0, x, y, n, color, speed, { up, size, h, life: 0.6 });
  }
  /** directional ice spray along a hit */
  spray(x: number, y: number, dx: number, dy: number, n: number, color: number, speed: number) {
    this.emit(0, x, y, n, color, speed, { dx, dy, up: 4.5, size: 0.17, h: 0.4, life: 0.65 });
  }
  /** a flat ring pulse on the ice: grows from r0 to r1 and fades */
  ringPulse(x: number, y: number, color: number, r0: number, r1: number, life = 0.28) {
    const r = this.rings[this.ringI++ % this.rings.length];
    r.t = life; r.life = life; r.r0 = r0; r.r1 = r1;
    r.m.position.set(x, 0.07, y); (r.m.material as THREE.MeshBasicMaterial).color.setHex(color); r.m.visible = true;
  }
  /** squash (a > 0) or stretch (a < 0) a skater by id for len seconds */
  squash(id: number, a: number, dx = 0, dy = 0, len = 0.18) {
    const vi = this.game?.skaters.findIndex(k => k.id === id) ?? -1;
    const v = vi >= 0 ? this.skaters[vi] : null;
    if (v) v.crunch = { t: len, len, dx, dy, a };
  }
  /** where the camera is looking (feedback scales far-away events down) */
  camCenter(): [number, number] { return [this.camX, this.camZ]; }
  puckSnap(a: number) { this.snapT = 0.12; this.snapA = a; }
  setChroma(amount: number, angle: number) { this.chromaAmt.value = amount; this.chromaAng.value = angle; }
  /** goal: net bulge, lamp and crowd (the rest of the goal moment is the feedback system's) */
  netGoal(team: number) { const i = team === 0 ? 1 : 0; this.bulge[i] = 1; this.lampT[i] = 2.2; this.cheer = 2; }
  /** world position of the net a team attacks */
  netPos(team: number): [number, number] { return [team === 0 ? GL + NET_DEPTH * 0.5 : -GL - NET_DEPTH * 0.5, 0]; }

  private scuff(x: number, y: number, r: number) {
    const d = this.decals[this.decalI++ % this.decals.length];
    d.visible = true; d.position.x = x; d.position.z = y; d.scale.set(r * (0.8 + Math.random() * 0.6), r, 1);
    d.rotation.z = Math.random() * 3; (d.material as THREE.MeshBasicMaterial).opacity = 0.16;
  }

  /** Sim events that drive animation and physical props. All game-feel effects (particles, camera, flashes,
   *  sound) come from the feedback system (src/feedback/system.ts), not from here. */
  handle(e: Ev) {
    const x = e.x ?? 0, y = e.y ?? 0;
    switch (e.t) {
      case 'hit': this.scuff(x, y, e.big ? 1.0 : 0.6); if (e.big) this.cheer = Math.max(this.cheer, 0.9); break;   // a mark left on the ice
      // goalie read the shot: start the save so its reach meets the puck; a save or catch without a read starts it now
      case 'gread': if (e.team !== undefined && e.text) this.goalieSave(e.team, e.text, e.n ?? 0); break;
      case 'save': case 'catch': if (e.team !== undefined && e.text) this.goalieSave(e.team, e.text, 0); break;
      case 'stickDrop': this.burst(x, y, 10, 0xd9c9a3, 5, 4, 0.1); this.spray(x, y, e.dx ?? 0, e.dy ?? 0, 10, 0xe8f4ff, 6); break;
      case 'lunge': this.burst(x, y, 7, 0xe8f4ff, 4, 2, 0.1, 0.1); break;
      case 'poof': this.burst(x, y, 8, 0x9a6dff, 4, 3, 0.1); break;
      case 'crowd': this.burst(x, y, 24, 0xffb400, 6, 8, 0.2, 2); this.cheer = Math.max(this.cheer, 0.8); break;
      case 'shock': this.shockT = 0.4; this.shockR = e.n ?? 3; this.shockMesh.position.set(x, 0.06, y); break;
      case 'fire': this.cheer = 1.2; break;
      case 'goal': this.netGoal(e.team ?? 0); break;
    }
  }

  project(x: number, h: number, y: number): [number, number] {
    this.v3.set(x, h, y).project(this.camera);
    return [(this.v3.x * 0.5 + 0.5) * window.innerWidth, (-this.v3.y * 0.5 + 0.5) * window.innerHeight];
  }

  // ------------------------------------------------------------ frame
  private game: Game | null = null;
  frame(g: Game, dt: number, rdt: number) {
    this.t += rdt; this.game = g;
    const p = g.pucks[0];
    // skaters
    for (let i = 0; i < g.skaters.length; i++) {
      const s = g.skaters[i], v = this.skaters[i];
      const hidden = s.out > 0;
      v.root.visible = !hidden; v.shadow.visible = !hidden;
      if (hidden) continue;
      const boxed = s.boxed > 0;
      v.root.position.set(s.x, s.z, s.y);
      v.shadow.position.x = s.x; v.shadow.position.z = s.y;
      v.shadow.rotation.z = -s.face - Math.PI / 2;   // long axis across the stance
      v.body.rotation.y = -s.face;
      const down = s.stun > 0.25 ? 1 : 0;
      v.fall += (down - v.fall) * Math.min(1, rdt * 14);
      if (s.air) { v.spin += rdt * 14; v.body.rotation.x = v.spin; v.body.position.y = 0.6; }
      else {
        v.spin = 0;
        v.body.rotation.x = v.anim?.acts.fall ? 0 : v.fall * 1.5;   // the fall clip lays him down
        v.body.position.y = v.anim?.acts.fall ? 0 : v.fall * 0.3;
      }
      if (v.anim) {
        v.body.rotation.z = 0;   // the clips carry the lean, wind-up and check
        if (v.model) v.model.scale.x = SKATER_SCALE * s.hand;   // a left shot is the mirror image: stick, clips and IK follow
        this.animate(v, s, p.owner === s, p.kind === 'shot' && p.shooter === s && p.age < 0.25, dt);
        this.layerRestore(v);
        if (!s.air) this.skateFeel(v, s, dt, rdt);
        if (s.stun <= 0 && !s.air) this.microBlend(v, s, p, rdt);
        if (v.stick) v.stick.visible = s.stickless <= 0;
        if (s.stickless <= 0 && !DBG.has('noik')) this.stickIK(v, s, p, rdt);
        if (s.stickless <= 0 && !DBG.has('nofloor')) this.stickFloor(v);
        this.layerSave(v);
        if (v.crunch) {   // impact: squash and lurch along the hit (or a stretch on a catch), then spring back
          const c = v.crunch; c.t -= rdt;   // real time: the squash plays through the hit stop, so the freeze shows the impact
          const u = 1 - c.t / c.len, k = c.t > 0 ? (u < 0.25 ? u / 0.25 : Math.sin(Math.PI * 0.5 * (1 - (u - 0.25) / 0.75))) * c.a : 0;
          v.body.scale.set(1 + 0.6 * k, 1 - k, 1 + 0.6 * k);
          v.body.position.x = c.dx * 2.2 * Math.max(0, k); v.body.position.z = c.dy * 2.2 * Math.max(0, k);
          if (c.t <= 0) { v.crunch = undefined; v.body.scale.set(1, 1, 1); v.body.position.x = v.body.position.z = 0; }
        }
        if (DBG.has('bladedbg')) {   // ?bladedbg: red marker where the code thinks the blade is
          const st = this.stickOf(v);
          if (st && this.stickGeo) {
            v.root.updateMatrixWorld(true);
            v.bladeDbg ??= (() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false })); m.renderOrder = 999; this.scene.add(m); return m; })();
            v.bladeDbg.position.copy(this.stickGeo.blade).applyMatrix4(st.matrixWorld);
          }
        }
        // knocked flying: the slide throws ice the whole way, so how far a hit sent him reads at a glance
        if (s.stun > 0 && dt > 0) { const sp = Math.hypot(s.vx, s.vy); if (sp > 3 && Math.random() < 0.1 + sp * 0.03) this.spray(s.x, s.y, s.vx / sp, s.vy / sp, 2, 0xe8f4ff, 3 + sp * 0.3); }
        // sprinting: each hard push kicks a little ice back off the skates
        if (s.sprint && !s.air && dt > 0 && Math.random() < 0.35) { const sp = Math.hypot(s.vx, s.vy) || 1; this.spray(s.x, s.y, -s.vx / sp, -s.vy / sp, 2, 0xe8f4ff, 4); }
      } else v.body.rotation.z = s.checkT > 0 ? -0.55 : s.wind >= 0 && p.owner === s ? 0.18 : -0.08 - Math.min(0.2, Math.hypot(s.vx, s.vy) * 0.02);
      v.root.scale.setScalar(boxed ? 0.6 : 1);
      if (this.moveDbg) this.drawMoveDbg(i, s);
      else if (this.dbgArrows[i]) this.dbgArrows[i].forEach(h => h.visible = false);
    }
    // goalie views with no goalie behind them (test rink) stay hidden
    for (let i = g.skaters.length + g.goalies.length; i < this.skaters.length; i++) this.skaters[i].root.visible = this.skaters[i].shadow.visible = false;
    g.goalies.forEach((k, gi) => {
      const v = this.skaters[g.skaters.length + gi];
      if (!v) return;
      v.root.visible = v.shadow.visible = true;
      v.root.position.set(k.x, 0, k.y); v.shadow.position.x = k.x; v.shadow.position.z = k.y; v.shadow.rotation.z = -Math.PI / 2;
      // crouched, facing up the ice, leaning into the slide
      v.body.rotation.set(0, -k.face, v.anim ? 0 : -0.3);   // squared up to the puck
      this.setGoalieLook(v, true);   // pads, blocker, glove, mask and goalie stick instead of the skater kit
      if (v.anim) this.animate(v, null, false, false, dt);
      v.body.position.y = 0; v.root.scale.setScalar(1.12);
      // the box goalie leaned into the slide; tipping the real model would push a skate and the stick into the ice
      v.root.rotation.x = v.anim ? 0 : Math.max(-0.25, Math.min(0.25, k.vy * 0.04)) * (k.team === 0 ? 1 : -1);
    });
    // human markers
    const h = g.ctrl;
    this.disc.position.x = h.x; this.disc.position.z = h.y; this.disc.visible = h.out <= 0;
    this.discMat.opacity = 0.85;
    const ps = (h.frost ? 0.8 : 1) * (1 + Math.sin(this.t * 5) * 0.06);   // stamina has its own sprint bar now
    this.disc.scale.setScalar(ps); this.discInk.scale.setScalar(ps);
    // Heat shows on the ice as a small touch: a few embers off your skates
    const ht = g.tier(0);
    if (ht > 0 && dt > 0 && this.disc.visible && Math.random() < 0.06 * ht) this.burst(h.x, h.y, 1, ht >= 4 ? 0xffb400 : 0xe5482d, 1.4, 2.5, 0.11, 0.1);
    this.discInk.position.x = h.x; this.discInk.position.z = h.y; this.discInk.visible = this.disc.visible;
    this.beam.position.set(h.x, h.z + 6.6, h.y); this.beam.visible = this.disc.visible;
    const pdx = p.x - h.x, pdy = p.y - h.y, pd0 = Math.hypot(pdx, pdy);
    this.toPuck.visible = this.disc.visible && p.owner !== h && pd0 > 2.6 && g.phase === 'play';
    if (this.toPuck.visible) {
      const a = Math.atan2(pdy, pdx);
      this.toPuck.position.set(h.x + Math.cos(a) * 2.3, 0.045, h.y + Math.sin(a) * 2.3);
      this.toPuck.rotation.set(-Math.PI / 2, 0, -a);
    }
    this.arrow.position.set(h.x, h.z + 3.5 + Math.sin(this.t * 6) * 0.18, h.y);
    this.arrow.rotation.y = this.t * 2;
    let gi = 0;
    for (const gm of this.gems) if (gm.visible) {
      const n = this.gems.filter(q => q.visible).length;
      gm.position.set(h.x + (gi - (n - 1) / 2) * 0.42, h.z + 2.55, h.y); gm.rotation.y = this.t * 3; gi++;
    }
    // pass / call ring
    const tgt = p.kind === 'pass' && p.target ? p.target : null;
    const caller = h.calling > 0 ? h : null;
    const rs: Skater | null = tgt || caller;
    this.ring.visible = !!rs;
    if (rs) { this.ring.position.x = rs.x; this.ring.position.z = rs.y; this.ring.scale.setScalar(1 + Math.sin(this.t * 18) * 0.12); }

    // puck
    const dropH = g.phase === 'faceoff' && !g.foLive ? Math.min(3.5, g.foDrop * 5) : 0;
    const lift = p.kind === 'pass' && p.lifted && p.liftT > 0 ? Math.sin(Math.PI * Math.min(1, p.age / p.liftT)) * 0.9 : 0;
    // carried: draw it on the blade itself (the IK brings the blade to the sim's puck; this hides any last gap)
    let pkx = p.x, pkz = p.y;
    if (p.owner && !p.held) {
      const oi = g.skaters.indexOf(p.owner), ov = oi >= 0 ? this.skaters[oi] : null, ost = ov ? ov.stick : null;
      if (ov && ost && ost.visible && this.stickGeo && (ov.ikW ?? 0) > 0.3) {
        // the puck lives on the blade while carried: stickhandling and the stride move it with the stick (the sim's
        // puck stays the truth for play; this is only where it is drawn, and only within a stick's reach of it)
        const bw = this.stickGeo.blade.clone().applyMatrix4(ost.matrixWorld);
        const gap = Math.hypot(bw.x - p.x, bw.z - p.y);
        const k = Math.min(1, (ov.ikW! - 0.3) / 0.4) * (gap < 1.0 ? 1 : Math.max(0, 1 - (gap - 1.0) / 0.5));
        pkx = p.x + (bw.x - p.x) * k; pkz = p.y + (bw.z - p.y) * k;
      }
    }
    this.puck.position.set(pkx, 0.05 + dropH + lift, pkz);
    if (this.snapT > 0) {   // release snap: the puck stretches along its path, then settles
      this.snapT -= rdt;
      const k = Math.max(0, this.snapT / 0.12) * this.snapA;
      this.puck.rotation.y = -Math.atan2(p.vy, p.vx);
      this.puck.scale.set(1 + 0.9 * k, 1 - 0.35 * k, 1 - 0.3 * k);
    } else this.puck.scale.set(1, 1, 1);
    this.puck.visible = !p.held;   // in the goalie's glove
    this.puckGlow.position.set(pkx, 0.03, pkz);
    this.puckRing.position.set(pkx, 0.025, pkz); this.puckRing.visible = dropH === 0;
    {
      const hs = Math.hypot(p.vx, p.vy), fast = !p.owner && hs > 10;
      this.puckHalo.visible = this.puckXray.visible = dropH === 0 && !p.held;
      this.puckHalo.position.set(pkx, 0.02, pkz);
      this.puckHalo.rotation.y = fast ? -Math.atan2(p.vy, p.vx) : 0;
      const pulse = 1 + Math.sin(this.t * 6) * 0.06;
      this.puckHalo.scale.set(pulse * (fast ? 1 + Math.min(1.6, hs * 0.035) : 1), 1, pulse);   // stretched along its path when fast
      this.puckXray.position.set(pkx, 0.06, pkz);
    }
    const fire = g.fireT > 0 && (p.owner ? p.owner.team === 0 : p.lastTeam === 0);
    this.puckGlow.visible = fire;   // red glow only when on fire; normally the grey ring marks the puck
    this.puckGlow.scale.setScalar(1.5 + Math.sin(this.t * 20) * 0.2);
    if (fire && dt > 0) this.burst(p.x, p.y, 2, Math.random() < 0.5 ? 0xe5482d : 0xf7eed8, 1.5, 3, 0.18, 0.15);
    const psp = Math.hypot(p.vx, p.vy);
    this.puckStreak.visible = !p.owner && !p.held && psp > 14 && dropH === 0;
    if (this.puckStreak.visible) {
      // length about 1/25 s of travel: a slapshot draws a 1.8 unit line
      this.puckStreak.position.set(p.x, 0.05 + lift, p.y);
      this.puckStreak.rotation.y = -Math.atan2(p.vy, p.vx);
      this.puckStreak.scale.set(Math.min(2.4, psp * 0.04), 1, 0.3);
    }
    for (let i = 0; i < this.ghosts.length; i++) {
      const gp = g.pucks[i + 1], m = this.ghosts[i];
      m.visible = !!gp && gp.alive;
      if (m.visible) m.position.set(gp.x, 0.09, gp.y);
    }

    // dropped sticks: a shaft and blade lying flat, sliding and spinning to a stop
    for (let i = 0; i < Math.max(g.sticks.length, this.looseSticks.length); i++) {
      const k = g.sticks[i];
      let m = this.looseSticks[i];
      if (k && !m) {
        m = new THREE.Group();
        const wood = this.std(0xd9c9a3), tape = this.std(0x1a1a22);
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.06), wood); shaft.position.x = 0.95;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.12), tape); blade.position.set(1.95, 0, 0.12); blade.rotation.y = -0.35;
        m.add(shaft, blade); this.scene.add(m); this.looseSticks.push(m);
      }
      if (!m) continue;
      m.visible = !!k;
      if (k) { m.position.set(k.x, 0.035, k.y); m.rotation.y = -k.ang; }
    }

    // particles
    const P = this.pp;
    for (let i = 0; i < this.pn;) {
      const o = i * PF;
      P[o + 6] -= dt;
      if (P[o + 6] <= 0) {
        this.pn--;
        const l = this.pn * PF;
        for (let k = 0; k < PF; k++) P[o + k] = P[l + k];
        this.pcol[i].copy(this.pcol[this.pn]);
        continue;
      }
      const kind = P[o + 8], drag = P[o + 11];
      P[o + 4] -= P[o + 9] * dt;
      if (drag > 0) { const f = Math.exp(-drag * dt); P[o + 3] *= f; P[o + 5] *= f; if (kind === 2) P[o + 4] = Math.max(P[o + 4], -1.6); }
      P[o] += P[o + 3] * dt; P[o + 1] += P[o + 4] * dt; P[o + 2] += P[o + 5] * dt;
      if (P[o + 1] < 0.05) { P[o + 1] = 0.05; P[o + 4] *= -0.3; P[o + 3] *= 0.7; P[o + 5] *= 0.7; }
      const lf = P[o + 6] / P[o + 10];
      const sz = P[o + 7] * (kind === 4 ? lf : Math.min(1, P[o + 6] * 4));
      this.dummy.position.set(P[o], P[o + 1], P[o + 2]);
      if (kind === 1 || kind === 3) {   // sparks and speed lines: thin streaks along their velocity
        const vx = P[o + 3], vy = P[o + 4], vz = P[o + 5], hv = Math.hypot(vx, vz);
        this.dummy.rotation.set(0, -Math.atan2(vz, vx), Math.atan2(vy, hv));
        const len = kind === 3 ? P[o + 7] * 10 * Math.min(1, lf * 2) : Math.max(sz, Math.min(0.9, Math.hypot(hv, vy) * 0.045));
        this.dummy.scale.set(len, sz * 0.35, sz * 0.35);
      } else if (kind === 2) {          // confetti: flat chips that tumble
        const tt = this.t * 9 + i;
        this.dummy.rotation.set(Math.sin(tt) * 1.2, i, Math.cos(tt * 0.7));
        this.dummy.scale.set(sz, sz * 0.12, sz * 0.7);
        P[o + 3] += Math.sin(tt) * 2 * dt; P[o + 5] += Math.cos(tt * 1.3) * 2 * dt;
      } else { this.dummy.rotation.set(i, i * 2, 0); this.dummy.scale.setScalar(sz); }
      this.dummy.updateMatrix(); this.parts.setMatrixAt(i, this.dummy.matrix); this.parts.setColorAt(i, this.pcol[i]);
      i++;
    }
    // ring pulses (real time: they read through hit stop as the impact itself)
    for (const r of this.rings) {
      if (r.t <= 0) continue;
      r.t -= dt > 0 ? rdt : rdt * 0.25;
      const k = 1 - Math.max(0, r.t) / r.life, e = 1 - Math.pow(1 - k, 3);
      r.m.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      (r.m.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
      if (r.t <= 0) r.m.visible = false;
    }
    this.parts.count = this.pn;
    this.parts.instanceMatrix.needsUpdate = true;
    if (this.parts.instanceColor) this.parts.instanceColor.needsUpdate = true;

    // nets and lamps
    for (let i = 0; i < 2; i++) {
      this.bulge[i] = Math.max(0, this.bulge[i] - rdt * 3);
      this.nets[i].scale.x = (i === 0 ? -1 : 1) * (1 + this.bulge[i] * 0.45);
      this.lampT[i] = Math.max(0, this.lampT[i] - rdt);
      this.lamps[i].color.setHex(this.lampT[i] > 0 && Math.sin(this.t * 16) > 0 ? 0xff2222 : 0x551111);   // about 2.5 flashes a second (photosensitivity limit is 3)
    }
    // crowd bounce
    if (this.cheer > 0) {
      this.cheer -= rdt;
      const B = this.crowdBase, a = Math.min(1, this.cheer) * 0.45;
      if (this.fans.length) this.placeFans(Math.max(0, a));
      else for (let i = 0; i < B.length / 4; i++) {
        this.dummy.position.set(B[i * 4], B[i * 4 + 1] + Math.abs(Math.sin(this.t * 11 + B[i * 4 + 3])) * a, B[i * 4 + 2]);
        this.dummy.rotation.set(0, 0, 0); this.dummy.scale.set(1, 1, 1); this.dummy.updateMatrix();
        this.crowd.setMatrixAt(i, this.dummy.matrix);
      }
      this.crowd.instanceMatrix.needsUpdate = true;
    }
    // impact star
    if (this.powT > 0) {
      this.powT -= rdt;
      const k = Math.max(0, this.powT) / 0.3;
      this.pow.visible = this.powT > 0;
      this.pow.scale.setScalar(this.powS * (1 - 0.75 * k));
      ((this.pow.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.9 * k;
    }
    // shockwave ring
    if (this.shockT > 0) {
      this.shockT -= rdt;
      const k = 1 - this.shockT / 0.4;
      this.shockMesh.scale.setScalar(this.shockR * k);
      (this.shockMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - k));
    }
    // gimmicks
    const gim = g.opp.gimmick;
    const warn = gim === 'frost' ? g.lane.warn : gim === 'zamboni' ? g.zam.warn : 0;
    const laneOn = (gim === 'frost' && (g.lane.warn > 0 || g.lane.t > 0)) || (gim === 'zamboni' && (g.zam.warn > 0 || g.zam.active));
    this.laneMesh.visible = laneOn;
    if (laneOn) {
      const z = gim === 'zamboni';
      this.laneMesh.position.x = z ? g.zam.x : g.lane.x;
      this.laneMesh.scale.x = z ? g.zam.hx * 2 : g.lane.half * 2;
      this.laneMat.color.setHex(z ? 0xff8a1e : 0x4fd8ff);
      this.laneMat.opacity = warn > 0 ? 0.15 + 0.25 * (Math.sin(this.t * 22) > 0 ? 1 : 0) : z ? 0.22 : 0.5;
    }
    this.zam.visible = g.zam.active;
    if (g.zam.active) this.zam.position.set(g.zam.x, 0, g.zam.y);
    const lk = g.dark > 0 ? 0.12 : 1;
    this.lightK += (lk - this.lightK) * Math.min(1, rdt * 8);
    for (const d of this.decals) if (d.visible) (d.material as THREE.MeshBasicMaterial).opacity = 0.16 * this.lightK;
    this.hemi.intensity = 1.25 * this.lightK; this.sun.intensity = 1.7 * this.lightK;

    // camera: vertical "2K" view from behind the home end, looking up-ice at the net we attack
    const aspect = this.camera.aspect;
    const live = g.phase !== 'faceoff' && h.out <= 0;
    const sep = live ? Math.abs(p.x - h.x) : 0;
    // predictive follow (src/camera.ts): spring follow of the puck (pulled a little toward your skater) with a
    // velocity look-ahead and speed zoom; the test rink follows your skater
    const pv = p.owner ?? p;
    const cam = this.cam.update(rdt, {
      x: live ? (g.sandbox ? h.x : p.x * 0.85 + h.x * 0.15) + CAM_LEAD : CAM_LEAD, z: live ? (g.sandbox ? h.y : p.y * 0.85 + h.y * 0.15) * 0.5 : 0,
      vx: live ? pv.vx * 0.85 : 0, vz: live ? pv.vy * 0.85 * 0.5 : 0,   // the target's own velocity (it is 85% puck, z at half scale)
      extraDist: Math.max(0, Math.min(10, sep - 16)) * 0.3,
      minX: -L + 9, maxX: L - 12, minZ: -7, maxZ: 7, lead: live && !g.sandbox,
    }, aspect < 1.6 ? (1.6 / aspect) ** 0.5 : 1);
    this.camX = cam.x; this.camZ = cam.z; this.camD = cam.dist;
    const dist = this.camD;
    // feedback camera: trauma shake, directional kick, zoom punch, roll and fov kick (src/feedback/system.ts)
    const F = this.fxCam;
    const pd = dist * (1 - F.punch);
    const tx = this.camX + F.ox, tz = this.camZ + F.oz;
    this.camera.position.set(tx - Math.cos(CAM_EL) * pd, Math.sin(CAM_EL) * pd, tz);
    this.camera.lookAt(tx, 0, tz);
    if (F.roll) this.camera.rotateZ(F.roll);
    const fov = 38 + F.fov;
    if (Math.abs(this.camera.fov - fov) > 1e-3) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (this.post && (this.chromaAmt.value > 1e-4 || this.postWarm > 0)) { this.postWarm = Math.max(0, this.postWarm - 1); this.post.render(); }
    else this.renderer.render(this.scene, this.camera);
  }
}
