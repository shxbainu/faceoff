import { FollowCam } from './camera';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { positionLocal, normalLocal, normalView, positionViewDirection, materialColor, mix, smoothstep, dot, vec3, attribute, float, step, pass, uniform } from 'three/tsl';
import { Ragdoll, RAGDOLL, RAG_BONES, RAG, HitKind } from './ragdoll';
import { BodyWorld, initBodies, BODY, type StickSpec } from './physics/body';
import { rgbShift } from 'three/addons/tsl/display/RGBShiftNode.js';
import { Game, L, W, CR, GL, GOAL_HALF, NET_DEPTH, TEAM, TeamDef, Ev, Skater, PR, STICK } from './sim';

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
  getup?: number;   // fall clip time when the get-up started (it plays back from there)
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
  ikW?: number; oneW?: number; ikT?: THREE.Vector3; ikTo?: number[]; chestTw?: number; shM?: number[]; shO?: number[]; spotO?: THREE.Vector3; fitO?: THREE.Vector3; palmL?: THREE.Object3D; palmR?: THREE.Object3D; physOk?: boolean; bindQ?: Record<string, THREE.Quaternion>; twB?: Record<string, THREE.Object3D | null>; swM?: THREE.Quaternion; swA?: number; swE?: number; palmClip?: THREE.Vector3; armClipT?: number; poleLag?: THREE.Vector3[]; gripErr?: number[]; neckB?: THREE.Object3D; pelB?: THREE.Object3D; armBase?: Record<string, THREE.Vector3>; clavR?: THREE.Object3D | null; botT?: THREE.Vector3; headB?: THREE.Object3D; sp1?: THREE.Object3D;
  /** each arm's elbow as the clip bends it (left, right): pole direction (world) and the bend's normal in the upper
   *  arm's parent space, so the IK keeps the elbow hinging the way the clip (a real elbow) does */
  armClip?: { pole: THREE.Vector3; n: THREE.Vector3 }[];
  anat?: { head: THREE.Vector3; headUp: THREE.Vector3; hand: { q: THREE.Quaternion; ax: THREE.Vector3 }[] } | null;
  /** the stick prop's resting position in the glove (the IK moves it; restored every frame) */
  stickR?: THREE.Matrix4; clipQ?: THREE.Quaternion[]; capB?: Record<string, THREE.Object3D>; stickL?: THREE.Matrix4; aim?: { dir: THREE.Vector3; T: THREE.Vector3; w: number };
  /** the cloned skater model (mirrored on x for a left shot) */
  model?: THREE.Object3D;
  /** bones the upper-body layer and stick IK turn: the clip's pose for each, and what the layers left last frame */
  layer?: { bones: THREE.Object3D[]; base: THREE.Quaternion[]; out: THREE.Quaternion[]; ready: boolean; pBase?: THREE.Vector3; pOut?: THREE.Vector3 };
  /** procedural skating legs: mode, stride phase (0..1, left skate), stride size, layer weight, eased foot targets
   *  per skate (lat out from the hips, fore ahead, lift, toe-out yaw) in the body's own frame, and the rig lengths */
  /** big check: ragdoll (pending start, the body, its bones, the sim position it last rode from); light check: stagger */
  ragStart?: { nx: number; ny: number; imp: number; kind: HitKind }; rag?: Ragdoll; ragBones?: THREE.Object3D[]; ragNeck?: THREE.Object3D | null; ragX?: number; ragZ?: number;
  stag?: { t: number; dx: number; dy: number; a: number };
  /** the chest's stride motion this frame (pitch, roll, rad) and the head's eased share of it (gaitLegs, headGaze) */
  dyn?: { p: number; r: number; hp: number; hr: number };
  gait?: { mode: string; ph: number; amp: number; w: number; turn: number; tgt: number[][]; rig?: GaitRig; contact: boolean[]; mt?: number; post?: { hip: number; lean: number; roll: number; push: number } };
}
interface GaitRig { leg: number; footY: number; bones: { th: THREE.Object3D; ca: THREE.Object3D; ft: THREE.Object3D; r: boolean }[]; pelvis: THREE.Object3D; sp1: THREE.Object3D; sp3: THREE.Object3D;
  neck: THREE.Object3D; head: THREE.Object3D; ua: THREE.Object3D[]; la: THREE.Object3D[] }
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
const HEAD = { gain: 0.55, max: 0.7, rate: 6, dead: 0.02, behind: 2.4, chest: 0.15 };   // chest: share of the look the spine takes (the rest is the head)
/** Procedural skating legs (render only, see gaitLegs). Lengths are fractions of the skater's own leg length.
 *  cycle: ground covered per full stride cycle (both skates) at a crawl and at top speed; effortShort: how much
 *  shorter the cycle gets while digging hard (choppy starts); minHz/maxHz: cadence limits; push: share of a skate's
 *  cycle spent on the ice pushing; out: lateral reach of a push at low and full stride; inW: where a skate sets down
 *  under the hips; set/back: fore-aft set-down and push end; lift: recovery height; crouch: hip drop at rest and
 *  extra at speed; sway: hips over the gliding skate; lean: forward chest lean at top speed (rad); toeMax: most toe-out
 *  on a push (rad); blend: how fast the legs ease between states (per s); glideW/readyW: stance half widths. */
export const GAIT = {
  cycle: [3.0, 7.0], effortShort: 0.4, minHz: 1.3, maxHz: 2.4, push: 0.58,
  // push path: diagonally out and back, sized so the leg ends just short of straight at the hip height below
  out: [0.25, 0.6], inW: 0.09, set: 0.16, back: [0.18, 0.52], lift: 0.06,
  // hip (thigh joint) height above the blade, in leg lengths: about a 115 degree knee standing or gliding, about
  // 100 degrees at full speed; dips a little as each push extends. Absolute, so the clip's own crouch can't stack.
  hip: [0.85, 0.79], hipDip: 0.045, sway: 0.4, toeMax: 0.7, blend: 14,
  // torso lean from vertical (rad, pelvis to neck): ready, glide, stride at a crawl and at top speed, backward, stop
  lean: { ready: 0.22, glide: 0.33, stride: [0.45, 0.52], back: 0.3, stop: 0.2, cross: 0.6 },
  // the body over each push (rad; scaled by the push's reach): pitch dips the chest as a push extends, roll leans the
  // chest over the gliding skate, breath a slow chest rise in every mode; head: share of the chest's motion the head
  // keeps (the rest is stabilised), eased at headLag per s so it trails the chest a little
  body: { pitch: 0.1, roll: 0.4, breath: 0.015, breathHz: 0.3, head: 0.6, headLag: 10 },
  headLevel: 0.85,   // how level the head is held over the stride (the clip itself carries the hip and shoulder counter-rotation)
  glideW: 0.17, readyW: 0.24, stopW: 0.3, backOut: 0.42, crossOut: 0.5, crossOver: 0.28,
  // ankle: toe flick (rad, toe down) at full extension, toe up while the skate swings forward, the toe's reach from
  // the ankle (leg lengths, so the heel lifts and the toe stays on the ice), how long a change of mode eases (s)
  flick: 0.55, toeUp: 0.2, toeLen: 0.16, modeEase: 0.25,
  post: 7,   // posture (hip height, torso lean, side lean) eases to each mode's and speed's value at this rate (1/s); set outright, a change of mode or a speed burst snapped the chest 10-20 cm in one frame
};
/** How a stick is held (stickIK aims it, stickHold, gripBottom). slide: how far below the knob the top hand may hold the shaft (share of its
 *  length); len: the drawn stick's length as a share of the model's (2.04 units, 91% of the skater's height; 0.9
 *  makes it reach his chin, as a real one does), shortening the shaft above `keep` (share from the blade); bottom:
 *  where the bottom hand holds it (share from the blade; about shoulder width below the knob); botSlide: how far that grip
 *  may slide toward the blade and toward the knob to stay in the arm's reach. */
export const STICK_HOLD = { slide: 0.03, len: 0.9, keep: 0.15, bottom: 0.72, botSlide: [0.15, 0.05] };
/** Body capsules the stick and the hands keep out of (world units; off the outfit mesh: torso 0.22-0.30 from the spine
 *  line, thigh 0.13-0.16, helmet 0.19-0.31 from the head bone). head runs from the head bone `headUp` up; shaft: the
 *  stick's radius; palm: a glove's */
export const BODY_CAPS = { torso: 0.26, thigh: 0.14, head: 0.17, headUp: 0.2, shaft: 0.02, palm: 0.04 };
/** closest points of segments p1-q1 and p2-q2 (written to c1, c2); returns their distance */
const segClosest = (p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, c1: THREE.Vector3, c2: THREE.Vector3) => {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2), a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), cl = (x: number) => Math.max(0, Math.min(1, x));
  let sv = 0, t = 0;
  if (a > 1e-9 || e > 1e-9) {
    if (a <= 1e-9) t = cl(f / e);
    else { const c = d1.dot(r); if (e <= 1e-9) sv = cl(-c / a); else { const b = d1.dot(d2), dn = a * e - b * b; sv = dn > 1e-12 ? cl((b * f - c * e) / dn) : 0; t = (b * sv + f) / e; if (t < 0) { t = 0; sv = cl(-c / a); } else if (t > 1) { t = 1; sv = cl((b - c) / a); } } }
  }
  c1.copy(p1).addScaledVector(d1, sv); c2.copy(p2).addScaledVector(d2, t); return c1.distanceTo(c2);
};
const ARM = { floor: 0.015 };
/** how fast the stick's target on the ice and the top hand's spot follow where they are asked to be (1/s): about
 *  60 ms to close most of a jump, fast enough for a poke, slow enough that a switch is a move, not a pop */
const IK_EASE = 18;
/** shots in the air (drawn only): height at the goal line by a hash of the release spot (low, mid, high), or where
 *  the goalie reads it (glove high, blocker mid, pads and butterfly low); rise: share of the way to the net by
 *  which it is up; g: fall once it is no longer a shot (bounce keeps this share of the speed) */
const SHOT_ARC = { low: 0.12, high: 1.05, rise: 0.35, g: 22, bounce: 0.35,
  // per save: [height to set (0: keep its own), cap]
  save: { glove: [1.0, 0], blocker: [0.7, 0], butterfly: [0, 0.6], pad_l: [0, 0.25], pad_r: [0, 0.25] } as Record<string, number[]> };
/** a save the goalie didn't read in time: the clip starts this long (s) before its reach peak, so he visibly reaches */
const GOALIE_REACT = 0.12;
/** Arms and head judged against a human body, not the clip (the clips hold the stick with the elbows hiked to
 *  shoulder height and look at the sky when the torso leans). pole: where each elbow points (weights of down, back,
 *  out); top: the top hand's spot off spine_01 (forward, up, toward its own shoulder), on the belly in front of the
 *  body; wrist/twist: most a hand may bend / roll off its bind pose (deg); gaze: the eyes look at the ice this far
 *  ahead (m); arm: upper arm and forearm length (share of the model's); shrug: most the bottom collarbone turns (rad) to drop that shoulder toward an out-of-reach grip; blade: the drawn blade is never further than this from the skater (units), a safety net past the sim's
 *  resting stick (STICK.rest): beyond it both hands cannot reach the stick below the chest; clear: the top hand (and so the knob just past it) stays this far from the spine line (pelvis to
 *  neck) - padded torsos are about 0.3 across the belly; visorTilt: the visor axis vs the eye line (rad; calibrated by review: the clip's own head reads
 *  38 deg up on it and looks chin-up, 17 deg down looks bowed); below: the top hand stays at least this far under its shoulder (m); backhand: how much further forward and out (to the forehand side) the top hand goes on a
 *  backhand, so the knob clears the belly; headGap: closest a hand may come to the head's centre (m); reach: share of an arm's length a hand is asked to reach from its shoulder; the head taking `head` of the turn and the neck the rest; yaw: most the head turns off the chest (rad),
 *  and it is held level (no roll); ride: share of the chest's twist off the heading the stick target turns with
 *  (stickIK), up to swing (rad); follow: share of the top shoulder's stride swing (its motion around its average over
 *  shAvg s) the top hand rides. */
