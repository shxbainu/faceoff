import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { positionLocal, normalLocal, normalView, positionViewDirection, materialColor, mix, smoothstep, dot, vec3 } from 'three/tsl';
import { Game, L, W, CR, GOAL_HALF, NET_DEPTH, TEAM, TeamDef, Ev, Skater } from './sim';

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
}
interface SkaterView {
  root: THREE.Group; body: THREE.Group; shadow: THREE.Mesh; fall: number; spin: number;
  anim?: SkaterAnim;
}
/** drawn look: two flat tones per colour plus a highlight, ink outline around every skater */
// debug switches for the look: ?nohull (no outline shell), ?noink (no contour ink), ?flat (no toon ramp)
const DBG = new URLSearchParams(location.search);
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
  private puck!: THREE.Mesh; private puckMat!: THREE.MeshStandardMaterial; private puckGlow!: THREE.Mesh;
  private ghosts: THREE.Mesh[] = [];
  private arrow!: THREE.Mesh; private disc!: THREE.Mesh; private discMat!: THREE.MeshBasicMaterial;
  private ring!: THREE.Mesh;
  private discInk!: THREE.Mesh; private beam!: THREE.Mesh; private toPuck!: THREE.Group;
  private camZ = 0; private camD = CAM_DIST;
  private gems: THREE.Mesh[] = [];
  private parts!: THREE.InstancedMesh;
  private pp = new Float32Array(400 * 8); // x y z vx vy vz life size
  private pcol: THREE.Color[] = [];
  private pn = 0;
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
  assetsReady: Promise<void> = Promise.resolve();
  private hemi!: THREE.HemisphereLight; private sun!: THREE.DirectionalLight; private lightK = 1;
  private laneMesh!: THREE.Mesh; private laneMat!: THREE.MeshBasicMaterial;
  private zam!: THREE.Group;
  private shockMesh!: THREE.Mesh; private shockT = 0; private shockR = 1;
  private pow!: THREE.Group; private powT = 0; private powS = 1;
  private punch = 0; private kickX = 0; private kickZ = 0;
  private camX = 0; private shake = 0; private t = 0;
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
      g.beginPath(); g.arc(X(s * (L - 0.9)), Y(0), 3.1 * k, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // lines
    g.fillStyle = '#d83a3a'; g.fillRect(X(0) - px(6), 0, px(12), ch);
    const BL = 0.3 * L;
    g.fillStyle = '#2f62d8'; g.fillRect(X(-BL) - px(7), 0, px(14), ch); g.fillRect(X(BL) - px(7), 0, px(14), ch);
    g.fillStyle = '#d83a3a'; g.fillRect(X(-(L - 0.9)) - px(3), 0, px(6), ch); g.fillRect(X(L - 0.9) - px(3), 0, px(6), ch);
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

    // boards as instanced segments, leaving the goal mouths open
    const segs: [number, number, number, number][] = [];
    const o = roundedOutline(0, 10);
    for (let i = 0; i < o.length; i++) {
      const a = o[i], b = o[(i + 1) % o.length];
      const endWall = Math.abs(a[0]) > L - 0.01 && Math.abs(b[0]) > L - 0.01;
      if (endWall) {
        const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
        segs.push([a[0], lo, a[0], -GOAL_HALF], [a[0], GOAL_HALF, a[0], hi]);
      } else segs.push([a[0], a[1], b[0], b[1]]);
    }
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

    // nets recessed into the end boards
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
      net.position.set(s * L, 0, 0); net.scale.x = s;
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
  private static inkToon(params: THREE.MeshToonMaterialParameters): THREE.MeshToonNodeMaterial {
    const m = new THREE.MeshToonNodeMaterial(params);
    const facing = dot(normalView, positionViewDirection).abs();
    const keep = smoothstep(0.1, 0.24, facing);   // edge ink on the surface itself: outlines without poking through
    const ink = new THREE.Color(INK);
    if (!DBG.has('noink')) m.colorNode = mix(vec3(ink.r, ink.g, ink.b), materialColor, keep);
    return m;
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
    this.helmetMat = [0, 1].map(t => View.inkToon({ color: new THREE.Color(this.teamHex[t][1]).lerp(new THREE.Color(0x8a8f99), 0.25), gradientMap: ramp }));
    const ink = new THREE.MeshBasicNodeMaterial({ color: INK, side: THREE.BackSide });
    ink.positionNode = positionLocal.add(normalLocal.mul(INK_W));
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
        if ((m as THREE.SkinnedMesh).isSkinnedMesh && (m.material as THREE.MeshStandardMaterial).map) m.material = outfitMats[team];
        else if (name.startsWith('helmet')) m.material = this.helmetMat[team];
        else m.material = toToon(m.material as THREE.Material);
        m.frustumCulled = false;
        // no outline shell on the visor or the thin skate blades: there it pokes through as dark spikes
        // (the stick is a plain box, so its shell is clean)
        if (name.startsWith('visor') || name.startsWith('blade')) return;
        const sk = m as THREE.SkinnedMesh;
        let hull: THREE.Mesh;
        if (sk.isSkinnedMesh) { const h = new THREE.SkinnedMesh(sk.geometry, ink); h.bind(sk.skeleton, sk.bindMatrix); hull = h; }
        else hull = new THREE.Mesh(m.geometry, ink);
        hull.position.copy(m.position); hull.quaternion.copy(m.quaternion); hull.scale.copy(m.scale);
        hull.frustumCulled = false; hulls.push(hull); (m.parent as THREE.Object3D).userData.hulls ??= [];
        ((m.parent as THREE.Object3D).userData.hulls as THREE.Object3D[]).push(hull);
      });
      if (!DBG.has('nohull')) model.traverse(o => { for (const h of (o.userData.hulls as THREE.Object3D[] | undefined) ?? []) o.add(h); });
      // the model faces +Z and is 1.8 m tall; the box skater faces +X and is about 2.25 units
      model.rotation.y = Math.PI / 2; model.scale.setScalar(SKATER_SCALE);
      model.position.y = 0.02;   // blades sit exactly on the ice in Blender; a hair above stops them flickering into it
      for (const c of v.body.children) c.visible = false;
      v.body.add(model);
      const mixer = new THREE.AnimationMixer(model), acts: Record<string, THREE.AnimationAction> = {};
      for (const clip of gltf.animations) {
        const a = mixer.clipAction(clip);
        if (!['idle', 'stride', 'glide', 'goalie'].includes(clip.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        acts[clip.name] = a;
      }
      acts.idle.play();
      v.anim = { mixer, acts, cur: 'idle', shotT: 0, shotKind: 'wrist', prevWind: -1, checkLen: 0 };
    });
  }

  /** test hook: which clip each skater is playing and where it is */
  animStates() {
    return this.skaters.map(v => v.anim ? { clip: v.anim.cur, t: +v.anim.acts[v.anim.cur].time.toFixed(3), w: +v.anim.acts[v.anim.cur].getEffectiveWeight().toFixed(2) } : null);
  }

  /** choose and advance the skater's clip from what the sim says it is doing */
  private animate(v: SkaterView, s: Skater | null, has: boolean, shotByMe: boolean, dt: number) {
    const a = v.anim!;
    const play = (name: string, fade = 0.15) => {
      if (a.cur === name) return a.acts[name];
      const next = a.acts[name]; next.reset(); next.enabled = true; next.setEffectiveWeight(1); next.play();
      a.acts[a.cur].crossFadeTo(next, fade, false); a.cur = name; return next;
    };
    // scrubbed clips: time follows game state, not the clock
    const scrub = (name: string, f: number) => {
      const act = play(name, 0.08); act.paused = false; act.timeScale = 0;
      act.time = Math.max(0, Math.min(0.999, f)) * act.getClip().duration;
    };
    if (!s) { play(a.acts.goalie ? 'goalie' : 'glide'); a.mixer.update(dt); return; }   // goalie: wide, low stance
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
      } else if (sp > 2.2) { const act = play('stride'); act.timeScale = Math.max(0.6, Math.min(1.5, sp / 6)); }
      else if (sp > 0.6) play('glide');
      else play('idle');
    }
    a.mixer.update(dt);
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
    this.puck = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 12), this.puckMat);
    this.puckGlow = new THREE.Mesh(new THREE.CircleGeometry(0.56, 20), new THREE.MeshBasicMaterial({ color: 0xe5482d, depthWrite: false }));
    this.puckGlow.rotation.x = -Math.PI / 2;
    this.scene.add(this.puck, this.puckGlow);
    for (let i = 0; i < 4; i++) {
      const gp = new THREE.Mesh(this.puck.geometry, new THREE.MeshBasicMaterial({ color: 0x575266 }));
      gp.visible = false; this.scene.add(gp); this.ghosts.push(gp);
    }
    // particles
    this.parts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 400);
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < 400; i++) { this.parts.setColorAt(i, c); this.pcol.push(new THREE.Color()); }
    this.parts.count = 0; this.parts.frustumCulled = false;
    this.scene.add(this.parts);
  }

  setTeams(home: TeamDef, away: TeamDef, gemColors: number[]) {
    this.teamMat[0].body.color.setHex(home.color); this.teamMat[0].trim.color.setHex(home.trim);
    this.teamMat[1].body.color.setHex(away.color); this.teamMat[1].trim.color.setHex(away.trim);
    this.teamHex = [[home.color, home.trim], [away.color, away.trim]];
    this.tintPlayers();
    this.helmetMat.forEach((m, t) => m.color.setHex(this.teamHex[t][1]).lerp(new THREE.Color(0x8a8f99), 0.25));
    this.gems.forEach((g, i) => {
      g.visible = i < gemColors.length;
      if (g.visible) (g.material as THREE.MeshBasicMaterial).color.setHex(gemColors[i]);
    });
    for (const d of this.decals) d.visible = false;
    this.pn = 0; this.lightK = 1; this.bulge = [0, 0]; this.lampT = [0, 0];
  }

  // ------------------------------------------------------------ effects
  burst(x: number, y: number, n: number, color: number, speed: number, up = 4, size = 0.14, h = 0.3) {
    for (let i = 0; i < n && this.pn < 400; i++) {
      const o = this.pn * 8, a = Math.random() * 6.283, s = speed * (0.3 + Math.random() * 0.7);
      this.pp[o] = x; this.pp[o + 1] = h; this.pp[o + 2] = y;
      this.pp[o + 3] = Math.cos(a) * s; this.pp[o + 4] = up * (0.4 + Math.random()); this.pp[o + 5] = Math.sin(a) * s;
      this.pp[o + 6] = 0.35 + Math.random() * 0.5; this.pp[o + 7] = size * (0.6 + Math.random() * 0.8);
      this.pcol[this.pn].setHex(color);
      this.pn++;
    }
  }

  /** directional ice spray along a hit */
  spray(x: number, y: number, dx: number, dy: number, n: number, color: number, speed: number) {
    for (let i = 0; i < n && this.pn < 400; i++) {
      const o = this.pn * 8, a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.1, s = speed * (0.35 + Math.random() * 0.65);
      this.pp[o] = x; this.pp[o + 1] = 0.4; this.pp[o + 2] = y;
      this.pp[o + 3] = Math.cos(a) * s; this.pp[o + 4] = 2 + Math.random() * 5; this.pp[o + 5] = Math.sin(a) * s;
      this.pp[o + 6] = 0.4 + Math.random() * 0.5; this.pp[o + 7] = 0.1 + Math.random() * 0.14;
      this.pcol[this.pn].setHex(color);
      this.pn++;
    }
  }

  private scuff(x: number, y: number, r: number) {
    const d = this.decals[this.decalI++ % this.decals.length];
    d.visible = true; d.position.x = x; d.position.z = y; d.scale.set(r * (0.8 + Math.random() * 0.6), r, 1);
    d.rotation.z = Math.random() * 3; (d.material as THREE.MeshBasicMaterial).opacity = 0.16;
  }

  handle(e: Ev) {
    const x = e.x ?? 0, y = e.y ?? 0;
    switch (e.t) {
      case 'hit': {
        const dx = e.dx ?? 0, dy = e.dy ?? 0;
        this.burst(x, y, e.big ? 44 : 20, 0xffffff, e.big ? 12 : 7, 6, e.big ? 0.22 : 0.16);
        this.spray(x, y, dx, dy, e.big ? 40 : 16, 0xdff2ff, e.big ? 20 : 12);
        this.scuff(x, y, e.big ? 1.0 : 0.6);
        this.powT = e.big ? 0.3 : 0.2; this.powS = e.big ? 3.2 : 1.8;
        this.pow.position.set(x, 0.05, y);
        this.punch = Math.max(this.punch, e.big ? 1 : 0.4);
        this.kickX += dx * (e.big ? 1.6 : 0.6); this.kickZ += dy * (e.big ? 1.6 : 0.6);
        if (e.big) this.cheer = Math.max(this.cheer, 0.9);
        break;
      }
      case 'bump': this.burst(x, y, e.big ? 12 : 5, 0xffffff, e.big ? 6 : 3.5, 2, 0.1); break;
      case 'slam': this.burst(x, y, 14, 0xffffff, 6, 5, 0.14); this.kickX += Math.sign(x) * 0.3; break;
      case 'shake': this.shake = Math.max(this.shake, e.n ?? 0.3); break;
      case 'shot': this.burst(x, y, e.big ? 12 : 6, 0xdff2ff, 5, 3, 0.1); break;
      case 'save': this.burst(x, y, 14, 0x9fd0ff, 7, 4, 0.12); break;
      case 'post': this.burst(x, y, 10, 0xff5555, 6, 5, 0.1); break;
      case 'poke': this.burst(x, y, 6, 0xffffff, 4, 2, 0.09); break;
      case 'lunge': this.burst(x, y, 7, 0xe8f4ff, 4, 2, 0.1, 0.1); break;
      case 'poof': this.burst(x, y, 8, 0x9a6dff, 4, 3, 0.1); break;
      case 'crowd': this.burst(x, y, 24, 0xffb400, 6, 8, 0.2, 2); this.cheer = Math.max(this.cheer, 0.8); break;
      case 'shock': this.shockT = 0.4; this.shockR = e.n ?? 3; this.shockMesh.position.set(x, 0.06, y); break;
      case 'fire': this.burst(x, y, 40, 0xff7a1e, 10, 8, 0.2); this.cheer = 1.2; break;
      case 'goal': {
        const i = e.team === 0 ? 1 : 0;
        this.bulge[i] = 1; this.lampT[i] = 2.2; this.cheer = 2;
        const cols = [0xffb400, 0xffffff, 0x1e90ff, 0xff3d6e];
        for (const c of cols) this.burst(x, y, 22, c, 11, 9, 0.18, 0.8);
        this.shake = Math.max(this.shake, 0.45);
        break;
      }
    }
  }

  project(x: number, h: number, y: number): [number, number] {
    this.v3.set(x, h, y).project(this.camera);
    return [(this.v3.x * 0.5 + 0.5) * window.innerWidth, (-this.v3.y * 0.5 + 0.5) * window.innerHeight];
  }

  // ------------------------------------------------------------ frame
  frame(g: Game, dt: number, rdt: number) {
    this.t += rdt;
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
        this.animate(v, s, p.owner === s, p.kind === 'shot' && p.shooter === s && p.age < 0.25, dt);
      } else v.body.rotation.z = s.checkT > 0 ? -0.55 : s.wind >= 0 && p.owner === s ? 0.18 : -0.08 - Math.min(0.2, Math.hypot(s.vx, s.vy) * 0.02);
      v.root.scale.setScalar(boxed ? 0.6 : 1);
    }
    g.goalies.forEach((k, gi) => {
      const v = this.skaters[g.skaters.length + gi];
      if (!v) return;
      v.root.visible = v.shadow.visible = true;
      v.root.position.set(k.x, 0, k.y); v.shadow.position.x = k.x; v.shadow.position.z = k.y; v.shadow.rotation.z = -Math.PI / 2;
      // crouched, facing up the ice, leaning into the slide
      v.body.rotation.set(0, k.team === 0 ? 0 : -Math.PI, v.anim ? 0 : -0.3);
      if (v.anim) this.animate(v, null, false, false, dt);
      v.body.position.y = 0; v.root.scale.setScalar(1.12);
      // the box goalie leaned into the slide; tipping the real model would push a skate and the stick into the ice
      v.root.rotation.x = v.anim ? 0 : Math.max(-0.25, Math.min(0.25, k.vy * 0.04)) * (k.team === 0 ? 1 : -1);
    });
    // human markers
    const h = g.ctrl;
    this.disc.position.x = h.x; this.disc.position.z = h.y; this.disc.visible = h.out <= 0;
    this.discMat.opacity = 0.6 + 0.4 * h.stamina;
    const ps = (h.frost ? 0.8 : 1) * (1 + Math.sin(this.t * 5) * 0.06);
    // the blue disc shrinks inside its ink ring as stamina runs down
    this.disc.scale.setScalar(ps * (0.55 + 0.45 * h.stamina)); this.discInk.scale.setScalar(ps);
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
    this.puck.position.set(p.x, 0.09 + dropH + lift, p.y);
    this.puckGlow.position.set(p.x, 0.03, p.y);
    const fire = g.fireT > 0 && (p.owner ? p.owner.team === 0 : p.lastTeam === 0);
    this.puckGlow.scale.setScalar(fire ? 1.5 + Math.sin(this.t * 20) * 0.2 : 1);
    if (fire && dt > 0) this.burst(p.x, p.y, 2, Math.random() < 0.5 ? 0xe5482d : 0xf7eed8, 1.5, 3, 0.18, 0.15);
    else if (!p.owner && Math.hypot(p.vx, p.vy) > 18 && dt > 0) this.burst(p.x, p.y, 1, 0xcfe6ff, 0.6, 0.6, 0.09, 0.1);
    for (let i = 0; i < this.ghosts.length; i++) {
      const gp = g.pucks[i + 1], m = this.ghosts[i];
      m.visible = !!gp && gp.alive;
      if (m.visible) m.position.set(gp.x, 0.09, gp.y);
    }

    // particles
    const P = this.pp;
    for (let i = 0; i < this.pn;) {
      const o = i * 8;
      P[o + 6] -= dt;
      if (P[o + 6] <= 0) {
        this.pn--;
        const l = this.pn * 8;
        for (let k = 0; k < 8; k++) P[o + k] = P[l + k];
        this.pcol[i].copy(this.pcol[this.pn]);
        continue;
      }
      P[o + 4] -= 18 * dt;
      P[o] += P[o + 3] * dt; P[o + 1] += P[o + 4] * dt; P[o + 2] += P[o + 5] * dt;
      if (P[o + 1] < 0.05) { P[o + 1] = 0.05; P[o + 4] *= -0.3; P[o + 3] *= 0.7; P[o + 5] *= 0.7; }
      const sc = P[o + 7] * Math.min(1, P[o + 6] * 4);
      this.dummy.position.set(P[o], P[o + 1], P[o + 2]); this.dummy.rotation.set(i, i * 2, 0); this.dummy.scale.setScalar(sc);
      this.dummy.updateMatrix(); this.parts.setMatrixAt(i, this.dummy.matrix); this.parts.setColorAt(i, this.pcol[i]);
      i++;
    }
    this.parts.count = this.pn;
    this.parts.instanceMatrix.needsUpdate = true;
    if (this.parts.instanceColor) this.parts.instanceColor.needsUpdate = true;

    // nets and lamps
    for (let i = 0; i < 2; i++) {
      this.bulge[i] = Math.max(0, this.bulge[i] - rdt * 3);
      this.nets[i].scale.x = (i === 0 ? -1 : 1) * (1 + this.bulge[i] * 0.45);
      this.lampT[i] = Math.max(0, this.lampT[i] - rdt);
      this.lamps[i].color.setHex(this.lampT[i] > 0 && Math.sin(this.t * 30) > 0 ? 0xff2222 : 0x551111);
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
    this.punch = Math.max(0, this.punch - rdt * 4);
    const kd = Math.exp(-rdt * 9); this.kickX *= kd; this.kickZ *= kd;
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
    const want = (CAM_DIST + Math.max(0, Math.min(10, sep - 16)) * 0.3) * (aspect < 1.6 ? (1.6 / aspect) ** 0.5 : 1);
    this.camD += (want - this.camD) * Math.min(1, rdt * 2.5);
    const dist = this.camD;
    const focus = live ? p.x * 0.8 + h.x * 0.2 : 0;
    // low limit keeps our own net above the scorebug when defending
    this.camX += (Math.max(-L + 9, Math.min(L - 12, focus + CAM_LEAD)) - this.camX) * Math.min(1, rdt * 3.5);
    const fz = live ? Math.max(-6, Math.min(6, (p.y * 0.8 + h.y * 0.2) * 0.45)) : 0;
    this.camZ += (fz - this.camZ) * Math.min(1, rdt * 3);
    this.shake = Math.max(0, this.shake - rdt * 3);
    const sx = (Math.random() - 0.5) * this.shake * 1.3 + this.kickX, sz = (Math.random() - 0.5) * this.shake * 1.3 + this.kickZ;
    const pd = dist * (1 - 0.07 * this.punch);
    const tx = this.camX + sx, tz = this.camZ + sz;
    this.camera.position.set(tx - Math.cos(CAM_EL) * pd, Math.sin(CAM_EL) * pd, tz);
    this.camera.lookAt(tx, 0, tz);
    this.renderer.render(this.scene, this.camera);
  }
}