export const ANAT = { pole: [1, 0.25, 0.12], clear: 0.5, blade: 1.9, shrug: 0.45, arm: 1.12, top: [0.58, -0.05, 0.02], backhand: [0.1, 0.2], reach: 0.88, headGap: 0.42, below: 0.3, wrist: 28, twist: 70, wristHold: 45, gaze: 6, visorTilt: 0.32, head: 0.6, yaw: 0.45, ride: 1, swing: 0.6, follow: 1, shAvg: 0.6,
  // botClear: the bottom hand stays this far off the spine line (it rides lower and to the side, so a thinner capsule);
  // elbowLag: how fast an elbow follows where it should point (1/s), so it trails the hand a beat
  botClear: 0.36, elbowLag: 10,
  // elbowMax: most an elbow bends (deg from straight); a grip closer to its shoulder than that allows moves the stick
  elbowMax: 145 };
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
  /** drawn height of the puck (display only: the sim is flat). A shot rises off the ice to hNet by the time it
   *  reaches the goal line; a puck that stops being a shot falls back and bounces. */
  private arc = { on: false, x0: 0, hNet: 0.5, h: 0, vy: 0, goalT: -1, gx: 0, gy: 0 };
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

  /** The outfit's skin weights switch from one bone to the next within a ring or two at the shoulder, elbow, hip and
   *  knee (at the elbow 918 of 1043 vertices sat fully on one bone), so linear blend skinning folds the sleeve into a
   *  sharp corner when the joint bends. Blend them across each joint instead: a few rounds of averaging with the
   *  neighbouring vertices (welded across UV seams), only on vertices weighted to an arm or leg bone and never on the
   *  gloves or skates (they stay rigid). Once per geometry, before anything reads the weights. ?nosmooth: as built. */
  private static smoothJoints(m: THREE.SkinnedMesh, rounds = 4) {
    const g = m.geometry; if (g.userData.smoothed || DBG.has('nosmooth') || !g.index) return; g.userData.smoothed = true;
    const pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight'), n = pos.count, ix = g.index.array;
    const names = m.skeleton.bones.map(b => b.name), limb = names.map(nm => /^(clavicle|upperarm|lowerarm|thigh|calf)/.test(nm)), rigid = names.map(nm => /^(hand|index|middle|ring|pinky|thumb|foot|ball|Head)/.test(nm));
    // weld: split copies of one point (UV seams) share one weight set
    const key = new Map<string, number>(), id = new Int32Array(n);
    for (let i = 0; i < n; i++) { const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`; id[i] = key.get(k) ?? key.set(k, i).get(k)!; }
    const nb = new Map<number, Set<number>>(), link = (a: number, b: number) => { if (a !== b) ((nb.get(a) ?? nb.set(a, new Set()).get(a)!)).add(b); };
    for (let t = 0; t < ix.length; t += 3) { const a = id[ix[t]], b = id[ix[t + 1]], c = id[ix[t + 2]]; link(a, b); link(b, a); link(b, c); link(c, b); link(a, c); link(c, a); }
    let w = new Map<number, Map<number, number>>();
    for (let i = 0; i < n; i++) if (id[i] === i) { const o = new Map<number, number>(); for (let c = 0; c < 4; c++) { const x = sw.getComponent(i, c); if (x > 0) o.set(si.getComponent(i, c), (o.get(si.getComponent(i, c)) ?? 0) + x); } w.set(i, o); }
    const free = [...w.keys()].filter(i => { const o = w.get(i)!; return [...o.keys()].some(b => limb[b]) && ![...o.keys()].some(b => rigid[b]); });
    for (let r = 0; r < rounds; r++) {
      const next = new Map(w);
      for (const i of free) {
        const o = new Map<number, number>(), ns = nb.get(i); if (!ns) continue;
        for (const [b, x] of w.get(i)!) o.set(b, x * 0.5);
        for (const j of ns) for (const [b, x] of w.get(j)!) o.set(b, (o.get(b) ?? 0) + x * 0.5 / ns.size);
        next.set(i, o);
      }
      w = next;
    }
    for (let i = 0; i < n; i++) {
      const top = [...w.get(id[i])!].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((a, [, x]) => a + x, 0) || 1;
      for (let c = 0; c < 4; c++) { si.setComponent(i, c, top[c]?.[0] ?? 0); sw.setComponent(i, c, (top[c]?.[1] ?? 0) / sum); }
    }
    si.needsUpdate = sw.needsUpdate = true;
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
        if ((m as THREE.SkinnedMesh).isSkinnedMesh && (m.material as THREE.MeshStandardMaterial).map) { m.material = outfitMats[team]; v.outfit = m as THREE.SkinnedMesh; View.smoothJoints(m as THREE.SkinnedMesh); View.goalieBulk(m as THREE.SkinnedMesh); }
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
  private stickGeo: { blade: THREE.Vector3; top: THREE.Vector3; gripT: number; gripB?: number; band?: THREE.Vector3[] } | null = null;
  private stickOf(v: SkaterView) {
    // the stick node (a group of wood and tape meshes, modelled in the bottom glove; stickHold moves it to the top one)
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
      // Shorten the shaft to STICK_HOLD.len of its length (the blade end keeps its shape): the model's stick reaches
      // past the skater's eyes, so with the blade on the ice the hands could not both hold it below the chest. The
      // geometry is shared by every skater's stick and its outline shell, so this runs once.
      const ax = top.clone().sub(blade), keep = STICK_HOLD.keep, k = (STICK_HOLD.len - keep) / (1 - keep), done = new Set<THREE.BufferGeometry>();
      st.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh || done.has(m.geometry)) return; done.add(m.geometry);
        const pos = m.geometry.attributes.position, toSt = new THREE.Matrix4().copy(st.matrixWorld).invert().multiply(m.matrixWorld), back = toSt.clone().invert(), p = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i).applyMatrix4(toSt);
          const t = p.clone().sub(blade).dot(ax) / ax.lengthSq();
          if (t > keep) { p.addScaledVector(ax, -(t - keep) * (1 - k)); p.applyMatrix4(back); pos.setXYZ(i, p.x, p.y, p.z); }
        }
        pos.needsUpdate = true; m.geometry.computeBoundingSphere();
      });
      top.copy(blade).addScaledVector(ax, STICK_HOLD.len);
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
    const bones = ['spine_02', 'spine_03', 'Head', 'upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l',
      'pelvis', 'spine_01', 'neck_01', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r', 'clavicle_r']
      .map(n => v.body.getObjectByName(n)).filter((b): b is THREE.Object3D => !!b);
    return (v.layer = { bones, base: bones.map(() => new THREE.Quaternion()), out: bones.map(() => new THREE.Quaternion()), ready: false });
  }
  private layerRestore(v: SkaterView) {
    const L = this.layerBones(v);
    // longer arms (ANAT.arm): the elbow and wrist joints sit further along their bones; nothing is scaled, so the
    // gloves and the stick keep their size (the model's shoulder-to-wrist is about 0.55 m at this scale, a real one 0.6)
    if (ANAT.arm !== 1 && !DBG.has('noarmlen')) for (const n of ['lowerarm_l', 'hand_l', 'lowerarm_r', 'hand_r']) {
      const b = v.body.getObjectByName(n); if (!b) continue;
      const base = ((v.armBase ??= {})[n] ??= b.position.clone()); b.position.copy(base).multiplyScalar(ANAT.arm);
    }
    const pel = v.gait?.rig?.pelvis ?? (v.ragBones ? v.body.getObjectByName('pelvis') : undefined);   // the gait and ragdoll layers move the pelvis: same restore rule for its position
    if (pel) { if (L.pOut && pel.position.equals(L.pOut)) pel.position.copy(L.pBase!); else (L.pBase ??= new THREE.Vector3()).copy(pel.position); }
    L.bones.forEach((b, i) => {
      if (L.ready && b.quaternion.equals(L.out[i])) { if (!DBG.has('nolayerfix')) b.quaternion.copy(L.base[i]); }   // mixer skipped it: back to the clip pose (?nolayerfix shows the old bug)
      else L.base[i].copy(b.quaternion);   // the mixer wrote a fresh clip pose
    });
  }
  private layerSave(v: SkaterView) {
    const L = this.layerBones(v);
    L.bones.forEach((b, i) => L.out[i].copy(b.quaternion));
    const pel = v.gait?.rig?.pelvis ?? (v.ragBones ? v.body.getObjectByName('pelvis') : undefined); if (pel && L.pBase) (L.pOut ??= new THREE.Vector3()).copy(pel.position);
    L.ready = true;
  }

  /** test hook: upper-body look (twist) and how far each layered bone sits from its clip pose (rad). Bounded when
   *  the layer is healthy; it grows without limit if layered rotations stack (the old spinning-head bug). */
  headState(i: number) {
    const v = this.skaters[i], L = v?.layer; if (!v || !L || !L.ready) return null;
    const dev = L.bones.map((b, k) => b.quaternion.angleTo(L.base[k]));
    const bad = L.bones.some(b => !Number.isFinite(b.quaternion.x + b.quaternion.y + b.quaternion.z + b.quaternion.w));
    const by = (re: RegExp) => Math.max(0, ...dev.filter((_, k) => re.test(L.bones[k].name)));
    return { twist: v.mb?.twist ?? 0, head: dev[2] ?? 0, spine: Math.max(dev[0] ?? 0, dev[1] ?? 0), arms: by(/arm|hand|^stick$/), legs: by(/thigh|calf|foot/), nan: bad, mirrored: (v.model?.scale.x ?? 1) < 0 };
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
    return { ...r, ikW: +(v.ikW ?? 0).toFixed(2), clip: v.anim?.cur };
  }

  /** test hook: hands, shoulders and the stick's top in skater i's heading frame (fwd, side to his left, up; units),
   *  measured from the pelvis, plus the gait mode and clip: tests/arm_motion_probe.mjs */
  limbs(i: number) {
    const v = this.skaters[i]; if (!v?.model) return null;
    v.root.updateMatrixWorld(true);
    const f = -v.body.rotation.y, c = Math.cos(f), s = Math.sin(f), pel = v.body.getObjectByName('pelvis')?.getWorldPosition(new THREE.Vector3()); if (!pel) return null;
    const loc = (q: THREE.Vector3 | undefined | null) => q ? [+((q.x - pel.x) * c + (q.z - pel.z) * s).toFixed(4), +((q.x - pel.x) * s - (q.z - pel.z) * c).toFixed(4), +(q.y - pel.y).toFixed(4)] : null;
    const P = (n: string) => v.body.getObjectByName(n)?.getWorldPosition(new THREE.Vector3());
    const st = this.stickOf(v), g = this.stickGeo;
    return { hl: loc(P('hand_l')), hr: loc(P('hand_r')), sl: loc(P('upperarm_l')), sr: loc(P('upperarm_r')), el: loc(P('lowerarm_l')),
      knob: st && g && st.visible ? loc(g.top.clone().applyMatrix4(st.matrixWorld)) : null, T: loc(v.ikT), spot: loc(v.palmClip), bot: loc(v.botT), tw: v.chestTw ?? 0, yaw: f, ikW: v.ikW ?? 0, one: v.oneW ?? 0, blade: st && g && st.visible ? loc(g.blade.clone().applyMatrix4(st.matrixWorld)) : null, mode: v.gait?.mode, clip: v.anim?.cur };
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
  /** collider debug ([ key or ?colliders): each stick's shaft and blade capsule, body circles, the puck. Red blade:
   *  lifted or knocked aside; yellow: poking */
  colDbg = DBG.has('colliders');
  private colLines?: THREE.LineSegments;
  private drawColliders(g: Game) {
    const SEG = 16, per = 2 + 2 + SEG, n = (g.skaters.length + 1) * per;
    if (!this.colLines) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      this.colLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
      this.colLines.renderOrder = 998; this.colLines.frustumCulled = false; this.scene.add(this.colLines);
    }
    this.colLines.visible = this.colDbg;
    if (!this.colDbg) return;
    const P = this.colLines.geometry.attributes.position as THREE.BufferAttribute, C = this.colLines.geometry.attributes.color as THREE.BufferAttribute;
    let k = 0;
    const line = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, c: number) => {
      P.setXYZ(k, x0, h0, y0); P.setXYZ(k + 1, x1, h1, y1);
      const r = (c >> 16 & 255) / 255, gg = (c >> 8 & 255) / 255, b = (c & 255) / 255; C.setXYZ(k, r, gg, b); C.setXYZ(k + 1, r, gg, b); k += 2;
    };
    const circle = (x: number, y: number, r: number, c: number) => { for (let i = 0; i < SEG; i++) { const a0 = i / SEG * 6.283, a1 = (i + 1) / SEG * 6.283; line(x + Math.cos(a0) * r, y + Math.sin(a0) * r, 0.05, x + Math.cos(a1) * r, y + Math.sin(a1) * r, 0.05, c); } };
    for (const s of g.skaters) {
      if (s.out > 0) continue;
      circle(s.x, s.y, STICK.bodyR, s.team === 0 ? 0x4aa3ff : 0xff6a4a);
      const on = s.bOn, c = !on ? 0xff2020 : s.pokeT > 0 ? 0xffd400 : 0x20ff60;
      const hx = Math.cos(s.ba) * STICK.blade / 2, hy = Math.sin(s.ba) * STICK.blade / 2;
      line(s.hx, s.hy, 0.9, s.bx, s.by, 0.05, c);   // shaft: hands (raised) to the blade
      line(s.bx - hx, s.by - hy, 0.05, s.bx + hx, s.by + hy, 0.05, c);
    }
    const p = g.pucks[0]; circle(p.x, p.y, PR + STICK.r, 0xffffff);
    this.colLines.geometry.setDrawRange(0, k);
    P.needsUpdate = true; C.needsUpdate = true;
  }
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
    const A = v.arms, T = (v.ikT ??= new THREE.Vector3()); v.aim = undefined;
    const busy = ['wrist_shot', 'slapshot', 'fall', 'check'].includes(v.anim.cur) || s.wind >= 0 || s.stun > 0 || s.air;
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    let want = 0;
    if (!busy) {
      if (s.liftT > 0) { want = 1; T.set(s.x + Math.cos(s.face) * 1.2, 0.9, s.y + Math.sin(s.face) * 1.2); }   // stick lifted off the ice
      else if (s.pokeT > 0 || s.tieT > 0) { want = 1; T.set(s.bx, IK_Y, s.by); }   // the sim's blade: the poke sweep, or knocked aside
      else if (p.owner === s) { want = 1; T.set(p.x, IK_Y, p.y); }
      else if (p.kind === 'pass' && p.target === s && d < 5) { want = 0.85; T.set(p.x + p.vx * 0.08, IK_Y, p.y + p.vy * 0.08); }
      else if (!p.owner && d < 2.6) { want = 0.7; T.set(p.x, IK_Y, p.y); }
      // defending, squared to the carrier: blade flat on the ice in the passing lane the sim has it sealing
      else if ((s.faceMode === 'back' || s.faceMode === 'square') && p.owner && p.owner.team !== s.team) { want = 0.75; T.set(s.stickX, IK_Y, s.stickY); }
      // otherwise the blade rides on the ice where the sim's stick collider is (out front), never hanging free:
      // with no target the clip and the stride layer left the stick dangling like a cane and the top hand off it
      // (when the sim's stick isn't live, faceoffs and goal resets, its own forehand rest spot off the drawn body)
      else if (s.bOn && this.game?.phase === 'play') { want = 1; T.set(s.bx, IK_Y, s.by); }
      else { const f = -v.body.rotation.y, la = STICK.rest[1] * s.hand; want = 1;
        T.set(s.x + Math.cos(f) * STICK.rest[0] - Math.sin(f) * la, IK_Y, s.y + Math.sin(f) * STICK.rest[0] + Math.cos(f) * la); }
    }
    { const dx = T.x - s.x, dz = T.z - s.y, d0 = Math.hypot(dx, dz); if (d0 > ANAT.blade) { T.x = s.x + dx * ANAT.blade / d0; T.z = s.y + dz * ANAT.blade / d0; } }
    // the stick swings with the chest: the target turns about him by the chest's twist off his heading (the stride's
    // shoulder swing, the look toward the puck), so the hands, the stick and a carried puck on it move with the body.
    // With a target fixed on the ice the hands stayed put while the shoulders swung, and the arms stretched and folded
    // on their own
    if (v.arms && !busy) {
      v.root.updateMatrixWorld(true);
      const sl = v.arms.ua_l.getWorldPosition(this.ikF), sr = v.arms.ua_r.getWorldPosition(this.ikG), f = -v.body.rotation.y;
      let cx = -(sl.z - sr.z), cz = sl.x - sr.x; if (cx * Math.cos(f) + cz * Math.sin(f) < 0) { cx = -cx; cz = -cz; }
      const tw = Math.max(-ANAT.swing, Math.min(ANAT.swing, wrapA(Math.atan2(cz, cx) - f))) * ANAT.ride;
      const ox = T.x - s.x, oz = T.z - s.y, c = Math.cos(tw), sn = Math.sin(tw);
      T.x = s.x + ox * c - oz * sn; T.z = s.y + ox * sn + oz * c;
      v.chestTw = tw;
      // and the whole stick rides the top shoulder's stride swing and the body's sway over the gliding skate (the
      // shoulder's motion over the ice around where it sits on average): the stick is rigid and its blade was pinned
      // where the sim put it, so the body swayed and swung under hands that stayed still
      const d = v.arms.ua_l.getWorldPosition(this.ikF).sub(v.root.position), lx = d.x * Math.cos(f) + d.z * Math.sin(f), lz = -d.x * Math.sin(f) + d.z * Math.cos(f);
      const m = (v.shM ??= [lx, d.y, lz]), k = 1 - Math.exp(-rdt / ANAT.shAvg);
      m[0] += (lx - m[0]) * k; m[1] += (d.y - m[1]) * k; m[2] += (lz - m[2]) * k;
      const ux = (lx - m[0]) * ANAT.follow, uz = (lz - m[2]) * ANAT.follow;
      const o = (v.shO ??= [0, 0, 0]); o[0] = ux * Math.cos(f) - uz * Math.sin(f); o[1] = (d.y - m[1]) * ANAT.follow; o[2] = ux * Math.sin(f) + uz * Math.cos(f);
      T.x += o[0]; T.z += o[2];
    } else if (v.shO) v.shO.fill(0);
    // the target eases, measured from the skater so it never trails him: when it switched (puck, lane, the sim's
    // stick) or the sim's blade jumped, the whole stick and the top hand on it crossed over in one frame
    { const o = (v.ikTo ??= [T.x - s.x, T.z - s.y]);
      if ((v.ikW ?? 0) < 0.02) { o[0] = T.x - s.x; o[1] = T.z - s.y; }
      else { const k = 1 - Math.exp(-rdt * IK_EASE); o[0] += (T.x - s.x - o[0]) * k; o[1] += (T.z - s.y - o[1]) * k; }
      T.x = s.x + o[0]; T.z = s.y + o[1]; }
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
    // The aim: blade on the ice at the target, shaft up through the top hand's spot (in front of the belly, toward its
    // own shoulder). stickHold puts the stick there in the top glove and the top arm carries it; gripBottom adds the
    // bottom hand.
    v.armClip = [this.armBend(A.ua_l, A.la_l, A.h_l, v.armClip?.[0]), this.armBend(A.ua_r, A.la_r, A.h_r, v.armClip?.[1])]; v.armClipT = this.t;   // the clip's elbows, before the IK moves them
    (v.palmClip ??= new THREE.Vector3()).copy(this.topSpot(v, this.ikE, s.bh));   // the top hand's anatomical spot
    if (v.shO) { v.palmClip.x += v.shO[0]; v.palmClip.y += v.shO[1]; v.palmClip.z += v.shO[2]; }   // rides the shoulder's swing (above)
    { // eased like the target, from the pelvis: its clamps (clear of the belly, under the shoulder, in reach) switch on
      // and off and moved the hand in steps
      const pl = (v.pelB ??= v.body.getObjectByName('pelvis')!).getWorldPosition(this.ikG), o = v.spotO;
      if (!o || w < 0.05) v.spotO = v.palmClip.clone().sub(pl);
      else { o.lerp(this.ikF.copy(v.palmClip).sub(pl), 1 - Math.exp(-rdt * IK_EASE)); v.palmClip.copy(pl).add(o); }
      this.ikE.copy(v.palmClip); }
    const spotY = this.ikE.y, dir = this.ikE.sub(T); if (dir.lengthSq() < 1e-6) return; dir.normalize();
    const len = c.copy(g.top).applyMatrix4(st.matrixWorld).distanceTo(this.ikD.copy(g.blade).applyMatrix4(st.matrixWorld));
    // Fit the stick between the blade target and the top hand: the hand sits L up the shaft, at its spot's height, as
    // far out from the blade (toward the spot) as the length needs. If that brings the hand (and the knob past it)
    // inside ANAT.clear of the spine line, the hand rises instead, up to ANAT.below under its shoulder.
    const gripB = (g.gripB ??= STICK_HOLD.bottom);
    if (g.gripT > 0) {
      const L = len * g.gripT, hz = Math.hypot(dir.x, dir.z) || 1, ux = dir.x / hz, uz = dir.z / hz;
      const pel = (v.pelB ??= v.body.getObjectByName('pelvis')!), nk = (v.neckB ??= v.body.getObjectByName('neck_01')!);
      const spine = new THREE.Line3(pel.getWorldPosition(new THREE.Vector3()), nk.getWorldPosition(new THREE.Vector3())), near = new THREE.Vector3(), H = new THREE.Vector3();
      const top = A.ua_l.getWorldPosition(new THREE.Vector3()).y - ANAT.below;
      const shR = A.ua_r.getWorldPosition(new THREE.Vector3()), armR = this.armLen(A.ua_r, A.la_r, A.h_r) * ANAT.reach, P = new THREE.Vector3();
      for (let y = spotY; ; y += 0.04) {
        const drop = Math.min(y, top) - T.y, hd = Math.sqrt(Math.max(0, L * L - drop * drop));
        H.set(T.x + ux * hd, T.y + drop, T.z + uz * hd);
        P.copy(T).lerp(H, (gripB - 0.15) / g.gripT);   // the lowest the bottom hand may grip
        if (y >= top || (spine.closestPointToPoint(H, true, near).distanceTo(H) >= ANAT.clear && P.distanceTo(shR) <= armR)) break;
      }
      // eased from the pelvis: the search above rises in steps and its two rules flip on and off, which threw the
      // shaft, both hands and the knob across in one frame
      { const pl = pel.getWorldPosition(new THREE.Vector3()), o = v.fitO;
        if (!o || w < 0.05) v.fitO = H.clone().sub(pl);
        else { o.lerp(H.clone().sub(pl), 1 - Math.exp(-rdt * IK_EASE)); H.copy(pl).add(o); }
        // easing must not carry it into the belly while the body moves: the rule still holds every frame
        const q = spine.closestPointToPoint(H, true, near), off = H.clone().sub(q), dd = off.length();
        if (dd < ANAT.clear && dd > 1e-4) { H.copy(q).addScaledVector(off, ANAT.clear / dd); v.fitO!.copy(H).sub(pl); } }
      dir.copy(H).sub(T).normalize();
    }
    v.aim = { dir: dir.clone(), T: T.clone(), w };   // stickHold puts the stick there, in the top glove
  }
  /** shortest shoulder-to-wrist distance the elbow allows (bent at most ANAT.elbowMax from straight) */
  private foldMin(la: number, lb: number) { const c = Math.cos(Math.PI - ANAT.elbowMax * Math.PI / 180); return Math.sqrt(Math.max(1e-6, la * la + lb * lb - 2 * la * lb * c)) + 1e-3; }
  /** the body's capsules now (world): torso pelvis to neck, each thigh hip to knee, the helmet */
  private capsOf(v: SkaterView) {
    const P = (n: string) => ((v.capB ??= {})[n] ??= v.body.getObjectByName(n)!).getWorldPosition(new THREE.Vector3());
    const hd = P('Head'), nk = P('neck_01'), up = hd.clone().sub(nk).normalize();
    return [{ n: 'torso', a: P('pelvis'), b: nk, r: BODY_CAPS.torso }, { n: 'thigh', a: P('thigh_l'), b: P('calf_l'), r: BODY_CAPS.thigh },
      { n: 'thigh', a: P('thigh_r'), b: P('calf_r'), r: BODY_CAPS.thigh }, { n: 'head', a: hd, b: hd.clone().addScaledVector(up, BODY_CAPS.headUp), r: BODY_CAPS.head }];
  }
  private hsM = Array.from({ length: 5 }, () => new THREE.Matrix4()); private hsV = Array.from({ length: 8 }, () => new THREE.Vector3()); private hsQ = [new THREE.Quaternion(), new THREE.Quaternion()];
  /** turn the stick (world matrix M) by q about the point c */
  private turnAbout(M: THREE.Matrix4, c: THREE.Vector3, q: THREE.Quaternion) {
    const X = this.hsM[3], R = this.hsM[4];
    M.premultiply(X.makeTranslation(-c.x, -c.y, -c.z)).premultiply(R.makeRotationFromQuaternion(q)).premultiply(X.makeTranslation(c.x, c.y, c.z));
  }
  /** Anti-clipping and floor for a stick pose M, turned about its top grip K: the shaft (heel to knob) out of every body
   *  capsule, the whole blade above the ice; a top grip inside the torso moves the whole stick out */
  private clearStick(v: SkaterView, M: THREE.Matrix4, tTop: number) {
    const g = this.stickGeo!, caps = this.capsOf(v), [K, b0, t0, c1, c2, n, lv] = this.hsV, q = this.hsQ[0];
    for (let it = 0; it < 10; it++) {
      K.copy(g.blade).lerp(g.top, tTop).applyMatrix4(M); b0.copy(g.blade).applyMatrix4(M); t0.copy(g.top).applyMatrix4(M);
      // top grip in the torso (the pivot can't turn itself out): the whole stick moves out
      { const tc = caps[0], dd = new THREE.Line3(tc.a, tc.b).closestPointToPoint(K, true, c2).distanceTo(K), need = tc.r + BODY_CAPS.palm;
        if (dd < need) { n.subVectors(K, c2); if (n.lengthSq() < 1e-8) n.set(Math.cos(-v.body.rotation.y), 0, Math.sin(-v.body.rotation.y)); n.normalize().multiplyScalar(need - dd + 0.005); M.premultiply(this.hsM[3].makeTranslation(n.x, n.y, n.z)); continue; } }
      let worst = 0, wc: THREE.Vector3 | null = null;
      for (const c of caps) { const d = segClosest(b0, t0, c.a, c.b, c1, c2), push = c.r + BODY_CAPS.shaft - d; if (push > worst) { worst = push; n.subVectors(c1, c2); wc = c1.clone(); if (c.n === 'thigh') n.y = Math.max(0, n.y); if (n.lengthSq() < 1e-8) n.set(Math.cos(-v.body.rotation.y), 0, Math.sin(-v.body.rotation.y)); n.normalize(); } }   // never down off a thigh: that drove the blade into the ice, and the floor back into the leg
      let low = 1e9; for (const pt of g.band ?? [g.blade]) { const y = c2.copy(pt).applyMatrix4(M).y; if (y < low) { low = y; c1.copy(c2); } }
      if (worst <= 0 && low >= ARM.floor) return;
      if (worst > 0) {   // turn the contact point out along n, about the top grip
        lv.subVectors(wc!, K); const l = lv.length(); if (l < 0.05) { M.premultiply(this.hsM[3].makeTranslation(n.x * (worst + 0.005), n.y * (worst + 0.005), n.z * (worst + 0.005))); continue; }
        const ax = c2.crossVectors(lv, n); if (ax.lengthSq() < 1e-10) continue;
        this.turnAbout(M, K, q.setFromAxisAngle(ax.normalize(), (worst + 0.005) / l));
      } else {   // blade under the ice: tip it up about the top grip
        lv.subVectors(c1, K); const h = Math.hypot(lv.x, lv.z); if (h < 0.05) return;
        this.turnAbout(M, K, q.setFromAxisAngle(c2.set(-lv.z, 0, lv.x).normalize(), (ARM.floor - low + 0.005) / h));
      }
    }
  }
  /** an arm's reach shell, shoulder to palm: [closest the folded elbow allows, a share of the straight arm]. Top arm:
   *  elbow to wrist plus 0.6 of the palm's offset, x0.9 (its hand turns onto the shaft after this, so not as posed);
   *  bottom arm: elbow to palm as posed, x0.93 (a straight arm lines up the wrist, not the palm) */
  private shellOf(ua: THREE.Object3D, la: THREE.Object3D, h: THREE.Object3D, palm: THREE.Object3D, top = false) {
    const S = ua.getWorldPosition(new THREE.Vector3()), E = la.getWorldPosition(new THREE.Vector3()), H = h.getWorldPosition(new THREE.Vector3()), P = palm.getWorldPosition(new THREE.Vector3()), a = S.distanceTo(E);
    const f = top ? E.distanceTo(H) + 0.6 * H.distanceTo(P) : E.distanceTo(P);
    return { S, min: this.foldMin(a, f) * (top ? 1.1 : 1.4), max: (a + f) * (top ? 0.9 : 0.93) };
  }
  /** where along the shaft (share from the blade) the bottom hand can hold a stick posed M: STICK_HOLD.bottom, or the
   *  nearest spot within STICK_HOLD.botSlide of it (down toward the blade, up) that is in the arm's reach and outside the torso and thighs; -1: none */
  private botSpot(v: SkaterView, M: THREE.Matrix4, sh: { S: THREE.Vector3; min: number; max: number }, caps: ReturnType<View['capsOf']>, out: THREE.Vector3) {
    const g = this.stickGeo!, c = new THREE.Vector3();
    const [dn, up] = STICK_HOLD.botSlide;
    for (let k = 0; k <= 40; k++) {
      const t = STICK_HOLD.bottom + (k + 1 >> 1) * (k & 1 ? 1 : -1) * 0.01; if (t < STICK_HOLD.bottom - dn - 1e-6 || t > STICK_HOLD.bottom + up + 1e-6) continue;
      out.copy(g.blade).lerp(g.top, t).applyMatrix4(M); const l = out.distanceTo(sh.S);
      if (l <= sh.max && l >= sh.min && caps.slice(0, 3).every(q => new THREE.Line3(q.a, q.b).closestPointToPoint(out, true, c).distanceTo(out) >= q.r + BODY_CAPS.palm)) return t;
    }
    return -1;
  }
  /** a wrist kept within ANAT.wristHold of the clip's own (the clips grip a stick; the bind pose's hands are flat and
   *  60-95 deg off any grip, so a limit from the bind pose cranked every holding hand) */
  private holdClamp(h: THREE.Object3D, clip: THREE.Quaternion) {
    const dv = h.quaternion.angleTo(clip), m = ANAT.wristHold * Math.PI / 180;
    if (dv > m) { h.quaternion.copy(clip).slerp(h.quaternion.clone(), m / dv); h.updateMatrixWorld(true); }
  }
  /** set a bone's world turn to that of the world matrix W (its position stays: the bone keeps its length) */
  private setWorldTurn(bone: THREE.Object3D, W: THREE.Matrix4) {
    bone.parent!.updateWorldMatrix(true, false);
    this.hsM[3].copy(bone.parent!.matrixWorld).invert().multiply(W).decompose(this.hsV[7], this.hsQ[1], this.hsV[6]);
    bone.quaternion.copy(this.hsQ[1]); bone.updateMatrixWorld(true);
  }
  /** The stick rides in the top glove (one object, a fixed hold): its pose is decided (the clip's, turned onto the stick
   *  IK's aim: blade at the target, shaft through the top hand's spot), cleared of the body and the ice, then the top
   *  arm carries it there (arm IK onto the wrist the hold needs, the hand turned to the hold, wrist clamped, then the
   *  wrist nudged so the blade lands where wanted). The hold is read once from a clip pose: the clips hold the stick
   *  in the bottom glove with the top hand on the knob, so the top glove's turn there is a natural one. */
  private stickHold(v: SkaterView, s: Skater) {
    const st = v.stick, g = this.stickGeo, A = v.arms; if (!st || !g || !A || !st.visible || g.gripT <= 0 || !v.anim) return;
    v.root.updateMatrixWorld(true);
    const tTop = g.gripT - STICK_HOLD.slide, [S0, Sw, Hw] = this.hsM, [b0, t0, K, P, W, d] = this.hsV;
    const palmT = (v.palmL ??= v.body.getObjectByName('middle_01_l') ?? A.h_l); v.palmR ??= v.body.getObjectByName('middle_01_r') ?? A.h_r;
    v.stickR ??= new THREE.Matrix4().compose(st.position, st.quaternion, st.scale);   // as modelled, in the bottom glove
    S0.multiplyMatrices(A.h_r.matrixWorld, v.stickR);   // the clip's own stick
    if (!v.stickL) {
      if (s.stun > 0 || s.air || !['stride', 'glide', 'idle', 'handle', 'back', 'cross_l', 'cross_r'].includes(v.anim.cur)) return;
      K.copy(g.blade).lerp(g.top, tTop).applyMatrix4(S0); palmT.getWorldPosition(P);
      Sw.copy(S0).premultiply(this.hsM[3].makeTranslation(P.x - K.x, P.y - K.y, P.z - K.z));   // top grip on the palm
      v.stickL = A.h_l.matrixWorld.clone().invert().multiply(Sw);
      A.h_l.add(st);
    }
    v.stickL.decompose(st.position, st.quaternion, st.scale); st.updateMatrixWorld(true);   // the hold, every frame (nothing stacks)
    const clipQ = (v.clipQ ??= [new THREE.Quaternion(), new THREE.Quaternion()])[0].copy(A.h_l.quaternion); v.clipQ[1].copy(A.h_r.quaternion);   // the clip's own wrists: the clips were made gripping a stick
    const live = !(s.stun > 0 || s.air); if (!live) return;   // down or flying: the ragdoll moves the arm, the stick rides along
    Sw.copy(S0);
    const aim = v.aim;
    if (aim && aim.w > 0.02) {   // turned onto the aim about the blade, then the blade moved onto the target
      b0.copy(g.blade).applyMatrix4(S0); t0.copy(g.top).applyMatrix4(S0);
      const q = this.hsQ[0].setFromUnitVectors(t0.sub(b0).normalize(), aim.dir); q.slerpQuaternions(this.hsQ[1].identity(), q.clone(), aim.w);
      this.turnAbout(Sw, b0, q); d.copy(b0).lerp(aim.T, aim.w).sub(b0); Sw.premultiply(this.hsM[3].makeTranslation(d.x, d.y, d.z));
    }
    // the stick where both hands can hold it: top grip in the top arm's reach (the stick slides), out of the body and
    // off the ice (it turns about the top grip), and if no bottom grip spot in range is in reach, turned about the top
    // hand toward the bottom shoulder
    // a bottom grip past the arm: the bottom shoulder drops toward it first, as players do (the collarbone turns, up to ANAT.shrug)
    { P.copy(g.blade).lerp(g.top, STICK_HOLD.bottom).applyMatrix4(Sw); const sh0 = this.shellOf(A.ua_r, A.la_r, A.h_r, v.palmR!), cl = (v.clavR ??= v.body.getObjectByName('clavicle_r') ?? null);
      const ex = P.distanceTo(sh0.S) - sh0.max * 0.9;   // as far as the grip is out of reach, no further (all or nothing, it popped the shoulder)
      if (cl && ex > 0) { const c0 = cl.getWorldPosition(W), u = sh0.S.clone().sub(c0), tt = P.clone().sub(c0); this.rotWorld(cl, u.clone().cross(tt), Math.min(ANAT.shrug, u.angleTo(tt), ex / Math.max(0.05, u.length()))); } }
    const shT = this.shellOf(A.ua_l, A.la_l, A.h_l, palmT, true), shB = this.shellOf(A.ua_r, A.la_r, A.h_r, v.palmR!), caps = this.capsOf(v);
    for (let it = 0; it < 4; it++) {
      K.copy(g.blade).lerp(g.top, tTop).applyMatrix4(Sw); const l = K.distanceTo(shT.S), lc = Math.max(shT.min, Math.min(shT.max, l));
      if (Math.abs(lc - l) > 1e-4) { P.copy(K).sub(shT.S).setLength(lc).add(shT.S).sub(K); Sw.premultiply(this.hsM[3].makeTranslation(P.x, P.y, P.z)); }
      this.clearStick(v, Sw, tTop);
      if (this.botSpot(v, Sw, shB, caps, P) >= 0) break;
      K.copy(g.blade).lerp(g.top, tTop).applyMatrix4(Sw); P.copy(g.blade).lerp(g.top, STICK_HOLD.bottom).applyMatrix4(Sw);
      const lb = P.distanceTo(shB.S), Q = W.copy(P).sub(shB.S).setLength(Math.max(shB.min * 1.05, Math.min(shB.max * 0.95, lb))).add(shB.S);
      const u = b0.subVectors(P, K), w2 = t0.subVectors(Q, K); if (u.lengthSq() < 1e-6 || w2.lengthSq() < 1e-6) break;
      this.turnAbout(Sw, K, this.hsQ[0].setFromUnitVectors(u.normalize(), w2.normalize()));
    }
    this.clearStick(v, Sw, tTop);
    // the top arm puts the palm on that stick's top grip (hinge IK, elbow down and back); the glove is turned the least
    // from the clip's own wrist so the shaft runs across the palm, and kept within ANAT.wristHold of it
    K.copy(g.blade).lerp(g.top, tTop).applyMatrix4(Sw); const ax = d.copy(g.top).sub(g.blade).transformDirection(Sw);
    const n = (v.armClipT === this.t && v.armClip ? v.armClip[0].n : this.armBend(A.ua_l, A.la_l, A.h_l).n).clone(), kn = b0, want = t0;
    for (let it = 0; it < 6; it++) {
      if (it < 2) {
        kn.subVectors(palmT.getWorldPosition(P), A.h_l.getWorldPosition(W)); want.copy(kn).addScaledVector(ax, -kn.dot(ax));
        if (want.lengthSq() > 1e-8) this.rotWorld(A.h_l, W.crossVectors(kn, want), kn.angleTo(want));
        this.holdClamp(A.h_l, clipQ);
      }
      this.hingeIK(A.ua_l, A.la_l, palmT, K, n, this.anatPole(v, A.ua_l, this.apL), 1);
    }
    // the stick sits in the glove where it was decided: parented, so it moves with the hand from here on
    palmT.getWorldPosition(P).sub(K); Sw.premultiply(this.hsM[3].makeTranslation(P.x, P.y, P.z));   // short of the grip: the stick comes to the palm
    A.h_l.updateMatrixWorld(true); Hw.copy(A.h_l.matrixWorld).invert().multiply(Sw).decompose(st.position, st.quaternion, st.scale); st.updateMatrixWorld(true);
    // a squashed body (hits) shears the glove's frame, which a decompose can't keep: slide the stick so its grip is on the palm
    K.copy(g.blade).lerp(g.top, tTop).applyMatrix4(st.matrixWorld); palmT.getWorldPosition(P);
    st.position.add(A.h_l.worldToLocal(P.clone()).sub(A.h_l.worldToLocal(K.clone()))); st.updateMatrixWorld(true);
    if (this.gripStat && aim && aim.w > 0.9) (this.gripStat.blade ??= []).push(P.copy(g.blade).applyMatrix4(st.matrixWorld).setY(aim.T.y).distanceTo(aim.T));
  }
  /** Last: the bottom hand onto its grip with two-bone (hinge) IK, elbow pole down and back, wrist clamped. The grip is
   *  STICK_HOLD.bottom along the shaft; out of the arm's reach (or in the torso or a thigh) it slides up to
   *  STICK_HOLD.botSlide either way; only if no spot in that range works the stick turns about the top hand toward the
   *  bottom shoulder. */
  private gripBottom(v: SkaterView) {
    const st = v.stick, g = this.stickGeo, A = v.arms;
    if (!st || !g || !A || !st.visible || g.gripT <= 0 || !v.stickL) { v.gripErr = undefined; return; }
    v.root.updateMatrixWorld(true);
    const palmB = v.palmR!, palmT = v.palmL!, [SB, B, c, d, e] = this.hsV;
    const at = (t: number, out: THREE.Vector3) => out.copy(g.blade).lerp(g.top, t).applyMatrix4(st.matrixWorld);
    const shB = this.shellOf(A.ua_r, A.la_r, A.h_r, palmB), caps = this.capsOf(v); let t = this.botSpot(v, st.matrixWorld, shB, caps, B);
    // no spot in range (a shot, a fall, the ragdoll): the stick turns in the top glove, about the top grip, toward the bottom shoulder
    for (let it = 0; it < 3 && t < 0; it++) {
      const M = this.hsM[0].copy(st.matrixWorld), K = at(g.gripT - STICK_HOLD.slide, c); at(STICK_HOLD.bottom, B);
      const Q = d.copy(B).sub(shB.S).setLength(Math.max(shB.min * 1.05, Math.min(shB.max * 0.95, B.distanceTo(shB.S)))).add(shB.S), u = B.clone().sub(K), w2 = Q.sub(K);
      if (u.lengthSq() < 1e-6 || w2.lengthSq() < 1e-6) break;
      this.turnAbout(M, K, this.hsQ[0].setFromUnitVectors(u.normalize(), w2.normalize()));
      M.premultiply(this.hsM[1].copy(st.parent!.matrixWorld).invert()).decompose(st.position, st.quaternion, st.scale); st.updateMatrixWorld(true);
      t = this.botSpot(v, st.matrixWorld, shB, caps, B);
    }
    if (t < 0) t = STICK_HOLD.bottom;   // still none: reach as far as the arm goes
    at(t, B); (v.botT ??= new THREE.Vector3()).copy(B);
    const dir = d.copy(g.top).sub(g.blade).transformDirection(st.matrixWorld);
    // two-bone IK on the wrist (the grip less the palm's offset from it), elbow pole down and back; the hand wraps the
    // shaft (turned the least from the clip's wrist so its knuckle line crosses the shaft, clamped) and it repeats
    const pole = this.anatPole(v, A.ua_r, this.apR).clone(), Wt = this.hsV[6];
    for (let it = 0; it < 10; it++) {
      if (it < 3) { const kn = e.subVectors(palmB.getWorldPosition(c), A.h_r.getWorldPosition(SB)), want = c.copy(kn).addScaledVector(dir, -kn.dot(dir));
        if (want.lengthSq() > 1e-8) this.rotWorld(A.h_r, SB.crossVectors(kn, want), kn.angleTo(want));
        this.holdClamp(A.h_r, v.clipQ![1]); }
      else if (palmB.getWorldPosition(c).distanceTo(B) < 0.002) break;
      Wt.copy(B).sub(palmB.getWorldPosition(c)).add(A.h_r.getWorldPosition(SB));
      this.twoBone(A.ua_r, A.la_r, A.h_r, Wt, pole, 1);
      // still short at full stretch: the grip moves along the shaft (within the slide range) to the point nearest the palm
      if (it === 6 && palmB.getWorldPosition(c).distanceTo(B) > 0.005) {
        const b0 = at(0, SB), tt = c.sub(b0).dot(dir) / at(1, e).distanceTo(b0), [dn, up] = STICK_HOLD.botSlide;
        t = Math.max(STICK_HOLD.bottom - dn, Math.min(STICK_HOLD.bottom + up, tt)); at(t, B); v.botT!.copy(B);
      }
    }
    v.root.updateMatrixWorld(true);
    v.gripErr = [palmB.getWorldPosition(c).distanceTo(B), palmT.getWorldPosition(e).distanceTo(at(g.gripT - STICK_HOLD.slide, SB))];
  }
  /** the two fixed grips on a stick, in the world: bottom (stick) hand at STICK_HOLD.bottom, top hand at the knob grip */
  private grips(st: THREE.Object3D, g: NonNullable<View['stickGeo']>, outB: THREE.Vector3, outT: THREE.Vector3) {
    outB.copy(g.blade).lerp(g.top, STICK_HOLD.bottom).applyMatrix4(st.matrixWorld);
    outT.copy(g.blade).lerp(g.top, g.gripT - STICK_HOLD.slide).applyMatrix4(st.matrixWorld);   // the glove over the knob, not past it
  }
  /** test hook (hard check): measured from the final bones and stick of the frame, each palm to its grip */
  /** ?phys: powered ragdolls (physics/body.ts) on every skater and goalie; ?phys=i on view i only */
  phys: BodyWorld | null = null; private physHit: number[] = [];
  private physLoad = DBG.has('phys') ? initBodies().then(() => { BODY.contacts = !DBG.has('nocontact'); if (DBG.get('iters')) BODY.iters = +DBG.get('iters')!; if (DBG.get('drive')) BODY.drive = +DBG.get('drive')!; if (DBG.get('bladecap')) BODY.bladeCap = +DBG.get('bladecap')!; BODY.echo = DBG.has('physecho'); BODY.joints = !DBG.has('nojoints'); this.phys = new BodyWorld(); }).catch(e => console.warn('powered ragdolls off', e)) : null;
  private physFor(i: number) { const w = DBG.get('phys'); return !!this.phys && (!w || +w === i); }
  private stickSpec(v: SkaterView): StickSpec | undefined {
    const g = this.stickGeo; if (!v.stick || !g || g.gripT <= 0) return undefined;
    return { obj: v.stick, blade: g.blade.clone(), gripB: g.blade.clone().lerp(g.top, STICK_HOLD.bottom), gripT: g.blade.clone().lerp(g.top, g.gripT - STICK_HOLD.slide) };
  }
  /** hard check (tests/grip_check.mjs), from the final bones and stick of each frame: each palm to its grip (the bottom
   *  one where gripBottom put it), and frames on their feet with the shaft (heel to knob) or a palm inside a body capsule */
  gripStat: { worst: number; frames: number; over: number; who: string; live: number; clip: number; clipWho: string; byCap: Record<string, number>; blade?: number[] } | null = null;
  private gripMeasure(v: SkaterView, s: Skater) {
    const st = v.stick, g = this.stickGeo, S = this.gripStat!;
    if (!st || !g || !v.arms || !st.visible || g.gripT <= 0 || !v.botT || !v.palmL || !v.palmR || !v.stickL) return;
    v.root.updateMatrixWorld(true);
    const pB = v.palmR.getWorldPosition(new THREE.Vector3()), pT = v.palmL.getWorldPosition(new THREE.Vector3()), K = g.blade.clone().lerp(g.top, g.gripT - STICK_HOLD.slide).applyMatrix4(st.matrixWorld);
    const e = Math.max(pB.distanceTo(v.botT), pT.distanceTo(K));
    S.frames++; if (e > 0.01) S.over++;
    if (e > S.worst) { S.worst = e; S.who = `skater ${this.skaters.indexOf(v)} bottom ${pB.distanceTo(v.botT).toFixed(4)} top ${pT.distanceTo(K).toFixed(4)} clip ${v.anim?.cur} gait ${v.gait?.mode}`; }
    if (s.stun > 0 || s.air) return;
    S.live++;
    const b0 = g.blade.clone().applyMatrix4(st.matrixWorld), t0 = g.top.clone().applyMatrix4(st.matrixWorld), c1 = new THREE.Vector3(), c2 = new THREE.Vector3();
    const hits: string[] = [];
    for (const c of this.capsOf(v)) {
      if (segClosest(b0, t0, c.a, c.b, c1, c2) < c.r + BODY_CAPS.shaft - 0.005) hits.push('shaft-' + c.n);
      for (const [nm, P] of [['top', pT], ['bottom', pB]] as const) if (new THREE.Line3(c.a, c.b).closestPointToPoint(P, true, c1).distanceTo(P) < c.r - 0.005) hits.push(nm + '-' + c.n);
    }
    if (hits.length) { S.clip++; for (const h of hits) S.byCap[h] = (S.byCap[h] ?? 0) + 1; if (!S.clipWho) S.clipWho = `skater ${this.skaters.indexOf(v)} ${hits.join(',')} clip ${v.anim?.cur} gait ${v.gait?.mode}`; }
  }

  /** pops (tests/pop_probe.mjs): the palms, the blade, the shoulders and the neck in the body's own frame (skating
   *  taken out), frame to frame. Hands and blade: `d`; shoulders, pelvis, neck: `body`; jumps over 6 cm by clip and mode */
  popStat: { frames: number; d: number[]; body: number[][]; jumps: Record<string, number> } | null = null;
  private popPrev = new Map<SkaterView, { p: THREE.Vector3[]; clip?: string; mode?: string; t: number }>();
  private popMeasure(v: SkaterView, s: Skater, rdt: number) {
    const S = this.popStat!, st = v.stick, g = this.stickGeo, A = v.arms;
    if (!st || !g || !A || !st.visible || !v.palmL || !v.palmR || rdt <= 0 || s.stun > 0 || s.air) { this.popPrev.delete(v); return; }
    v.root.updateMatrixWorld(true);
    const inv = v.body.matrixWorld.clone().invert(), at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const pts = [at(v.palmL), at(v.palmR), g.blade.clone().applyMatrix4(st.matrixWorld).applyMatrix4(inv), at(A.ua_l), at(A.ua_r), at(v.pelB ??= v.body.getObjectByName('pelvis')!), at(v.neckB ??= v.body.getObjectByName('neck_01')!)];
    const pr = this.popPrev.get(v), clip = v.anim?.cur, mode = v.gait?.mode;
    if (pr && this.t - pr.t < 0.05) {
      const d = pts.map((x, k) => x.distanceTo(pr.p[k])), m = Math.max(d[0], d[1], d[2]);
      S.frames++; S.d.push(m); S.body.push([Math.max(d[3], d[4]), d[5], d[6]]);
      if (m > 0.06) { const k = `${['topHand', 'botHand', 'blade'][d.indexOf(m)]} ${pr.clip}->${clip} ${pr.mode}->${mode}${s.wind >= 0 ? ' wind' : ''}`; S.jumps[k] = (S.jumps[k] ?? 0) + 1; }
    }
    this.popPrev.set(v, { p: pts, clip, mode, t: this.t });
  }
  /** each bone's local rotation in the bind pose (from the skin's inverse bind matrices), read once per skater */
  private bindOf(v: SkaterView) {
    const sk = v.outfit?.skeleton; if (!sk) return null;
    return (v.bindQ ??= (() => { const out: Record<string, THREE.Quaternion> = {}, inv = (i: number) => sk.boneInverses[i].clone().invert();
      sk.bones.forEach((b, i) => { const pi = sk.bones.indexOf(b.parent as THREE.Bone); if (pi < 0) return; const qq = new THREE.Quaternion(); sk.boneInverses[pi].clone().multiply(inv(i)).decompose(new THREE.Vector3(), qq, new THREE.Vector3()); out[b.name] = qq; }); return out; })());
  }
  /** A hand's roll about the forearm, spread along it: the three forearm twist bones (skinned, never animated) take a
   *  quarter, half and three quarters of it, so the sleeve turns gradually instead of wringing at the cuff. Absolute
   *  each frame (bind pose plus its share), so nothing stacks on frames the mixer leaves alone. ?notwist: off. */
  private twQ = new THREE.Quaternion(); private twA = new THREE.Vector3(0, 1, 0);
  private spreadTwist(v: SkaterView) {
    const bind = this.bindOf(v); if (!bind || DBG.has('notwist')) return;
    for (const sd of ['_l', '_r']) {
      const h = (v.twB ??= {})['hand' + sd] ??= v.body.getObjectByName('hand' + sd) ?? null; if (!h || !bind['hand' + sd]) continue;
      const q = this.twQ.copy(bind['hand' + sd]).invert().multiply(h.quaternion), ang = 2 * Math.atan2(q.y, q.w);   // roll about the bone (+y)
      const a = Math.atan2(Math.sin(ang), Math.cos(ang));
      for (const [k, f] of [[1, 0.25], [2, 0.5], [3, 0.75]] as const) {
        const nm = `lowerarm_twist_0${k}${sd}`, b = v.twB[nm] ??= v.body.getObjectByName(nm) ?? null; if (!b || !bind[nm]) continue;
        b.quaternion.copy(bind[nm]).multiply(this.twQ.setFromAxisAngle(this.twA, a * f));
      }
    }
  }
  /** test hook: each limb joint's turn off its bind pose, after every layer: swing (bend) and twist about the bone,
   *  deg. Linear blend skinning pinches a joint twisted or bent past what its weights can blend. */
  jointStat: Record<string, number[]> | null = null;
  private jointMeasure(v: SkaterView) {
    if (!v.outfit?.skeleton) return;
    const bind = this.bindOf(v)!;
    const S = this.jointStat!, q = new THREE.Quaternion(), tw = new THREE.Quaternion(), ax = new THREE.Vector3();
    for (const [key, bone, child] of [['shoulder', 'upperarm', 'lowerarm'], ['elbow', 'lowerarm', 'hand'], ['wrist', 'hand', 'middle_01'], ['knee', 'calf', 'foot'], ['hip', 'thigh', 'calf']] as const) for (const sd of ['_l', '_r']) {
      const b = v.body.getObjectByName(bone + sd), c = v.body.getObjectByName(child + sd); if (!b || !c || !bind[bone + sd]) continue;
      q.copy(bind[bone + sd]).invert().multiply(b.quaternion); ax.copy(c.position).normalize();
      const pr = ax.x * q.x + ax.y * q.y + ax.z * q.z; tw.set(ax.x * pr, ax.y * pr, ax.z * pr, q.w).normalize();
      const twist = 2 * Math.acos(Math.min(1, Math.abs(tw.w))) * 180 / Math.PI, swing = ax.clone().applyQuaternion(q).angleTo(ax) * 180 / Math.PI;
      (S[key + sd + ' swing'] ??= []).push(swing); (S[key + sd + ' twist'] ??= []).push(twist);
      const ctx = `${v.anim?.cur}/${v.gait?.mode}/stick ${v.stick?.visible ? 1 : 0}/rag ${(v as { rag?: unknown }).rag ? 1 : 0}`;
      if (swing > 150) { const c = (S['ctx ' + key + sd + ' swing>150'] ??= []) as unknown as string[]; c.push(ctx); }
      if (twist > 120) { const c = (S['ctx ' + key + sd + ' twist>120'] ??= []) as unknown as string[]; c.push(ctx); }
    }
  }
  private ikF = new THREE.Vector3(); private ikC = new THREE.Vector3(); private ikD = new THREE.Vector3(); private ikE = new THREE.Vector3(); private ikG = new THREE.Vector3();

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
    return this.skaters.map(v => v.anim ? { clip: v.anim.cur, t: +v.anim.acts[v.anim.cur].time.toFixed(3), w: +v.anim.acts[v.anim.cur].getEffectiveWeight().toFixed(2), rate: +v.anim.rate.toFixed(3), twist: +(v.mb?.twist ?? 0).toFixed(3), gsave: v.gsave ? { clip: v.gsave.clip, t: +v.gsave.t.toFixed(3) } : null } : null);
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
      // a hockey stop is the sim's own skid (not any slowing down: bots brake and carve all the time)
      if (s.skid && sp > 1.5 && s.stun <= 0 && s.checkT <= 0) {
        if (f.stopT <= 0) { f.stopSide = turn >= 0 ? 1 : -1; this.spray(s.x, s.y, s.vx / (sp || 1), s.vy / (sp || 1), 16, 0xe8f4ff, 8); }
        f.stopT = Math.max(f.stopT, 0.15);   // holds while skidding, then a short settle
      }
      f.stopT -= dt;
    }
    // shooting: the body comes round to the net with the shot instead of easing round after it
    const shooting = (v.anim?.shotT ?? 0) > 0 || (s.wind >= 0 && this.game?.pucks[0].owner === s);
    f.yaw = wrapA(f.yaw + wrapA(-s.face - f.yaw) * Math.min(1, rdt * (shooting ? 40 : 14)));
    const st = f.stopT > 0 ? Math.min(1, f.stopT / 0.15) : 0;
    v.body.rotation.order = 'YXZ';
    v.body.rotation.y = f.yaw;   // the facing itself turns through the stop: no extra spin on top
    v.body.rotation.x = f.lean - f.stopSide * st * 0.2;   // dig the edges in, leaning back from the stop
    v.body.rotation.z = -f.pitch;
  }

  /** Gait state from the sim (display only): which leg mode, and the stride phase advanced by distance skated, so
   *  the pushes look like they make the speed. Hard acceleration shortens the cycle (quick, choppy pushes); at speed
   *  the cycle stretches into long pushes and glides. Hit stop (dt 0) freezes it. */
  private gaitStep(v: SkaterView, s: Skater, dt: number) {
    const g = v.gait ??= { mode: 'ready', ph: Math.random(), amp: 0, w: 0, turn: 0, tgt: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], contact: [true, true], mt: 1 };
    const sp = Math.hypot(s.vx, s.vy), f = v.feel, k = Math.min(1, sp / s.move.topSpeed), effort = f?.effort ?? 0;
    const along = sp > 0.01 ? (s.vx * Math.cos(s.face) + s.vy * Math.sin(s.face)) / sp : 1;
    const cur = v.anim?.cur ?? '';
    let mode: string;
    if (s.stun > 0.25 || s.air || s.checkT > 0 || cur === 'slapshot' || cur === 'check' || cur === 'fall') mode = 'off';
    else if ((f?.stopT ?? 0) > 0) mode = 'stop';
    else if (s.faceMode === 'pivot' && sp > 1.5) mode = 'pivot';
    else if (sp > 1.2 && along < -0.3) mode = s.drive ? 'back' : 'glide';
    else if (s.drive && sp > 0.8) mode = Math.abs(f?.turn ?? 0) > 1.6 && sp > 5 ? 'cross' : 'stride';
    else mode = sp > 0.6 ? 'glide' : 'ready';
    if (mode !== g.mode) g.mt = 0; else g.mt = (g.mt ?? 1) + dt;   // time in this mode: a change of mode eases across
    g.mode = mode; g.turn = f?.turn ?? 0;
    if (dt <= 0) return;
    if (mode === 'stride' || mode === 'cross' || mode === 'back') {
      const cyc = (GAIT.cycle[0] + (GAIT.cycle[1] - GAIT.cycle[0]) * k) * (1 - GAIT.effortShort * effort) * (mode === 'stride' ? 1 : 0.75);
      g.ph = (g.ph + Math.max(GAIT.minHz, Math.min(GAIT.maxHz, sp / cyc)) * (v.anim?.rate ?? 1) * dt) % 1;
    }
    const want = mode === 'stride' || mode === 'cross' ? Math.min(1, 0.25 + 0.85 * k) * (1 - 0.35 * effort) : mode === 'back' ? 0.5 + 0.5 * k : 0;
    g.amp += (want - g.amp) * Math.min(1, dt * 6);
  }

  /** a looping locomotion clip held at the gait's stride phase, so the upper body sways with the pushing legs */
  private scrubLoop(act: THREE.AnimationAction, v: SkaterView) {
    act.paused = false; act.timeScale = 0; act.time = (v.gait?.ph ?? 0) * act.getClip().duration;
  }

  /** Foot targets for one skate in the body's frame: [lateral (+ = side axis, leg lengths), fore (+ = ahead),
   *  lift, toe yaw (+ = toward the side axis, rad)]. `sg` is which side of the body this skate is on, `ps` its phase. */
  private gaitFoot(g: NonNullable<SkaterView['gait']>, sg: number, ps: number, sp: number, hz: number, leg: number, stopSide: number): number[] {
    const G = GAIT, A = g.amp, lerp = (ab: number[], t: number) => ab[0] + (ab[1] - ab[0]) * t;
    const sm = (u: number) => u * u * (3 - 2 * u);
    ps = ((ps % 1) + 1) % 1;
    switch (g.mode) {
      case 'stride': {
        const P = G.push, out = lerp(G.out, A), back = lerp(G.back, A);
        // toe-out that keeps the blade running along its own path on the ice (no sideways skid): lateral speed of
        // the push against the forward speed of the blade over the ice
        const toe = (u: number) => {
          const latV = (out - G.inW) * 2 * u / P * hz * leg, fwdV = sp - (G.set + back) * 2 * u / P * hz * leg;
          return Math.min(G.toeMax, Math.atan2(latV, Math.max(0.6, fwdV)));
        };
        // push: glides first, then drives out and back, fastest at the end (a smooth u^1.6 arc, no snap at the turn)
        // ankle: flat through the push, the toe flicks down as the leg reaches full extension, then comes up as the skate
        // swings forward and flattens to set down (a locked flat foot hinged the whole stride at the knee)
        if (ps < P) { const u = ps / P, e = Math.pow(u, 1.6), fl = G.flick * A * sm(Math.max(0, (u - 0.82) / 0.18)); return [sg * (G.inW + (out - G.inW) * e), G.set - (G.set + back) * e, G.toeLen * Math.sin(fl), sg * toe(u), fl]; }
        // recovery: comes in under the hips first (lateral leads), then forward to set down, low over the ice
        const u = (ps - P) / (1 - P), eL = sm(Math.min(1, u * 1.4)), eF = sm(u);
        const fl = G.flick * A * (1 - sm(Math.min(1, u * 3))) - G.toeUp * A * Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.2) / 0.8)));
        return [sg * (out + (G.inW - out) * eL), -back + (G.set + back) * eF, G.lift * (0.5 + 0.5 * A) * Math.sin(Math.PI * u) + G.toeLen * Math.sin(Math.max(0, fl)), sg * toe(1) * (1 - eL), fl];
      }
      case 'cross': {
        // outward from the turn, in side-axis terms: a positive path turn bends toward -side
        const outS = g.turn > 0 ? 1 : -1, outside = sg === outS, X = G.crossOver, O = G.crossOut;
        if (outside) {   // pushes out on its inside edge, lifts, steps over in front of the inside skate
          if (ps < 0.5) { const u = ps / 0.5, fl = G.flick * sm(Math.max(0, (u - 0.8) / 0.2)); return [outS * (-0.12 + (O + 0.12) * Math.pow(u, 1.3)), 0.2 - 0.35 * u, G.toeLen * Math.sin(fl), outS * 0.35 * u, fl]; }
          const u = (ps - 0.5) / 0.5, e = sm(u), fl = G.flick * (1 - sm(Math.min(1, u * 3))) - G.toeUp * Math.sin(Math.PI * u);
          return [outS * (O - (O + X) * e), -0.15 + 0.4 * e, 0.12 * Math.sin(Math.PI * u) + G.toeLen * Math.sin(Math.max(0, fl)), outS * 0.35 * (1 - e), fl];
        }
        const q = (ps + 0.5) % 1;   // the inside skate: crossunder push under the body, then lifts out and comes back
        if (q < 0.5) { const u = q / 0.5; return [outS * (-0.3 + 0.45 * u), 0.05 - 0.15 * u, 0, -outS * 0.1]; }
        const u = (q - 0.5) / 0.5, e = sm(u);
        return [outS * (0.15 - 0.45 * e), -0.1 + 0.15 * e, 0.1 * Math.sin(Math.PI * u), -outS * 0.1];
      }
      case 'back': {   // C-cuts: heel swings out and forward, then sweeps back in under the hips; blades stay on the ice
        if (ps < 0.6) { const u = ps / 0.6; return [sg * (G.inW + (G.backOut * A) * Math.sin(Math.PI * u)), -0.05 + 0.32 * u, 0, -sg * 0.45 * Math.sin(Math.PI * u)]; }
        const u = (ps - 0.6) / 0.4, e = sm(u);
        return [sg * G.inW, 0.27 - 0.32 * e, 0.03 * Math.sin(Math.PI * u), 0];
      }
      case 'stop':   // both blades turned across the line of travel, the leading skate ahead, digging in
        return [sg * G.stopW, sg * stopSide * 0.14, 0, stopSide * 1.25];
      case 'pivot':   // mohawk: heels together, toes open, the body turns over them
        return [sg * 0.14, 0, 0, sg * 1.0];
      case 'glide':
        return [sg * G.glideW, sg * 0.06, 0, sg * 0.08];
      default:   // ready stance
        return [sg * G.readyW, 0, 0, sg * 0.16];
    }
  }

  /** Procedural skating legs, applied over the clip (render only; the sim is the truth for movement).
   *  Each skate gets a target from gaitFoot, eased between modes; the hips drop and sway over the gliding skate; the
   *  chest leans in with speed; then two-bone IK (thigh, calf) puts the skate on its target and the foot is turned
   *  to the target's toe angle with the blade flat. Rotations go through rotWorld, so mirrored (left shot) models work. */
  private gW = { up: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(), side: new THREE.Vector3(), H: new THREE.Vector3(), K: new THREE.Vector3(), F: new THREE.Vector3(), T: new THREE.Vector3(),
    a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), m: new THREE.Matrix4() };
  private gQ = new THREE.Quaternion(); private gU1 = new THREE.Vector3(); private gU2 = new THREE.Vector3(); private gX = new THREE.Vector3(); private gY = new THREE.Vector3(); private gZ = new THREE.Vector3();
  private gaitLegs(v: SkaterView, s: Skater, dt: number, rdt: number) {
    const g = v.gait; if (!g || !v.model) return;
    const W = this.gW, up = W.up;
    v.root.updateMatrixWorld(true);
    if (!g.rig) {
      const B = (n: string) => v.body.getObjectByName(n);
      const pelvis = B('pelvis'), sp1 = B('spine_01'), sp3 = B('spine_03'), neck = B('neck_01'), head = B('Head');
      const ua = [B('upperarm_l'), B('upperarm_r')], la = [B('lowerarm_l'), B('lowerarm_r')];
      if (!pelvis || !sp1 || !sp3 || !neck || !head || ua.some(b => !b) || la.some(b => !b)) return;
      const bones = (['l', 'r'] as const).map(x => ({ th: B('thigh_' + x)!, ca: B('calf_' + x)!, ft: B('foot_' + x)!, r: x === 'r' }));
      if (bones.some(b => !b.th || !b.ca || !b.ft)) return;
      const th = bones[0].th.getWorldPosition(W.a), ca = bones[0].ca.getWorldPosition(W.b), ft = bones[0].ft.getWorldPosition(W.c);
      const leg = th.distanceTo(ca) + ca.distanceTo(ft);
      const footY = Math.min(...bones.map(b => b.ft.getWorldPosition(W.d).y)) - v.root.position.y;
      // each foot's rest orientation in the body's frame (unmirrored): the IK restores it, then turns it to the target
      const inv = W.m.copy(v.body.matrixWorld).invert();
      for (const b of bones) {
        const e = b.ft.matrixWorld.elements;
        (b as any).ax = [new THREE.Vector3(e[0], e[1], e[2]).normalize().transformDirection(inv), new THREE.Vector3(e[4], e[5], e[6]).normalize().transformDirection(inv)];
      }
      g.rig = { leg, footY, bones, pelvis, sp1, sp3, neck, head, ua: ua as THREE.Object3D[], la: la as THREE.Object3D[] };
    }
    const R = g.rig!, leg = R.leg;
    g.w += ((g.mode === 'off' ? 0 : 1) - g.w) * Math.min(1, rdt * 8);
    if (g.w < 0.01) return;
    const face = -v.body.rotation.y, fwd = W.fwd.set(Math.cos(face), 0, Math.sin(face)), side = W.side.crossVectors(up, fwd).normalize();
    const sp = Math.hypot(s.vx, s.vy), k = Math.min(1, sp / s.move.topSpeed);
    const cyc = (GAIT.cycle[0] + (GAIT.cycle[1] - GAIT.cycle[0]) * k) * (1 - GAIT.effortShort * (v.feel?.effort ?? 0));
    const hz = Math.max(GAIT.minHz, Math.min(GAIT.maxHz, sp / cyc));
    const stopSide = (v.feel?.stopSide ?? 1);
    const base = W.d.set(v.body.matrixWorld.elements[12], v.root.position.y, v.body.matrixWorld.elements[14]);
    // which side of the body each skate is on (a mirrored model swaps them), from the hips
    const sides = R.bones.map(b => Math.sign(b.th.getWorldPosition(W.a).sub(base).dot(side)) || (b.r ? 1 : -1));
    const ease = Math.min(1, rdt * GAIT.blend);
    R.bones.forEach((b, i) => {
      const t = this.gaitFoot(g, sides[i], g.ph + (b.r ? 0.5 : 0), sp, hz, leg, stopSide);
      const cur = g.tgt[i];
      // stepping modes follow their own path exactly once settled; a change of mode eases across
      const settled = (g.mode === 'stride' || g.mode === 'back' || g.mode === 'cross') && (g.mt ?? 1) > GAIT.modeEase;
      for (let j = 0; j < 5; j++) cur[j] += ((t[j] ?? 0) - cur[j]) * (settled ? Math.max(ease, 0.5) : ease);
      g.contact[i] = cur[2] < 0.01;
    });
    // hips: set to an absolute height (athletic stance, not the clip's squat), dipping as each push extends, and
    // swayed over the gliding skate (away from the pushing one)
    const latMean = (g.tgt[0][0] + g.tgt[1][0]) * 0.5, stepping = g.mode === 'stride' || g.mode === 'cross' || g.mode === 'back';
    const pushX = stepping ? Math.max(Math.abs(g.tgt[0][0]), Math.abs(g.tgt[1][0])) / Math.max(0.01, GAIT.out[1]) : 0;
    const P0 = (g.post ??= { hip: NaN, lean: NaN, roll: 0, push: 0 }), pe = DBG.has('nopost') ? 1 : 1 - Math.exp(-rdt * GAIT.post), ez = (cur: number, want: number) => Number.isNaN(cur) ? want : cur + (want - cur) * pe;
    P0.push = ez(P0.push, pushX);
    P0.hip = ez(P0.hip, (GAIT.hip[0] + (GAIT.hip[1] - GAIT.hip[0]) * (stepping ? k : 0.3 * k) - (g.mode === 'stop' ? 0.05 : 0)) * leg);
    const hipH = P0.hip - GAIT.hipDip * P0.push * g.amp * leg;
    const hipNow = (R.bones[0].th.getWorldPosition(W.a).y + R.bones[1].th.getWorldPosition(W.b).y) / 2 - v.root.position.y - R.footY;
    const pel = R.pelvis, pw = pel.getWorldPosition(W.a);
    pw.addScaledVector(side, -GAIT.sway * latMean * leg * g.w).addScaledVector(up, (hipH - hipNow) * g.w);
    pel.parent!.updateWorldMatrix(true, false); pel.position.copy(pel.parent!.worldToLocal(pw)); pel.updateMatrixWorld(true);
    // torso: lean to an absolute angle from vertical for the mode and speed (the clip's own lean doesn't stack)
    const L = GAIT.lean, leanMode = g.mode === 'stride' ? L.stride[0] + (L.stride[1] - L.stride[0]) * k : g.mode === 'cross' ? L.cross
      : g.mode === 'back' ? L.back : g.mode === 'stop' ? L.stop : g.mode === 'glide' ? L.glide : L.ready;
    const leanWant = P0.lean = ez(P0.lean, leanMode);
    const r = R.neck.getWorldPosition(W.b).sub(R.pelvis.getWorldPosition(W.c)), leanNow = Math.atan2(r.dot(fwd), r.y);
    // and the body moves with each push: the chest dips as a push extends and leans over the gliding skate (with the
    // hips), and breathes; held dead still it read as a mannequin on moving legs
    const Bd = GAIT.body, m0 = v.mb, still = DBG.has('nobody') ? 0 : 1, dP = still * (Bd.pitch * P0.push * g.amp + Bd.breath * Math.sin(this.t * Math.PI * 2 * Bd.breathHz + (m0?.phase ?? 0))) * g.w;
    P0.roll = ez(P0.roll, stepping ? Bd.roll * latMean / GAIT.out[1] : 0);
    const dR = still * P0.roll * g.w;
    this.rotWorld(R.sp1, W.c.crossVectors(up, fwd), (leanWant - leanNow) * g.w + dP);   // a pure pitch about the side axis (an axis off r x fwd also yawed the shoulders)
    this.rotWorld(R.sp1, fwd, dR);   // a positive turn about fwd moves the neck toward -side, the way the hips shift for latMean > 0
    const dy = (v.dyn ??= { p: 0, r: 0, hp: 0, hr: 0 }), ke = 1 - Math.exp(-rdt * Bd.headLag);
    dy.p = dP; dy.r = dR; dy.hp += (dP - dy.hp) * ke; dy.hr += (dR - dy.hr) * ke;
    // legs
    R.bones.forEach((b, i) => {
      const [lat, fore, lift, yaw, pitch] = g.tgt[i];
      const H = b.th.getWorldPosition(W.H), K = b.ca.getWorldPosition(W.K), F = b.ft.getWorldPosition(W.F);
      const T = W.T.copy(base).addScaledVector(side, lat * leg).addScaledVector(fwd, fore * leg).addScaledVector(up, R.footY + lift * leg);
      T.lerp(F, 1 - g.w);
      // remember the foot's wanted orientation before the leg turns
      const yawQ = this.gQ.setFromAxisAngle(up, this.yawSign(fwd, side) * yaw);
      const bw = (b as any).ax as THREE.Vector3[];
      const u1 = this.gU1.copy(bw[0]).transformDirection(v.body.matrixWorld).applyQuaternion(yawQ), u2 = this.gU2.copy(bw[1]).transformDirection(v.body.matrixWorld).applyQuaternion(yawQ);
      // knee bent forward over the toe, a little out to its own side (by the hip it hangs from, not where the skate is:
      // a crossover skate past the midline flipped the knee across, into the other knee)
      this.twoBone(b.th, b.ca, b.ft, T, W.b.copy(fwd).addScaledVector(side, sides[i] * 0.25), 1);
      void H; void K;
      // foot: turn its first axis onto u1, then roll about it until the second matches u2 (blade flat, toe at yaw)
      const e = b.ft.matrixWorld.elements, c1 = W.a.set(e[0], e[1], e[2]).normalize();
      this.rotWorld(b.ft, W.c.crossVectors(c1, u1), c1.angleTo(u1) * g.w);
      const e2 = b.ft.matrixWorld.elements, c2 = W.b.set(e2[4], e2[5], e2[6]).normalize();
      const p2 = c2.addScaledVector(u1, -c2.dot(u1)), q2 = u2.addScaledVector(u1, -u2.dot(u1));
      if (p2.lengthSq() > 1e-8 && q2.lengthSq() > 1e-8) this.rotWorld(b.ft, W.c.crossVectors(p2, q2), p2.angleTo(q2) * g.w);
      // ankle: pitch about the skate's own cross axis (up x toe turns the toe down); the target was raised to keep the toe on the ice
      if (Math.abs(pitch) > 1e-3) this.rotWorld(b.ft, W.c.copy(fwd).applyQuaternion(yawQ).cross(up).negate(), pitch * g.w);
    });
    this.gaitUpper(g, R, fwd);
    // a hockey stop keeps throwing ice off both blades until it is done
    if (g.mode === 'stop' && s.skid && dt > 0 && sp > 2 && Math.random() < 0.6) this.spray(s.x, s.y, s.vx / sp, s.vy / sp, 3, 0xe8f4ff, 4 + sp * 0.4);
  }
  /** Head over the stride: levelled (pitch and roll) so it rides smooth; the look layer sets its yaw. Hip and shoulder
   *  counter-rotation come from the stride clip itself (adding more here, plus the look turning the chest, twisted
   *  the shoulders 30-45 degrees off the hips). */
  private guV = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private gaitUpper(g: NonNullable<SkaterView['gait']>, R: GaitRig, fwd: THREE.Vector3) {
    const G = GAIT, [a, b, c, d] = this.guV, up = this.gW.up, w = g.w;
    // head: level its pitch and roll (keep the yaw the look layer sets), so it glides over the stride
    const hup = R.head.getWorldPosition(a).sub(R.neck.getWorldPosition(d)).normalize();   // the neck's line (rig-axis free)
    const want = b.copy(up).addScaledVector(fwd, 0.25).normalize();   // carried a little forward, eyes up the ice
    const ang = hup.angleTo(want) * G.headLevel * w;
    if (ang > 1e-3) this.rotWorld(R.neck, c.crossVectors(hup, want), ang);
  }
  /** Bind-pose references, read once per skater from the skin: the head bone's own forward axis, and each hand's
   *  rest turn on its forearm with the axis toward the knuckles (a straight wrist). */
  private anatOf(v: SkaterView) {
    if (v.anat !== undefined) return v.anat;
    let mesh: THREE.SkinnedMesh | null = null;
    v.body.traverse(o => { if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).skeleton.bones.some(b => b.name === 'Head')) mesh = o as THREE.SkinnedMesh; });
    if (!mesh) return (v.anat = null);
    const m = mesh as THREE.SkinnedMesh, sk = m.skeleton;
    const bind = (n: string) => { const i = sk.bones.findIndex(b => b.name === n); return i < 0 ? null : new THREE.Matrix4().copy(sk.boneInverses[i]).invert(); };
    const headB = v.body.getObjectByName('Head'); if (!headB) return (v.anat = null);
    v.root.updateMatrixWorld(true);
    // head axes from the kit itself, in the head bone's frame: up toward the helmet's middle, forward toward the
    // visor's (the bind pose's head frame was 70-100 deg off where the face points)
    const mid = (re: RegExp) => { const c = new THREE.Vector3(), p = new THREE.Vector3(); let n = 0;
      v.body.traverse(o => { const ms = o as THREE.Mesh; if (!ms.isMesh || !re.test(o.name) || (ms.material as THREE.Material).side === THREE.BackSide) return;
        const cnt = ms.geometry.attributes.position.count; for (let k = 0; k < cnt; k += 5) { ms.getVertexPosition(k, p); c.add(p.applyMatrix4(ms.matrixWorld)); n++; } });
      return n ? headB.worldToLocal(c.divideScalar(n)) : null; };
    const hv = mid(/^visor/), hh = mid(/^helmet/); if (!hv || !hh) return (v.anat = null);
    const hu = hh.clone().normalize(), hf = hv.clone().addScaledVector(hu, -hv.dot(hu)).normalize();
    const hand = (['l', 'r'] as const).map(x => {
      const la = bind('lowerarm_' + x)!, h = bind('hand_' + x)!, mid = bind('middle_01_' + x);
      const loc = new THREE.Matrix4().copy(la).invert().multiply(h), q = new THREE.Quaternion(); loc.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      const ax = mid ? new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(h).invert().multiply(mid)).normalize() : new THREE.Vector3(1, 0, 0);
      return { q, ax };
    });
    return (v.anat = { head: hf, headUp: hu, hand });
  }
  /** where an elbow points, by anatomy: mostly down, a little back and a little out from the body (mirror safe: "out"
   *  is read off where the shoulder sits from the neck) */
  private apL = new THREE.Vector3(); private apR = new THREE.Vector3(); private apT = new THREE.Vector3();
  private anatPole(v: SkaterView, upper: THREE.Object3D, out: THREE.Vector3) {
    const f = -v.body.rotation.y, [d, b, o] = ANAT.pole, neck = (v.neckB ??= v.body.getObjectByName('neck_01')!);
    const side = upper.getWorldPosition(out).sub(neck.getWorldPosition(this.apT)).setY(0).normalize();
    return out.set(-Math.cos(f) * b, -d, -Math.sin(f) * b).addScaledVector(side, o).normalize();
  }
  /** the top hand's spot: in front of the belly, a little toward its own shoulder */
  private topSpot(v: SkaterView, out: THREE.Vector3, bh = 0) {
    const A = v.arms!, f = -v.body.rotation.y, fw = ANAT.top[0] + ANAT.backhand[0] * bh, up = ANAT.top[1], sd = ANAT.top[2] + ANAT.backhand[1] * bh, sp = (v.sp1 ??= v.body.getObjectByName('spine_01')!);
    const side = A.ua_l.getWorldPosition(this.apT).sub(A.ua_r.getWorldPosition(out)).setY(0).normalize();
    sp.getWorldPosition(out).add(new THREE.Vector3(Math.cos(f) * fw, up, Math.sin(f) * fw)).addScaledVector(side, sd);
    const pel = (v.pelB ??= v.body.getObjectByName('pelvis')!), nk = (v.neckB ??= v.body.getObjectByName('neck_01')!);
    const spine = new THREE.Line3(pel.getWorldPosition(new THREE.Vector3()), nk.getWorldPosition(new THREE.Vector3())), near = new THREE.Vector3();
    for (let it = 0; it < 3; it++) {   // clear of the belly, under the shoulder, in reach: the three pull against each other, so settle them
      spine.closestPointToPoint(out, true, near); const off = out.clone().sub(near), dd = off.length();
      if (dd < ANAT.clear) out.copy(near).addScaledVector(dd > 1e-4 ? off.divideScalar(dd) : new THREE.Vector3(Math.cos(f), 0, Math.sin(f)), ANAT.clear);
      out.y = Math.min(out.y, A.ua_l.getWorldPosition(this.apT).y - ANAT.below);   // a deep crouch drops the shoulders: stay well under them
      this.inReach(A.ua_l, A.la_l, A.h_l, out);
    }
    // never by the helmet (a deep crossover crouch brings the head down to the hands): push the spot down and away
    const hd = (v.headB ??= v.body.getObjectByName('Head')!).getWorldPosition(this.apT), off = out.clone().sub(hd), dd = off.length();
    if (dd < ANAT.headGap) out.copy(hd).add(off.setY(Math.min(off.y, 0) - 0.05).normalize().multiplyScalar(ANAT.headGap));
    return out;
  }
  /** push a hand target out of the torso (a capsule of radius r round the pelvis-to-neck line) and away from the helmet */


  private armLen(ua: THREE.Object3D, la: THREE.Object3D, h: THREE.Object3D) { return ua.getWorldPosition(this.irS).distanceTo(la.getWorldPosition(this.irK)) + this.irK.distanceTo(h.getWorldPosition(this.apT)); }
  /** pull a hand target back toward its shoulder until it is within ANAT.reach of the arm's length (no locked-out arm) */
  private irS = new THREE.Vector3(); private irK = new THREE.Vector3();
  private inReach(ua: THREE.Object3D, la: THREE.Object3D, h: THREE.Object3D, T: THREE.Vector3) {
    const S = ua.getWorldPosition(this.irS), K = la.getWorldPosition(this.irK), len = (S.distanceTo(K) + K.distanceTo(h.getWorldPosition(this.apT))) * ANAT.reach;
    const d = T.distanceTo(S); if (d > len) T.sub(S).multiplyScalar(len / d).add(S);
    return T;
  }
  /** keep a wrist within ANAT.wrist of straight (bend) and ANAT.twist (roll), measured from the bind pose */
  private wcR = new THREE.Quaternion(); private wcT = new THREE.Quaternion(); private wcS = new THREE.Quaternion(); private wcI = new THREE.Quaternion();
  private wristClamp(v: SkaterView, hand: THREE.Object3D, k: number) {
    const an = this.anatOf(v); if (!an) return;
    const { q, ax } = an.hand[k];
    const r = this.wcR.copy(q).invert().multiply(hand.quaternion);   // turn off the straight wrist, in the bind frame
    const pr = ax.x * r.x + ax.y * r.y + ax.z * r.z;
    const tw = this.wcT.set(ax.x * pr, ax.y * pr, ax.z * pr, r.w).normalize(), sw = this.wcS.copy(r).multiply(this.wcI.copy(tw).invert());
    const lim = (x: THREE.Quaternion, deg: number) => { const a = x.angleTo(this.wcI.identity()), m = deg * Math.PI / 180; if (a > m) this.wcI.identity().slerp(x, m / a), x.copy(this.wcI); };
    lim(sw, ANAT.wrist); lim(tw, ANAT.twist);
    hand.quaternion.copy(q).multiply(sw).multiply(tw); hand.updateMatrixWorld(true);
  }
  /** test hook: a hand's bend off a straight wrist (deg, bind pose), twist not counted */
  private wristDev(v: SkaterView, hand: THREE.Object3D, k: number) {
    const an = this.anatOf(v); if (!an) return NaN;
    const { q, ax } = an.hand[k], r = q.clone().invert().multiply(hand.quaternion);
    return +(ax.clone().applyQuaternion(r).angleTo(ax) * 180 / Math.PI).toFixed(0);
  }
  /** eyes on the ice a few metres ahead: pitch the head (and neck) so its forward axis looks at that spot */
  private hgA = new THREE.Vector3(); private hgB = new THREE.Vector3(); private hgC = new THREE.Vector3();
  private headGaze(v: SkaterView) {
    const an = this.anatOf(v), head = (v.headB ??= v.body.getObjectByName('Head')!), neck = (v.neckB ??= v.body.getObjectByName('neck_01')!); if (!an || !head) return;
    const up = this.gW.up, bf = -v.body.rotation.y;
    head.updateWorldMatrix(true, false);
    // yaw: no further than ANAT.yaw off the body's facing
    { const f = this.hgA.copy(an.head).transformDirection(head.matrixWorld), d = Math.atan2(Math.sin(Math.atan2(f.z, f.x) - bf), Math.cos(Math.atan2(f.z, f.x) - bf));
      if (Math.abs(d) > ANAT.yaw) this.rotWorld(head, up, d - Math.sign(d) * ANAT.yaw); }   // a turn about world +y lowers atan2(z, x): a positive angle undoes a positive d
    for (const [bone, share] of [[neck, 1 - ANAT.head], [head, 1]] as const) {
      head.updateWorldMatrix(true, false);
      const f = this.hgA.copy(an.head).transformDirection(head.matrixWorld), eye = head.getWorldPosition(this.hgB);
      const h = this.hgC.set(f.x, 0, f.z); if (h.lengthSq() < 1e-4) return;
      // look down at the ice ANAT.gaze ahead; the visor's axis runs ANAT.visorTilt below the eye line, so aim it that much lower
      const down = Math.atan2(eye.y, ANAT.gaze) - ANAT.visorTilt, want = h.normalize().multiplyScalar(Math.cos(down)).setY(-Math.sin(down));
      this.rotWorld(bone, this.gZ.crossVectors(f, want), f.angleTo(want) * share);
    }
    // roll: the head's up has no sideways lean (turn about its own forward until its up is in the vertical plane)
    const f = this.hgA.copy(an.head).transformDirection(head.matrixWorld), hu = this.hgB.copy(an.headUp).transformDirection(head.matrixWorld);
    const want = this.hgC.copy(up).addScaledVector(f, -up.dot(f)); if (want.lengthSq() < 1e-4) return;
    hu.addScaledVector(f, -hu.dot(f));
    this.rotWorld(head, f.clone().multiplyScalar(Math.sign(this.gZ.crossVectors(hu, want).dot(f)) || 1), hu.angleTo(want));
    // keep a share of the chest's stride motion, a beat late, so the head rides the body instead of floating level
    const dy = v.dyn; if (!dy || v.gait?.mode === 'off') return;
    const fw = this.hgA.set(Math.cos(bf), 0, Math.sin(bf));
    this.rotWorld(head, this.hgB.crossVectors(up, fw), dy.hp * GAIT.body.head); this.rotWorld(head, fw, dy.hr * GAIT.body.head);
  }
  /** Arm IK that respects the elbow as a hinge. 1: bend or straighten the elbow only about its own bend axis (the
   *  clip's, kept in the upper arm's frame) to the angle the reach needs; 2: swing the whole arm from the shoulder so
   *  the hand lands on the target; 3: roll the arm about the shoulder-to-hand line so the elbow points along `pole`. No step can fold the forearm through the joint. (A free two-bone solve with a pole bent
   *  the top-hand elbow inward, a chicken wing, in up to half the frames.) `nClip` is the clip's bend normal in the
   *  upper arm's own frame; `w` scales it all. */
  private hiV = Array.from({ length: 7 }, () => new THREE.Vector3());
  private hingeIK(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, T: THREE.Vector3, nClip: THREE.Vector3, pole: THREE.Vector3, w: number) {
    const [H, K, F, u, f, n, t] = this.hiV;
    upper.getWorldPosition(H); lower.getWorldPosition(K); end.getWorldPosition(F);
    const la = H.distanceTo(K), lb = K.distanceTo(F), lt = Math.max(this.foldMin(la, lb), Math.min(la + lb - 1e-3, H.distanceTo(T)));
    // 1. elbow angle, about the clip's hinge axis (stored in the upper arm's frame; mirrored frames flip a cross product)
    upper.updateWorldMatrix(true, false);
    n.copy(nClip).transformDirection(upper.matrixWorld);
    if (upper.matrixWorld.determinant() < 0) n.negate();
    u.subVectors(K, H); f.subVectors(F, K);
    const a0 = Math.PI - u.angleTo(f), a1 = Math.acos(Math.max(-1, Math.min(1, (la * la + lb * lb - lt * lt) / (2 * la * lb))));
    this.rotWorld(lower, n, (a0 - a1) * w);
    // a nearly straight clip arm has a poorly defined hinge: if that turn bent the elbow the wrong way, turn it back past
    { lower.getWorldPosition(K); end.getWorldPosition(F); const a2 = Math.PI - u.subVectors(K, H).angleTo(f.subVectors(F, K));
      if (Math.abs(a2 - a1) > Math.abs(a0 - a1) + 1e-3) this.rotWorld(lower, n, -2 * (a0 - a1) * w); }
    // 2. swing the arm so the hand points at the target
    end.getWorldPosition(F);
    u.subVectors(F, H); t.subVectors(T, H);
    this.rotWorld(upper, f.crossVectors(u, t), u.angleTo(t) * w);
    // 3. roll about the shoulder-to-hand line (the hand stays put) until the elbow points where `pole` says (the
    // clip's own elbow direction), so the arm keeps the clip's natural carriage
    lower.getWorldPosition(K); end.getWorldPosition(F);
    const ax = u.subVectors(F, H).normalize();
    const e = f.subVectors(K, H); e.addScaledVector(ax, -e.dot(ax));
    const dn = t.copy(pole); dn.addScaledVector(ax, -dn.dot(ax));
    if (e.lengthSq() > 1e-8 && dn.lengthSq() > 1e-8) {
      const ang = e.angleTo(dn), sg = Math.sign(n.crossVectors(e, dn).dot(ax)) || 1;
      this.rotWorld(upper, ax, sg * ang * w);
    }
  }
  /** An arm's bend as posed now: pole (where the elbow sits off the shoulder-to-hand line, world) and the bend
   *  normal (upper x fore) in the upper arm's own frame, which a correct elbow keeps pointing the same way */
  private abV = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Matrix4()] as const;
  private armBend(ua: THREE.Object3D, la: THREE.Object3D, h: THREE.Object3D, out?: { pole: THREE.Vector3; n: THREE.Vector3 }) {
    const [H, K, F, M] = this.abV, o = out ?? { pole: new THREE.Vector3(), n: new THREE.Vector3() };
    ua.getWorldPosition(H); la.getWorldPosition(K); h.getWorldPosition(F);
    const d = this.abW.subVectors(F, H), t = d.lengthSq() > 1e-9 ? this.abX.subVectors(K, H).dot(d) / d.lengthSq() : 0;
    o.pole.copy(H).addScaledVector(d, t).negate().add(K);   // elbow minus its foot on the shoulder-hand line
    o.n.crossVectors(this.abX.subVectors(K, H), this.abW.subVectors(F, K));
    // the hinge belongs to the upper arm: keep its axis in the upper arm's own frame. A cross product flips sign under
    // a mirror (left-shot models), so undo that when the frame is mirrored
    ua.updateWorldMatrix(true, false);
    o.n.transformDirection(M.copy(ua.matrixWorld).invert());
    if (ua.matrixWorld.determinant() < 0) o.n.negate();
    return o;
  }
  private abW = new THREE.Vector3(); private abX = new THREE.Vector3();
  /** Two-bone IK with a pole (legs and arms): the middle joint goes where the bone lengths put it, bent toward
   *  `pole`; the upper bone is aimed at that point, then the lower bone at the target. `w` scales the turn (0..1). */
  private tbV = Array.from({ length: 8 }, () => new THREE.Vector3());
  private twoBone(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, T: THREE.Vector3, poleIn: THREE.Vector3, w: number) {
    const [H, K, F, dir, pole, Kt, x, y] = this.tbV;
    upper.getWorldPosition(H); lower.getWorldPosition(K); end.getWorldPosition(F);
    const la = H.distanceTo(K), lb = K.distanceTo(F);
    const lt = Math.max(Math.abs(la - lb) + 1e-3, Math.min(la + lb - 1e-3, dir.subVectors(T, H).length()));
    dir.normalize();
    pole.copy(poleIn).addScaledVector(dir, -poleIn.dot(dir));
    if (pole.lengthSq() < 1e-6) return;
    pole.normalize();
    const al = Math.acos(Math.max(-1, Math.min(1, (la * la + lt * lt - lb * lb) / (2 * la * lt))));
    Kt.copy(H).addScaledVector(dir, la * Math.cos(al)).addScaledVector(pole, la * Math.sin(al));
    const aim = (bone: THREE.Object3D, from: THREE.Vector3, child: THREE.Vector3, to: THREE.Vector3) => {
      x.subVectors(child, from); y.subVectors(to, from);
      this.rotWorld(bone, this.gZ.crossVectors(x, y), x.angleTo(y) * w);
    };
    aim(upper, H, K, Kt);
    lower.getWorldPosition(K); end.getWorldPosition(F);
    aim(lower, K, F, T);
  }

  /** +1 if a positive turn about world up swings the forward axis toward the side axis */
  private gYS = new THREE.Vector3();
  private yawSign(fwd: THREE.Vector3, side: THREE.Vector3) { return this.gYS.copy(fwd).applyAxisAngle(this.gW.up, 0.1).dot(side) > 0 ? 1 : -1; }

  /** Ragdoll and stagger, after every other layer. A pending big hit starts a ragdoll from the current pose (the
   *  number at once is capped; the rest use the fall clip). The ragdoll weight eases in fast on impact and out as the
   *  sim's stun runs down to RAGDOLL.getup, where the get-up (the fall clip backward) takes over. Hit stop (dt 0)
   *  freezes it on the impact. */
  private rgV = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private rgM = [new THREE.Matrix4(), new THREE.Matrix4()]; private rgQ = new THREE.Quaternion();
  private rgS = Array.from({ length: 12 }, () => new THREE.Vector3());
  ragCount() { return this.skaters.filter(v => v.rag).length; }
  private ragApply(v: SkaterView, s: Skater, dt: number) {
    if (v.ragStart) {
      const st = v.ragStart; v.ragStart = undefined;
      if (!v.ragBones) { const bs = RAG_BONES.map(n => v.body.getObjectByName(n)); if (bs.every(b => b)) v.ragBones = bs as THREE.Object3D[]; }
      if (v.ragBones && (v.rag || this.ragCount() < RAGDOLL.max)) {
        v.root.updateMatrixWorld(true);
        const pos = v.ragBones.map(b => b.getWorldPosition(new THREE.Vector3()));
        v.rag = new Ragdoll(pos, st.nx, st.ny, st.imp, st.kind); v.ragX = s.x; v.ragZ = s.y;
      }
    }
    const up = this.gW.up;
    if (v.stag && !v.rag) {   // stagger: the torso is rocked along the hit and recovers, the skates stay put
      const g = v.stag; g.t += dt;
      const u = g.t / 0.45, k = u < 0.2 ? u / 0.2 : Math.max(0, 1 - (u - 0.2) / 0.8);
      const sp1 = v.gait?.rig?.sp1 ?? v.body.getObjectByName('spine_01');
      if (sp1) this.rotWorld(sp1, this.rgV[0].set(g.dx, 0, g.dy).cross(up).negate(), 0.42 * g.a * k * Math.sin(Math.PI * Math.min(1, u * 1.6)) + 0.12 * g.a * k);
      if (u >= 1) v.stag = undefined;
    }
    const r = v.rag; if (!r || !v.ragBones) return;
    const down = s.stun > RAGDOLL.getup && !s.air;
    if (dt > 0) r.w = down ? Math.min(1, r.w + dt / RAGDOLL.inT) : Math.max(0, r.w - dt / RAGDOLL.outT);
    if (!down && r.w <= 0) { v.rag = undefined; return; }
    r.update(dt, s.x - (v.ragX ?? s.x), s.y - (v.ragZ ?? s.y)); v.ragX = s.x; v.ragZ = s.y;
    const w = r.w, B = v.ragBones, [a, b, c, d, e, f] = this.rgV;
    v.root.updateMatrixWorld(true);
    // torso: turn the pelvis so the clip's hips-to-shoulders frame lines up with the ragdoll's, then move it there
    const frame = (hl: THREE.Vector3, hr: THREE.Vector3, sl: THREE.Vector3, sr: THREE.Vector3, m: THREE.Matrix4) => {
      const mid = c.addVectors(hl, hr).multiplyScalar(0.5), upv = d.addVectors(sl, sr).multiplyScalar(0.5).sub(mid).normalize();
      const side = e.subVectors(hr, hl); side.addScaledVector(upv, -side.dot(upv)).normalize();
      return m.makeBasis(side, upv, f.crossVectors(side, upv));
    };
    const pel = v.gait?.rig?.pelvis ?? v.body.getObjectByName('pelvis'); if (!pel) return;
    const P = (i: number, o: THREE.Vector3) => { const q = r.at(i, o as any); return o.set(q.x, q.y, q.z); };
    const S = this.rgS;
    const m0 = frame(B[0].getWorldPosition(S[0]), B[1].getWorldPosition(S[1]), B[2].getWorldPosition(S[2]), B[3].getWorldPosition(S[3]), this.rgM[0]);
    const t0 = P(RAG.HL, S[4]), t1 = P(RAG.HR, S[5]), t2 = P(RAG.SL, S[6]), t3 = P(RAG.SR, S[7]);
    const m1 = frame(t0, t1, t2, t3, this.rgM[1]);
    const q = this.rgQ.setFromRotationMatrix(m1.multiply(m0.transpose()));
    const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w))), ax = S[8].set(q.x, q.y, q.z).multiplyScalar(q.w < 0 ? -1 : 1);
    this.rotWorld(pel, ax, ang * w);
    const midNow = B[0].getWorldPosition(S[9]).add(B[1].getWorldPosition(S[10])).multiplyScalar(0.5);
    const midWant = t0.add(t1).multiplyScalar(0.5);
    const pw = pel.getWorldPosition(S[11]).addScaledVector(midWant.sub(midNow), w);
    pel.parent!.updateWorldMatrix(true, false); pel.position.copy(pel.parent!.worldToLocal(pw)); pel.updateMatrixWorld(true);
    // limbs and head: aim each bone at its particle
    const aim = (bone: THREE.Object3D, child: THREE.Object3D, i: number) => {
      const j = bone.getWorldPosition(a), x = child.getWorldPosition(b).sub(j), y = P(i, c).sub(j);
      this.rotWorld(bone, d.crossVectors(x, y), x.angleTo(y) * w);
    };
    const neck = (v.ragNeck ??= v.body.getObjectByName('neck_01') ?? null);
    if (neck) aim(neck, B[4], RAG.HD);
    aim(B[0], B[5], RAG.KL); aim(B[5], B[7], RAG.FL); aim(B[1], B[6], RAG.KR); aim(B[6], B[8], RAG.FR);
    aim(B[2], B[9], RAG.EL); aim(B[9], B[11], RAG.AL); aim(B[3], B[10], RAG.ER); aim(B[10], B[12], RAG.AR);
  }
  /** test hook: ragdolls running, their weight and health (finite, stretch of rigid links, lowest particle) */
  ragState() { return this.skaters.map((v, i) => v.rag ? { i, w: +v.rag.w.toFixed(2), age: +v.rag.age.toFixed(2), ...v.rag.health() } : null).filter(Boolean); }
  /** test hook: gait state per skater (mode, phase, stride size, eased foot targets, which skates are on the ice) */
  gaitState() {
    return this.skaters.map(v => v.gait ? { mode: v.gait.mode, ph: +v.gait.ph.toFixed(3), amp: +v.gait.amp.toFixed(2), w: +v.gait.w.toFixed(2), leg: +(v.gait.rig?.leg ?? 0).toFixed(3),
      feet: v.gait.tgt.map(t => t.map(x => +x.toFixed(3))), contact: v.gait.contact, ...this.postureOf(v) } : null);
  }
  /** test hook: the drawn stick against real hockey: shaft angle from vertical (deg; a held stick runs about 40-60),
   *  blade height above the ice, blade position off the body (forward, lateral toward the shot side), top hand's
   *  distance from its grip on the shaft (0 = holding it), and the drawn blade's distance from the sim's collider */
  closeCam: { i: number; d: number; a?: number } | null = null;
  stickPose(i: number) {
    const v0 = this.skaters[i]; if (v0) this.stickOf(v0);   // measures the grips too (with ?noik the IK never did)
    const v = this.skaters[i], g = this.stickGeo, s = this.game?.skaters[i]; if (!v || !g || !s || !v.stick || g.gripT < 0) return null;
    if (!v.arms) { const b = (n: string) => v.body.getObjectByName(n)!; v.arms = { ua_r: b('upperarm_r'), la_r: b('lowerarm_r'), h_r: b('hand_r'), ua_l: b('upperarm_l'), la_l: b('lowerarm_l'), h_l: b('hand_l') }; }   // (?noik: the IK never cached them)
    v.root.updateMatrixWorld(true);
    const m = v.stick.matrixWorld, b = g.blade.clone().applyMatrix4(m), t = g.top.clone().applyMatrix4(m);
    const ax = t.clone().sub(b), ang = Math.acos(Math.min(1, ax.y / ax.length())) * 180 / Math.PI;
    // the top hand's grip: the nearest point of the shaft's allowed range (STICK_HOLD.slide below the knob up to it)
    const lo = g.blade.clone().lerp(g.top, g.gripT - STICK_HOLD.slide).applyMatrix4(m), hi = g.blade.clone().lerp(g.top, g.gripT).applyMatrix4(m);
    const grip = new THREE.Vector3(), hl = (v.body.getObjectByName('middle_01_l') ?? v.body.getObjectByName('hand_l')!).getWorldPosition(new THREE.Vector3());   // the palm (knuckles), not the wrist
    const dx = b.x - s.x, dz = b.z - s.y, f = s.face;
    return { shaft: +ang.toFixed(0), bladeY: +this.bladeLow(v.stick).toFixed(2), fwd: +(dx * Math.cos(f) + dz * Math.sin(f)).toFixed(2), lat: +((-dx * Math.sin(f) + dz * Math.cos(f)) * s.hand).toFixed(2),
      // an elbow bent the wrong way: its bend normal against the clip's, counted only when clearly bent (a nearly
      // straight arm has no meaningful bend direction)
      elbowFlip: (v.armClip && v.arms ? [[v.arms.ua_l, v.arms.la_l, v.arms.h_l], [v.arms.ua_r, v.arms.la_r, v.arms.h_r]].map(([u, l, h], k) => {
        const H = u.getWorldPosition(new THREE.Vector3()), K = l.getWorldPosition(new THREE.Vector3()), F = h.getWorldPosition(new THREE.Vector3());
        const inner = H.clone().sub(K).angleTo(F.clone().sub(K)) * 180 / Math.PI;
        return inner < 165 && this.armBend(u, l, h).n.dot(v.armClip![k].n) < 0 ? 1 : 0; }) : [0, 0]),
      // upper arm direction along the body's forward (cos: 1 straight ahead, 0 down, negative = elbow behind the back)
      // and wrist bend (deg between forearm and hand), left arm (top hand) and right
      elbowFwd: v.arms ? [v.arms.ua_l, v.arms.ua_r].map((u, k) => { const K = [v.arms!.la_l, v.arms!.la_r][k].getWorldPosition(new THREE.Vector3()), H = u.getWorldPosition(new THREE.Vector3()); return +(K.sub(H).normalize().dot(new THREE.Vector3(Math.cos(-v.body.rotation.y), 0, Math.sin(-v.body.rotation.y)))).toFixed(2); }) : [],
      wrist: v.arms ? (['l', 'r'] as const).map(x => { const L = v.body.getObjectByName('lowerarm_' + x)!.getWorldPosition(new THREE.Vector3()), Hd = v.body.getObjectByName('hand_' + x)!.getWorldPosition(new THREE.Vector3()), M = v.body.getObjectByName('middle_01_' + x)?.getWorldPosition(new THREE.Vector3()); return M ? +(Hd.clone().sub(L).angleTo(M.sub(Hd)) * 180 / Math.PI).toFixed(0) : 0; }) : [],
      elbows: v.arms ? [[v.arms.ua_l, v.arms.la_l, v.arms.h_l], [v.arms.ua_r, v.arms.la_r, v.arms.h_r]].map(([u, l, h]) => { const H = u.getWorldPosition(new THREE.Vector3()), K = l.getWorldPosition(new THREE.Vector3()), F = h.getWorldPosition(new THREE.Vector3()); return +(H.sub(K).angleTo(F.sub(K)) * 180 / Math.PI).toFixed(0); }) : [],
      // anatomy: elbow height above its shoulder (negative = below) and wrist bend / roll off the bind pose (deg)
      elbowUp: v.arms ? [[v.arms.ua_l, v.arms.la_l], [v.arms.ua_r, v.arms.la_r]].map(([u, l]) => +(l.getWorldPosition(new THREE.Vector3()).y - u.getWorldPosition(new THREE.Vector3()).y).toFixed(2)) : [],
      headPitch: (() => { const an = this.anatOf(v), h = v.body.getObjectByName('Head'); if (!an || !h) return NaN; const f = an.head.clone().transformDirection(h.matrixWorld); return +((Math.asin(-f.y) + ANAT.visorTilt) * 180 / Math.PI).toFixed(0); })(),   // the eye line, deg below horizontal
      headRoll: (() => { const an = this.anatOf(v), h = v.body.getObjectByName('Head'); if (!an || !h) return NaN; const u = an.headUp.clone().transformDirection(h.matrixWorld), f = an.head.clone().transformDirection(h.matrixWorld); const sd = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize(); return +(Math.asin(Math.max(-1, Math.min(1, u.dot(sd)))) * 180 / Math.PI).toFixed(0); })(),
      // clearance: each hand's height above its own shoulder, nearest hand to the head centre, the knob's distance
      // from the spine line (pelvis to neck), and the head's yaw off the body's facing (deg)
      handUp: v.arms ? [[v.arms.ua_l, v.arms.h_l], [v.arms.ua_r, v.arms.h_r]].map(([u, h]) => +(h.getWorldPosition(new THREE.Vector3()).y - u.getWorldPosition(new THREE.Vector3()).y).toFixed(2)) : [],
      botNeed: v.botT && v.arms ? [+v.arms.ua_r.getWorldPosition(new THREE.Vector3()).distanceTo(v.botT).toFixed(2), +(v.arms.ua_r.getWorldPosition(new THREE.Vector3()).distanceTo(v.arms.la_r.getWorldPosition(new THREE.Vector3())) + v.arms.la_r.getWorldPosition(new THREE.Vector3()).distanceTo(v.arms.h_r.getWorldPosition(new THREE.Vector3()))).toFixed(2)] : [],
      geo: [+g.blade.clone().applyMatrix4(m).distanceTo(g.top.clone().applyMatrix4(m)).toFixed(2), +g.gripT.toFixed(2), +(g.gripB ?? -1).toFixed(2), +v.arms!.ua_r.getWorldPosition(new THREE.Vector3()).y.toFixed(2), +v.arms!.ua_r.getWorldPosition(new THREE.Vector3()).distanceTo(b).toFixed(2)],   // stick length, top and bottom grips, shoulder height, shoulder to blade
      handLat: v.arms ? [v.arms.h_l, v.arms.h_r].map(h => { const q = h.getWorldPosition(new THREE.Vector3()), qx = q.x - s.x, qz = q.z - s.y; return +((-qx * Math.sin(f) + qz * Math.cos(f)) * s.hand).toFixed(2); }) : [],   // top and bottom hand off the body's centre line, toward the shot side
      botMiss: v.botT && v.arms ? +v.arms.h_r.getWorldPosition(new THREE.Vector3()).distanceTo(v.botT).toFixed(2) : NaN,
      handHead: v.arms ? +Math.min(...[v.arms.h_l, v.arms.h_r].map(h => h.getWorldPosition(new THREE.Vector3()).distanceTo(v.body.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3())))).toFixed(2) : NaN,
      knobBody: +new THREE.Line3(v.body.getObjectByName('pelvis')!.getWorldPosition(new THREE.Vector3()), v.body.getObjectByName('neck_01')!.getWorldPosition(new THREE.Vector3())).closestPointToPoint(t, true, new THREE.Vector3()).distanceTo(t).toFixed(2),
      faceYaw: (() => { let vis: THREE.Mesh | null = null; v.body.traverse(o => { if (!vis && (o as THREE.Mesh).isMesh && o.name.startsWith('visor') && !(o as THREE.Mesh).material.hasOwnProperty('isInk')) vis = o as THREE.Mesh; }); if (!vis) return NaN;
        const m = vis as THREE.Mesh, n = m.geometry.attributes.position.count, c = new THREE.Vector3(), p = new THREE.Vector3();
        for (let k = 0; k < n; k += 7) { (m as any).getVertexPosition(k, p); c.add(p.applyMatrix4(m.matrixWorld)); } c.divideScalar(Math.ceil(n / 7));
        const hd = v.body.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3()), d = c.sub(hd), y = Math.atan2(d.z, d.x) + v.body.rotation.y;
        return +(Math.atan2(Math.sin(y), Math.cos(y)) * 180 / Math.PI).toFixed(0); })(),   // where the visor actually is, off the body's facing (deg)
      headYawS: (() => { const an = this.anatOf(v), h = v.body.getObjectByName('Head'); if (!an || !h) return NaN; const f = an.head.clone().transformDirection(h.matrixWorld), d = Math.atan2(f.z, f.x) + v.body.rotation.y; return +(Math.atan2(Math.sin(d), Math.cos(d)) * 180 / Math.PI).toFixed(0); })(),
      headYaw: (() => { const an = this.anatOf(v), h = v.body.getObjectByName('Head'); if (!an || !h) return NaN; const f = an.head.clone().transformDirection(h.matrixWorld), d = Math.atan2(f.z, f.x) + v.body.rotation.y; return +(Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 180 / Math.PI).toFixed(0); })(),
      wristDev: v.arms ? [v.arms.h_l, v.arms.h_r].map((h, k) => this.wristDev(v, h, k)) : [],
      topHand: +hl.distanceTo(new THREE.Line3(lo, hi).closestPointToPoint(hl, true, grip)).toFixed(2), toSim: s.bOn ? +Math.hypot(b.x - s.bx, b.z - s.by).toFixed(2) : -1, w: +(v.ikW ?? 0).toFixed(2) };
  }
  /** test hook: knee angles (deg, 180 = straight), torso lean from vertical (deg) and hip height (leg lengths) */
  private postureOf(v: SkaterView) {
    const R = v.gait?.rig; if (!R) return {};
    v.root.updateMatrixWorld(true);
    const P = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const knee = R.bones.map(b => { const h = P(b.th), k = P(b.ca), f = P(b.ft); return +(h.sub(k).angleTo(f.sub(k)) * 180 / Math.PI).toFixed(0); });
    const face = -v.body.rotation.y, r = P(R.neck).sub(P(R.pelvis));
    const lean = Math.atan2(r.x * Math.cos(face) + r.z * Math.sin(face), r.y) * 180 / Math.PI;
    const hip = ((P(R.bones[0].th).y + P(R.bones[1].th).y) / 2 - v.root.position.y - R.footY) / R.leg;
    // key joints in the body's frame (forward, up), for checking the silhouette side-on
    const pts: Record<string, number[]> = {};
    for (const n of ['pelvis', 'spine_01', 'spine_03', 'neck_01', 'Head', 'hand_r', 'hand_l']) { const o = v.body.getObjectByName(n); if (!o) continue;
      const q = P(o), dx = q.x - v.root.position.x, dz = q.z - v.root.position.z; pts[n] = [+(dx * Math.cos(face) + dz * Math.sin(face)).toFixed(2), +(q.y - v.root.position.y).toFixed(2)]; }
    // twist: hip line against shoulder line, seen from above (deg); chest/hips: where each line's normal points
    // relative to the facing (0 = square to the direction he faces)
    const yawOf = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2(b.z - a.z, b.x - a.x);
    const hipYaw = yawOf(P(R.bones[0].th), P(R.bones[1].th)), shYaw = yawOf(P(R.ua[0]), P(R.ua[1]));
    const dA = (x: number) => +(Math.atan2(Math.sin(x), Math.cos(x)) * 180 / Math.PI).toFixed(0);
    const sq = (y: number) => { const d = dA(y - face) ; return Math.abs(d) > 90 ? dA((y - face) + Math.PI) : d; };   // line direction mod 180
    return { knee, lean: +lean.toFixed(0), hip: +hip.toFixed(2), pts, twist: Math.abs(dA(shYaw - hipYaw)) > 90 ? 180 - Math.abs(dA(shYaw - hipYaw)) : Math.abs(dA(shYaw - hipYaw)), hipsOff: sq(hipYaw + Math.PI / 2), chestOff: sq(shYaw + Math.PI / 2) };
  }
  /** test hook: chest and head angles in the heading frame (rad) and heights (m): chest pitch/roll from the
   *  pelvis-to-neck line, shoulder-line yaw; head pitch/yaw/roll from the visor and helmet axes */
  torso(i: number) {
    const v = this.skaters[i], R = v?.gait?.rig, an = v && this.anatOf(v); if (!v || !R || !an) return null;
    v.root.updateMatrixWorld(true);
    const P = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()), face = -v.body.rotation.y;
    const f = new THREE.Vector3(Math.cos(face), 0, Math.sin(face)), sd = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), f);
    const r = P(R.neck).sub(P(R.pelvis)), yawOf = (d: THREE.Vector3) => Math.atan2(d.dot(sd), d.dot(f));
    const sh = P(R.ua[1]).sub(P(R.ua[0])), hf = an.head.clone().transformDirection(R.head.matrixWorld), hu = an.headUp.clone().transformDirection(R.head.matrixWorld);
    return { cp: Math.atan2(r.dot(f), r.y), cr: Math.atan2(r.dot(sd), r.y), cy: Math.atan2(Math.sin(yawOf(sh) - Math.PI / 2), Math.cos(yawOf(sh) - Math.PI / 2)),
      ny: P(R.neck).y - v.root.position.y, hp: Math.asin(Math.max(-1, Math.min(1, hf.y))), hy: yawOf(hf), hr: Math.atan2(hu.dot(sd), hu.y), hh: P(R.head).y - v.root.position.y, mode: v.gait!.mode, ph: v.gait!.ph };
  }
  /** test hook: world positions of the two blades (foot bones) and the body's facing, for foot-slide checks */
  feet(i: number) {
    const v = this.skaters[i]; if (!v?.model) return null;
    v.root.updateMatrixWorld(true);
    const fb = ['foot_l', 'foot_r'].map(n => v.body.getObjectByName(n)); if (fb.some(b => !b)) return null;
    return { face: -v.body.rotation.y, cx: +v.root.position.x.toFixed(3), cz: +v.root.position.z.toFixed(3), leg: v.gait?.rig?.leg, feet: fb.map(b => b!).map(ft => ({ ft })).map(b => { const p = b.ft.getWorldPosition(new THREE.Vector3()), toe = (b.ft.children[0] ?? b.ft).getWorldPosition(new THREE.Vector3()).sub(p);
      return { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), toe: [+toe.x.toFixed(3), +toe.z.toFixed(3)] }; }) };
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
    // read early: hold the stance (t < 0) and start so the reach peaks as the puck arrives (it used to start at
    // once and peak long before). At contact with no save under way: a quick reach that peaks just after, instead
    // of snapping from the stance straight to full extension
    v.gsave = { clip, t: arrive > 0 ? Math.max(-1.5, peak - arrive) : peak - GOALIE_REACT, len };
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
      if (gs && gs.t < 0) { gs.t += dt; play(a.acts.goalie ? 'goalie' : 'glide', 0.2); }   // waiting for the moment to move
      else if (gs && gs.t < gs.len && a.acts[gs.clip]) { gs.t += dt; scrub(gs.clip, gs.t / gs.len); }
      else { v.gsave = undefined; play(a.acts.goalie ? 'goalie' : 'glide', 0.2); }
      a.mixer.update(dt); return;
    }
    const sp = Math.hypot(s.vx, s.vy);
    this.gaitStep(v, s, dt);
    // knocked down: fall (Quaternius library clip, joined after its standing start), lie there, then
    // blend back to the stance when the sim lets him up
    if (s.stun > 0.25 && !s.air && a.acts.fall) {
      const dur = a.acts.fall.getClip().duration, t0 = 0.45;
      if (s.stun < RAGDOLL.getup && a.cur === 'fall') {
        // get up: the fall run backward from where it lay when the get-up began, to his feet as the sim lets him go
        const from = a.getup ??= Math.min(dur, a.acts.fall.time), u = (s.stun - 0.25) / (RAGDOLL.getup - 0.25);
        scrub('fall', (t0 + (from - t0) * Math.max(0, Math.min(1, u))) / dur);
      }
      else if (a.cur !== 'fall') { const f = play('fall', 0.1); f.time = t0; f.timeScale = 1.7; f.paused = false; a.getup = undefined; }
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
        if (DBG.has('nogait')) { const act = play('back', 0.15); act.timeScale = Math.max(0.6, Math.min(1.6, sp * act.getClip().duration / CYCLE_DIST.back)) * a.rate; }
        else this.scrubLoop(play('back', 0.15), v);
      } else if (has && sp < 6.5 && s.wind < 0 && a.acts.handle) {
        const act = play('handle', 0.15); act.timeScale = (1 + sp * 0.06) * a.rate;   // working the puck
      } else if (sp > 2.2 && s.drive) {
        // short, quick pushes while building speed; longer, slower strides once at speed.
        // a hard carve at speed switches to crossovers, stepping the outside skate over the inside one
        const e = v.feel?.effort ?? 0, tr = v.feel?.turn ?? 0;
        const cx = (tr > 0) === (s.hand > 0) ? 'cross_r' : 'cross_l';   // sim facing grows clockwise on screen: tr > 0 is a right turn; a mirrored (left shot) model plays the other clip
        const cross = !!a.acts[cx] && Math.abs(tr) > 1.6 && sp > 5;
        const act = play(cross ? cx : 'stride', 0.12);
        // the upper body follows the gait's stride phase (gaitStep), so chest and stick sway with the pushing legs;
        // ?nogait brings back the old clip playback (cadence from speed, legs from the clip)
        if (DBG.has('nogait')) act.timeScale = Math.max(0.7, Math.min(1.9, sp * act.getClip().duration / CYCLE_DIST[cross ? cx : 'stride'] * (1 + 0.7 * e))) * a.rate;
        else this.scrubLoop(act, v);
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
    // mostly the head and neck turn to watch the puck; the chest only follows a little (a big share on the spine
    // twisted the shoulders 30-45 degrees off the hips, the body screwed into itself)
    rot(b.sp2, up, -m.twist * HEAD.chest * 0.4); rot(b.sp3, up, -m.twist * HEAD.chest * 0.6); rot(b.head, up, -m.twist * (1 - HEAD.chest));
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

  /** a new faceoff or round: nobody is still crumpled from the last play */
  clearBodies() { for (const v of this.skaters) { v.rag = undefined; v.ragStart = undefined; v.stag = undefined; if (v.anim) v.anim.getup = undefined; } }
  setTeams(home: TeamDef, away: TeamDef, gemColors: number[]) {
    this.clearBodies();
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
  /** test hook: where the puck is drawn (x, height, y) */
  puckDrawn() { const q = this.puck.position; return [+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3)]; }
  /** the puck's drawn height this frame (see SHOT_ARC) */
  private puckAir(g: Game, p: { x: number; y: number; vx: number; kind: string; owner: unknown; held?: unknown; lifted?: boolean }, rdt: number) {
    const A = this.arc, shot = p.kind === 'shot' && !p.owner && !p.held && !p.lifted && g.phase === 'play';
    if (A.goalT >= 0) { A.vy -= SHOT_ARC.g * rdt; A.h = Math.max(0, A.h + A.vy * rdt); return A.h; }
    if (shot) {
      if (!A.on) {   // released: aim it low, mid or high from a hash of where it left (same on every client)
        A.on = true; A.x0 = p.x; A.vy = 0;
        const r = Math.abs(Math.sin(p.x * 12.9898 + p.y * 78.233) * 43758.5453) % 1;
        A.hNet = SHOT_ARC.low + (SHOT_ARC.high - SHOT_ARC.low) * r;
      }
      const gx = Math.sign(p.vx || 1) * GL, u = Math.max(0, Math.min(1, (p.x - A.x0) / ((gx - A.x0) || 1)));
      const k = Math.min(1, u / SHOT_ARC.rise), want = A.hNet * k * k * (3 - 2 * k);
      A.vy = (want - A.h) / Math.max(rdt, 1e-3); A.h += (want - A.h) * Math.min(1, rdt * 30);   // eased: a read save re-aims it smoothly
      return A.h;
    }
    A.on = false;
    if (A.h > 0 || A.vy > 0) {   // no longer a shot (saved, blocked, deflected): it drops and bounces
      A.vy = Math.min(A.vy, 4) - SHOT_ARC.g * rdt; A.h += A.vy * rdt;
      if (A.h <= 0) { A.h = 0; A.vy = A.vy < -2 ? -A.vy * SHOT_ARC.bounce : 0; }
    }
    if (p.owner || p.held) { A.h = 0; A.vy = 0; }
    return A.h;
  }

  /** impact: squash and lurch along the hit (or a stretch on a catch), then spring back. Real time: the squash
   *  plays through the hit stop, so the freeze shows the impact */
  private crunch(v: SkaterView, rdt: number) {
    if (!v.crunch) return;
    const c = v.crunch; c.t -= rdt;
    const u = 1 - c.t / c.len, k = c.t > 0 ? (u < 0.25 ? u / 0.25 : Math.sin(Math.PI * 0.5 * (1 - (u - 0.25) / 0.75))) * c.a : 0;
    v.body.scale.set(1 + 0.6 * k, 1 - k, 1 + 0.6 * k);
    v.body.position.x = c.dx * 2.2 * Math.max(0, k); v.body.position.z = c.dy * 2.2 * Math.max(0, k);
    if (c.t <= 0) { v.crunch = undefined; v.body.scale.set(1, 1, 1); v.body.position.x = v.body.position.z = 0; }
  }
  squash(id: number, a: number, dx = 0, dy = 0, len = 0.18) {
    const vi = this.game?.skaters.findIndex(k => k.id === id) ?? -1;
    const v = vi >= 0 ? this.skaters[vi] : null;
    if (v) v.crunch = { t: len, len, dx, dy, a };
    if (v && this.phys?.rigs.has(vi)) {   // powered ragdoll: loosen it and push the chest along the hit
      this.physHit[vi] = 0.35;
      const c = (v.body.getObjectByName('spine_03') ?? v.body).getWorldPosition(new THREE.Vector3());
      this.phys.push(vi, c, new THREE.Vector3(dx, 0, dy).multiplyScalar(a * 6));
    }
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
      case 'hit': {
        this.scuff(x, y, e.big ? 1.0 : 0.6); if (e.big) this.cheer = Math.max(this.cheer, 0.9);   // a mark left on the ice
        // a big hit throws him into a ragdoll (started next frame, from his current pose)
        const v = e.id !== undefined ? this.skaters[e.id] : undefined;
        if (v?.anim && (e.n ?? 0) >= RAGDOLL.min && !DBG.has('norag')) v.ragStart = { nx: e.dx ?? 0, ny: e.dy ?? 0, imp: e.n ?? 0, kind: (e.text as HitKind) || 'open' };
        break;
      }
      case 'bump': {   // a light check: a stagger, no knockdown
        const v = e.id !== undefined ? this.skaters[e.id] : undefined;
        if (v && (e.n ?? 0) >= RAGDOLL.stagger) v.stag = { t: 0, dx: e.dx ?? 0, dy: e.dy ?? 0, a: Math.min(1, (e.n ?? 0) / 7) };
        break;
      }
      // goalie read the shot: start the save so its reach meets the puck; a save or catch without a read starts it now
      case 'gread': if (e.team !== undefined && e.text) {
        this.goalieSave(e.team, e.text, e.n ?? 0);
        if (this.arc.on) {   // the shot comes in where he will meet it: high to the glove, mid to the blocker, under a cap for the pads and the butterfly
          const sv = SHOT_ARC.save[e.text]; if (sv) this.arc.hNet = sv[0] > 0 ? sv[0] : Math.min(this.arc.hNet, sv[1]); }
      } break;
      case 'save': case 'catch': if (e.team !== undefined && e.text) {
        this.goalieSave(e.team, e.text, 0);
        // the puck hits him: a jolt back into the net (smaller when he catches it, the glove gives)
        const gv = this.skaters[(this.game?.skaters.length ?? 0) + e.team];
        if (gv && e.t === 'save') gv.crunch = { t: 0.16, len: 0.16, dx: e.team === 0 ? -1 : 1, dy: 0, a: e.text === 'glove' || e.text === 'butterfly' ? 0.06 : 0.1 };
      } break;
      case 'stickDrop': this.burst(x, y, 10, 0xd9c9a3, 5, 4, 0.1); this.spray(x, y, e.dx ?? 0, e.dy ?? 0, 10, 0xe8f4ff, 6); break;
      case 'lunge': this.burst(x, y, 7, 0xe8f4ff, 4, 2, 0.1, 0.1); break;
      case 'faceoff': this.clearBodies(); break;
      case 'stick': if (e.text !== 'trap') this.burst(x, y, e.text === 'lift' || e.text === 'tie' ? 6 : 4, 0xe8f4ff, 3, 2, 0.08, 0.1); break;
      case 'poof': this.burst(x, y, 8, 0x9a6dff, 4, 3, 0.1); break;
      case 'crowd': this.burst(x, y, 24, 0xffb400, 6, 8, 0.2, 2); this.cheer = Math.max(this.cheer, 0.8); break;
      case 'shock': this.shockT = 0.4; this.shockR = e.n ?? 3; this.shockMesh.position.set(x, 0.06, y); break;
      case 'fire': this.cheer = 1.2; break;
      case 'goal': this.netGoal(e.team ?? 0);
        // the sim parks the puck behind the end boards: draw it going into the back of the net where it crossed
        this.arc.goalT = 0; this.arc.gx = Math.sign(x) || 1; this.arc.gy = Math.max(-(GOAL_HALF - 0.3), Math.min(GOAL_HALF - 0.3, y)); break;
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
        this.phys?.restore(i);   // last frame's physics result off the bones: the layers start from their own pose
        this.animate(v, s, p.owner === s, p.kind === 'shot' && p.shooter === s && p.age < 0.25, dt);
        this.layerRestore(v);
        if (!s.air) this.skateFeel(v, s, dt, rdt);
        if (!DBG.has('nogait')) this.gaitLegs(v, s, dt, rdt);
        if (s.stun <= 0 && !s.air && !DBG.has('nolook')) this.microBlend(v, s, p, rdt);
        if (v.stick) v.stick.visible = s.stickless <= 0;
        if (s.stickless <= 0 && !DBG.has('noik')) this.stickIK(v, s, p, rdt);
        if (!DBG.has('noanat') && !s.air && s.stun <= 0) this.headGaze(v);   // shots keep the clip's arms: they already hold the stick with the elbows down
        this.ragApply(v, s, dt);
        if (!DBG.has('noik')) { this.stickHold(v, s); this.gripBottom(v); }   // last: nothing after them moves the arms or the stick
        this.spreadTwist(v);
        const ph = this.physFor(i) && (v.physOk ||= !!this.stickSpec(v));   // wait for the stick's grips before building its rig
        if (!ph && this.gripStat) this.gripMeasure(v, s);
        if (!ph && this.jointStat) this.jointMeasure(v);
        if (this.popStat) this.popMeasure(v, s, rdt);
        this.layerSave(v);
        this.crunch(v, rdt);
        if (ph) this.phys!.capture(i, n => v.body.getObjectByName(n) ?? undefined, this.stickSpec(v), v.gripErr !== undefined);
        if (ph && this.phys!.stat && v.gripErr && v.stick && this.stickGeo) { v.root.updateMatrixWorld(true); const B = new THREE.Vector3(), K = new THREE.Vector3(); this.grips(v.stick, this.stickGeo, B, K);
          const e = Math.max(v.palmR!.getWorldPosition(new THREE.Vector3()).distanceTo(B), v.palmL!.getWorldPosition(new THREE.Vector3()).distanceTo(K)); const T = this.phys!.stat as unknown as { tgrip?: number[] }; (T.tgrip ??= []).push(e); }   // this pose is the target
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
    this.drawColliders(g);
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
      this.phys?.restore(g.skaters.length + gi);
      if (v.anim) this.animate(v, null, false, false, dt);
      v.body.position.y = 0; v.root.scale.setScalar(1.12); this.crunch(v, rdt);
      const gi2 = g.skaters.length + gi; if (v.anim && this.physFor(gi2)) { this.phys!.capture(gi2, n => v.body.getObjectByName(n) ?? undefined); }
      // the box goalie leaned into the slide; tipping the real model would push a skate and the stick into the ice
      v.root.rotation.x = v.anim ? 0 : Math.max(-0.25, Math.min(0.25, k.vy * 0.04)) * (k.team === 0 ? 1 : -1);
    });
    // powered ragdolls: one step for everyone, then the bodies go back onto the bones
    if (this.phys) {
      const P = this.phys, live = (k: number) => { const s = g.skaters[k]; return !this.skaters[k]?.crunch && (!s || (s.stun <= 0 && !s.air && !(this.physHit[k] > 0))); };
      for (let k = 0; k < this.physHit.length; k++) if (this.physHit[k] > 0) this.physHit[k] -= rdt;
      // a hit loosens the body for a moment (less drive), so it gives under the impact before the drive pulls it back
      (globalThis as unknown as { __ctx: (i: number) => string }).__ctx = (k: number) => { const s = g.skaters[k], v = this.skaters[k]; return `${v?.anim?.cur}/${v?.gait?.mode} stun ${s?.stun?.toFixed(2)} stick ${v?.stick?.visible} box ${v?.root.scale.x} rdt ${rdt.toFixed(3)}`; };
      if (rdt > 0) P.step(rdt, id => BODY.drive * (1 - 0.75 * Math.max(0, this.physHit[id] ?? 0) / 0.35));
      for (const id of P.rigs.keys()) {
        const v = this.skaters[id]; if (!v || !P.apply(id, live(id))) continue;
        this.spreadTwist(v);
        if (id < g.skaters.length) { if (this.gripStat) this.gripMeasure(v, g.skaters[id]); if (this.jointStat) this.jointMeasure(v); }
      }
      if (P.stat) P.stat.frames++;
    }
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
    const air = this.puckAir(g, p, rdt);
    if (this.arc.goalT >= 0 && Math.abs(p.x) > L) {   // a goal: into the net, off the back mesh, down onto its floor
      const A = this.arc, u = Math.min(1, (A.goalT += rdt) / 0.14);
      pkx = A.gx * (GL + (NET_DEPTH - 0.25) * u); pkz = A.gy;
    } else if (this.arc.goalT >= 0) this.arc.goalT = -1;
    this.puck.position.set(pkx, 0.05 + dropH + lift + air, pkz);
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
    if (this.closeCam) {   // test hook: the game camera's angle, moved in close on one skater (tests/arm_shots.mjs)
      const k = g.skaters[this.closeCam.i], d = this.closeCam.d, a = this.closeCam.a ?? 0;   // a: orbit off the game camera's direction
      if (k) { this.camera.position.set(k.x - Math.cos(CAM_EL) * d * Math.cos(a), 1.0 + Math.sin(CAM_EL) * d, k.y - Math.cos(CAM_EL) * d * Math.sin(a)); this.camera.lookAt(k.x, 1.0, k.y); }
    }
    if (DBG.has('sidecam')) {   // debug: low camera beside your skater, to judge posture and stick side-on
      const h = g.ctrl, a = h.face + Math.PI / 2 * (DBG.get('sidecam') === 'l' ? -1 : 1);
      this.camera.position.set(h.x + Math.cos(a) * 7, 1.6, h.y + Math.sin(a) * 7); this.camera.lookAt(h.x, 1.0, h.y);
    }
    if (F.roll) this.camera.rotateZ(F.roll);
    const fov = 38 + F.fov;
    if (Math.abs(this.camera.fov - fov) > 1e-3) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (this.post && (this.chromaAmt.value > 1e-4 || this.postWarm > 0)) { this.postWarm = Math.max(0, this.postWarm - 1); this.post.render(); }
    else this.renderer.render(this.scene, this.camera);
  }
}
