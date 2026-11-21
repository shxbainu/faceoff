// Powered ragdolls, display only (PHYSICS_PLAN.md step 4, revised). Each skater is a chain of Rapier bodies joined at
// the joints; every substep each body's velocity is set to carry it toward its animated pose (the existing clip,
// gait, look, stick IK and grip layers are the target), so contacts with other skaters and sticks push it off the
// pose and the drive pulls it back. The stick is a body joined to both palms. The gameplay sim never reads any of it.
import type RAPIERType from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';

let R: typeof RAPIERType;
export async function initBodies() { R = (await import('@dimforge/rapier3d-compat')).default; await R.init(); }

/** tuning: drive (share of the gap to the target closed per substep, 0..1), substep, solver iterations, radii as a
 *  share of the pelvis-to-neck length, how far a body may be from its target before it is put back (m) */
export const BODY = { echo: false, joints: true, contacts: true, drive: 0.55, step: 1 / 120, iters: 8, snap: 0.6, partSnap: 2, bladeCap: 0.05,
  r: { pelvis: 0.3, spine: 0.3, neck: 0.12, head: 0.26, clav: 0.09, upper: 0.12, lower: 0.1, hand: 0.11, thigh: 0.16, calf: 0.12, foot: 0.1, shaft: 0.035 } };

// [bone, parent part (index into this list), bone the capsule runs to, radius key]
const PARTS: [string, number, string | null, keyof typeof BODY.r][] = [
  ['pelvis', -1, 'spine_01', 'pelvis'], ['spine_01', 0, 'spine_02', 'spine'], ['spine_02', 1, 'spine_03', 'spine'], ['spine_03', 2, 'neck_01', 'spine'],
  ['neck_01', 3, 'Head', 'neck'],
  ['clavicle_l', 3, 'upperarm_l', 'clav'], ['upperarm_l', 5, 'lowerarm_l', 'upper'], ['lowerarm_l', 6, 'hand_l', 'lower'], ['hand_l', 7, 'middle_01_l', 'hand'],
  ['clavicle_r', 3, 'upperarm_r', 'clav'], ['upperarm_r', 9, 'lowerarm_r', 'upper'], ['lowerarm_r', 10, 'hand_r', 'lower'], ['hand_r', 11, 'middle_01_r', 'hand'],
  ['thigh_l', 0, 'calf_l', 'thigh'], ['calf_l', 13, 'foot_l', 'calf'], ['foot_l', 14, 'ball_l', 'foot'],
  ['thigh_r', 0, 'calf_r', 'thigh'], ['calf_r', 16, 'foot_r', 'calf'], ['foot_r', 17, 'ball_r', 'foot'],
];
const HAND_L = 8, HAND_R = 12;

export type Tgt = { p: THREE.Vector3; q: THREE.Quaternion; pp: THREE.Vector3; pq: THREE.Quaternion; has: boolean };
export type Part = { bone: THREE.Object3D; body: RAPIERType.RigidBody; t: Tgt; prevErr: number; anim?: THREE.Quaternion; animP?: THREE.Vector3 };
export type StickSpec = { obj: THREE.Object3D; blade: THREE.Vector3; gripB: THREE.Vector3; gripT: THREE.Vector3 };   // stick-local points
export type Rig = { id: number; parts: Part[]; stick?: { spec: StickSpec; body: RAPIERType.RigidBody; t: Tgt; scale: THREE.Vector3 };
  jump?: boolean; joints: { a: RAPIERType.RigidBody; b: RAPIERType.RigidBody; la: THREE.Vector3; lb: THREE.Vector3; ta: Tgt; tb: Tgt; name: string }[]; down: boolean; stickAnim?: THREE.Matrix4 };

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q2 = new THREE.Quaternion();
const world3 = (o: THREE.Object3D, p: THREE.Vector3, q: THREE.Quaternion, s = _s) => { o.updateWorldMatrix(true, false); o.matrixWorld.decompose(p, q, s); };
// a skater's own parts and stick never push each other (joints and the drive keep them apart); other skaters' do.
// One collision-group bit per rig (at most 16 rigs; a match has 12): member of its own bit, colliding with all others.
const groups = (id: number) => BODY.contacts ? ((1 << (id & 15)) << 16) | (0xffff & ~(1 << (id & 15))) : ((1 << (id & 15)) << 16);
const tgt = (): Tgt => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), pp: new THREE.Vector3(), pq: new THREE.Quaternion(), has: false });

/** spike stats (reset by `stats(true)`): cost per frame, drift from the target, joint gaps, error jumps, speeds */
export type BodyStats = { bad: string[]; tgap: Record<string, number>; frames: number; ms: number[]; ang: number[]; pos: number[]; gap: number; jumps: number; fast: number; nan: number; blade: number[] };

export class BodyWorld {
  world: RAPIERType.World; rigs = new Map<number, Rig>(); owner = new Map<number, number>(); stat: BodyStats | null = null;
  constructor() {
    this.world = new R.World({ x: 0, y: 0, z: 0 });   // the drive carries the bodies: no gravity sag off the pose
    this.world.timestep = BODY.step; this.world.numSolverIterations = BODY.iters;
  }
  /** read the target pose of a rig (bones as the layers left them, and the stick) */
  capture(id: number, bones: (n: string) => THREE.Object3D | undefined, stick?: StickSpec, held = true) {
    let rig = this.rigs.get(id);
    if (!rig) { if (stick && !held) return; rig = this.build(id, bones, stick); if (!rig) return; }   // build only on a pose with both palms on their grips
    for (const pt of rig.parts) this.setTgt(pt.t, pt.bone);
    if (rig.parts[0].t.p.distanceTo(rig.parts[0].t.pp) < 1e-9 && this.lastP(rig).distanceTo(rig.parts[0].t.p) > BODY.snap) rig.jump = true;   // the whole rig moves at once
    if (rig.stick) {
      // a stick not in his hands (dropped, knocked loose): its body and its two joints sit out; back in his hands it
      // starts again from the pose the grip rig gives (palms on the grips, which is what the joints hold)
      const st = rig.stick, on = st.body.isEnabled();
      if (held !== on) st.body.setEnabled(held);
      this.setTgt(st.t, st.spec.obj, st.scale);
      if (held && !on) { st.t.pp.copy(st.t.p); st.t.pq.copy(st.t.q); st.body.setTranslation(st.t.p, true); st.body.setRotation(st.t.q, true); st.body.setLinvel({ x: 0, y: 0, z: 0 }, true); st.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
    }
  }
  private lastP(rig: Rig) { const x = rig.parts[0].body.translation(); return _p.set(x.x, x.y, x.z); }
  private setTgt(t: Tgt, o: THREE.Object3D, s = _s) {
    if (t.has) { t.pp.copy(t.p); t.pq.copy(t.q); }
    world3(o, t.p, t.q, s);
    // first sight, or a jump (faceoff reset, out of the box): no motion to carry over, the drive puts the body there
    if (!t.has || t.p.distanceTo(t.pp) > BODY.snap) { t.pp.copy(t.p); t.pq.copy(t.q); t.has = true; }
  }

  private build(id: number, bones: (n: string) => THREE.Object3D | undefined, stick?: StickSpec): Rig | undefined {
    const objs = PARTS.map(([n]) => bones(n)); if (objs.some(o => !o)) return;
    const pel = new THREE.Vector3(), nk = new THREE.Vector3(); world3(objs[0]!, pel, _q); world3(objs[4]!, nk, _q);
    const S = pel.distanceTo(nk), rig: Rig = { id, parts: [], joints: [], down: false };
    PARTS.forEach(([, par, to, rk], i) => {
      const o = objs[i]!, t = tgt(); world3(o, t.p, t.q); t.pp.copy(t.p); t.pq.copy(t.q); t.has = true;
      const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(t.p.x, t.p.y, t.p.z).setRotation(t.q).setGravityScale(0).setCanSleep(false).setAngularDamping(2));
      const r = BODY.r[rk] * S, end = to ? bones(to) : undefined;
      // capsule from the bone's origin to the next bone's, in the body's frame (the bone's world frame, no scale)
      const e = _a.copy(t.p); if (end) world3(end, e, _q2);
      const loc = _b.copy(e).sub(t.p).applyQuaternion(_q.copy(t.q).invert()), len = loc.length();
      let cd: RAPIERType.ColliderDesc;
      if (rk === 'head') cd = R.ColliderDesc.ball(r);
      else if (len < 1e-3 || rk === 'hand') cd = R.ColliderDesc.ball(r).setTranslation(loc.x, loc.y, loc.z);
      else { const mid = loc.clone().multiplyScalar(0.5), qa = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), loc.clone().normalize());
        cd = R.ColliderDesc.capsule(Math.max(0.001, len / 2 - r * 0.5), r).setTranslation(mid.x, mid.y, mid.z).setRotation(qa); }
      const col = this.world.createCollider(cd.setDensity(1).setCollisionGroups(groups(id)).setFriction(0.4), body);
      this.owner.set(col.handle, id);
      if (rk === 'neck' && end) {   // the head: a ball over the skull, on the neck body
        const hp = new THREE.Vector3(), hq = new THREE.Quaternion(); world3(end, hp, hq);
        const c = hp.add(new THREE.Vector3(0, BODY.r.head * S * 0.5, 0).applyQuaternion(hq)).sub(t.p).applyQuaternion(_q.copy(t.q).invert());
        this.owner.set(this.world.createCollider(R.ColliderDesc.ball(BODY.r.head * S).setTranslation(c.x, c.y, c.z).setDensity(1).setCollisionGroups(groups(id)), body).handle, id);
      }
      rig.parts.push({ bone: o, body, t, prevErr: 0 });
      if (par >= 0) this.joint(rig, rig.parts[par], rig.parts[i], t.p);
    });
    if (stick) {
      const t = tgt(), scale = new THREE.Vector3(); world3(stick.obj, t.p, t.q, scale); t.pp.copy(t.p); t.pq.copy(t.q); t.has = true;
      const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(t.p.x, t.p.y, t.p.z).setRotation(t.q).setGravityScale(0).setCanSleep(false).setAngularDamping(2));
      const inv = _q.copy(t.q).invert(), toLoc = (v: THREE.Vector3) => v.clone().applyMatrix4(stick.obj.matrixWorld).sub(t.p).applyQuaternion(inv);
      const bl = toLoc(stick.blade), tp = toLoc(stick.gripT), ax = tp.clone().sub(bl), mid = bl.clone().add(tp).multiplyScalar(0.5), r = BODY.r.shaft * S;
      const qa = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), ax.clone().normalize());
      // the stick touches nothing: the sim's stick colliders decide every block, poke and tie (and the sim lets a stick lie
      // through other skaters' legs), so a stick pushed around here could only contradict a play
      this.owner.set(this.world.createCollider(R.ColliderDesc.capsule(ax.length() / 2, r).setTranslation(mid.x, mid.y, mid.z).setRotation(qa).setDensity(0.5).setCollisionGroups(0), body).handle, id);
      rig.stick = { spec: stick, body, t, scale };
      // the gloves hold it: a ball joint at each grip (the target pose has each palm exactly on its grip)
      for (const [hi, g] of [[HAND_R, stick.gripB], [HAND_L, stick.gripT]] as const) this.joint(rig, rig.parts[hi], { body, t } as Part, g.clone().applyMatrix4(stick.obj.matrixWorld));
    }
    this.rigs.set(id, rig); return rig;
  }
  private joint(rig: Rig, a: Part, b: Part, at: THREE.Vector3) {
    const la = at.clone().sub(a.t.p).applyQuaternion(a.t.q.clone().invert()), lb = at.clone().sub(b.t.p).applyQuaternion(b.t.q.clone().invert());
    if (BODY.joints) { const j = this.world.createImpulseJoint(R.JointData.spherical(la, lb), a.body, b.body, true); j.setContactsEnabled(false); }
    rig.joints.push({ a: a.body, b: b.body, la, lb, ta: a.t, tb: b.t, name: `${a.bone?.name}-${b.bone?.name ?? 'stick'}` });
  }

  /** drive every body toward its target for this frame's time, in fixed substeps */
  step(dt: number, drive: (id: number) => number) {
    const t0 = performance.now(), n = Math.max(1, Math.min(4, Math.round(dt / BODY.step)));
    for (let k = 0; k < n; k++) {
      const u = k / n;   // where the target is as this substep starts; the feed-forward velocity carries the body on with it
      for (const rig of this.rigs.values()) {
        if (rig.jump) {   // teleport every body (and the stick) together, so no joint is torn across the jump
          rig.jump = false;
          for (const b of [...rig.parts.map(p => [p.body, p.t] as const), ...(rig.stick ? [[rig.stick.body, rig.stick.t] as const] : [])]) {
            b[0].setTranslation(b[1].p, true); b[0].setRotation(b[1].q, true); b[0].setLinvel({ x: 0, y: 0, z: 0 }, true); b[0].setAngvel({ x: 0, y: 0, z: 0 }, true);
          }
        }
        const g = drive(rig.id);
        for (const pt of rig.parts) this.drive(pt.body, pt.t, u, g, dt);
        if (rig.stick?.body.isEnabled()) this.drive(rig.stick.body, rig.stick.t, u, g, dt);
      }
      this.world.step();
      for (const rig of this.rigs.values()) if (rig.stick?.body.isEnabled()) this.capBlade(rig.stick, u + 1 / n);
    }
    if (this.stat) this.stat.ms.push(performance.now() - t0);
  }
  private drive(b: RAPIERType.RigidBody, t: Tgt, u: number, g: number, dt: number) {
    const P = _a.copy(t.pp).lerp(t.p, u), Q = _q.copy(t.pq).slerp(t.q, u), h = BODY.step;
    const x = b.translation(), r = b.rotation();
    if (Math.hypot(P.x - x.x, P.y - x.y, P.z - x.z) > BODY.partSnap) {   // lost (should not happen): put it back
      b.setTranslation(P, true); b.setRotation(Q, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); return;
    }
    // feed-forward (how fast the target itself moves) plus a share of the gap closed this substep
    const e = _q2.set(r.x, r.y, r.z, r.w).invert().premultiply(Q); if (e.w < 0) e.set(-e.x, -e.y, -e.z, -e.w);
    const s = Math.sqrt(Math.max(0, 1 - e.w * e.w)), ang = 2 * Math.acos(Math.min(1, e.w)), k = s > 1e-6 ? ang / s * g / h : 0;
    const f = _q.copy(t.pq).invert().premultiply(t.q); if (f.w < 0) f.set(-f.x, -f.y, -f.z, -f.w);
    const fs = Math.sqrt(Math.max(0, 1 - f.w * f.w)), fk = fs > 1e-6 ? 2 * Math.acos(Math.min(1, f.w)) / fs / Math.max(dt, 1e-4) : 0;
    const w = { x: e.x * k + f.x * fk, y: e.y * k + f.y * fk, z: e.z * k + f.z * fk };
    b.setAngvel(w, true);
    // the bone's origin should move at ff + the gap share; Rapier's linvel is the centre of mass's, which the turn
    // also swings about the origin: v_com = v_origin + w x (com - origin)
    const ff = _b.copy(t.p).sub(t.pp).divideScalar(Math.max(dt, 1e-4)), c = b.worldCom(), cx = c.x - x.x, cy = c.y - x.y, cz = c.z - x.z;
    b.setLinvel({ x: ff.x + (P.x - x.x) * g / h + w.y * cz - w.z * cy, y: ff.y + (P.y - x.y) * g / h + w.z * cx - w.x * cz, z: ff.z + (P.z - x.z) * g / h + w.x * cy - w.y * cx }, true);
  }

  /** The sim's stick decides every play; the drawn one may be pushed off it by contacts only BODY.bladeCap at the blade.
   *  Past that the stick body is moved back (and its velocity relative to the target dropped), so a drawn stick never
   *  sits somewhere the sim's isn't: it can't look like it blocked a pass the sim let through. */
  private capBlade(st: NonNullable<Rig['stick']>, u: number) {
    const b = st.body, x = b.translation(), r = b.rotation();
    const P = _p.copy(st.t.pp).lerp(st.t.p, Math.min(1, u)), Q = _q.copy(st.t.pq).slerp(st.t.q, Math.min(1, u));
    const local = _a.copy(st.spec.blade).multiply(st.scale);   // blade in the stick's frame (scale baked, no rotation)
    const want = local.clone().applyQuaternion(Q).add(P), got = local.applyQuaternion(_q2.set(r.x, r.y, r.z, r.w)).add(_b.set(x.x, x.y, x.z));
    const off = got.sub(want), d = off.length(); if (d <= BODY.bladeCap) return;
    const fix = off.multiplyScalar((d - BODY.bladeCap) / d);
    b.setTranslation({ x: x.x - fix.x, y: x.y - fix.y, z: x.z - fix.z }, true);
  }
  /** write the bodies back onto the bones (parent first) and the stick; returns false if the rig isn't built */
  apply(id: number, measure: boolean) {
    const rig = this.rigs.get(id); if (!rig) return false;
    const S = this.stat;
    for (const pt of rig.parts) {
      const b = pt.body, x = BODY.echo ? pt.t.p : b.translation(), r = BODY.echo ? pt.t.q : b.rotation(), par = pt.bone.parent!;
      if (!Number.isFinite(x.x + x.y + x.z + r.x + r.y + r.z + r.w)) { if (S && measure) S.nan++; continue; }
      (pt.anim ??= new THREE.Quaternion()).copy(pt.bone.quaternion); (pt.animP ??= new THREE.Vector3()).copy(pt.bone.position);   // the layers' pose, put back next frame (restore)
      par.updateWorldMatrix(true, false); par.matrixWorld.decompose(_p, _q, _s);
      const l = _q.invert().multiply(_q2.set(r.x, r.y, r.z, r.w));
      if (_s.x * _s.y * _s.z < 0) l.set(l.x, -l.y, -l.z, l.w);   // mirrored (left shot): a reflection flips the turn
      pt.bone.quaternion.copy(l);
      if (pt === rig.parts[0]) pt.bone.position.copy(par.worldToLocal(_a.set(x.x, x.y, x.z)));
      if (S && measure) {
        const err = _q2.set(r.x, r.y, r.z, r.w).angleTo(pt.t.q) * 180 / Math.PI; S.ang.push(err);
        if (Math.abs(err - pt.prevErr) > 20) S.jumps++; pt.prevErr = err;
        const v = b.linvel(); if (Math.hypot(v.x, v.y, v.z) > 30) S.fast++;
        { const d = Math.hypot(x.x - pt.t.p.x, x.y - pt.t.p.y, x.z - pt.t.p.z); if (d > 0.2 && S.bad.length < 40) S.bad.push(`${rig.id} ${pt.bone.name} ${d.toFixed(2)} jumpT ${pt.t.p.distanceTo(pt.t.pp).toFixed(2)} ${(globalThis as { __ctx?: (i: number) => string }).__ctx?.(rig.id) ?? ''}`); }
        if (pt === rig.parts[0] || pt === rig.parts[HAND_L] || pt === rig.parts[HAND_R]) S.pos.push(Math.hypot(x.x - pt.t.p.x, x.y - pt.t.p.y, x.z - pt.t.p.z));
      }
    }
    if (rig.stick?.body.isEnabled()) {
      (rig.stickAnim ??= new THREE.Matrix4()).compose(rig.stick.spec.obj.position, rig.stick.spec.obj.quaternion, rig.stick.spec.obj.scale);
      const st = rig.stick, x = BODY.echo ? st.t.p : st.body.translation(), r = BODY.echo ? st.t.q : st.body.rotation(), o = st.spec.obj;
      if (Number.isFinite(x.x + r.w)) {
        _m.compose(_a.set(x.x, x.y, x.z), _q2.set(r.x, r.y, r.z, r.w), st.scale);
        if (S && measure) {   // drawn blade against where the layers (the sim's stick) put it
          const want = st.spec.blade.clone().applyMatrix4(_inv.compose(st.t.p, st.t.q, st.scale)), got = st.spec.blade.clone().applyMatrix4(_m);
          S.blade.push(want.distanceTo(got));
        }
        o.parent!.updateWorldMatrix(true, false);
        _m.premultiply(_inv.copy(o.parent!.matrixWorld).invert());
        _m.decompose(o.position, o.quaternion, o.scale); o.updateMatrixWorld(true);
      }
    }
    if (S && measure) for (const j of rig.joints) {
      if (!j.a.isEnabled() || !j.b.isEnabled()) continue;
      { const wa = _a.copy(j.la).applyQuaternion(j.ta.q).add(j.ta.p), wb = _b.copy(j.lb).applyQuaternion(j.tb.q).add(j.tb.p); if (wa.distanceTo(wb) > 0.01) { const k = `${rig.id}:${j.name}`; S.tgap[k] = (S.tgap[k] ?? 0) + 1; } }
      const pa = j.a.translation(), qa = j.a.rotation(), pb = j.b.translation(), qb = j.b.rotation();
      const wa = _a.copy(j.la).applyQuaternion(_q.set(qa.x, qa.y, qa.z, qa.w)).add(_p.set(pa.x, pa.y, pa.z)), wb = _b.copy(j.lb).applyQuaternion(_q2.set(qb.x, qb.y, qb.z, qb.w)).add(_s.set(pb.x, pb.y, pb.z));
      S.gap = Math.max(S.gap, wa.distanceTo(wb));
    }
    return true;
  }
  /** before the next frame's layers: the bones (and stick) go back to the pose the layers made, so the physics
   *  result never feeds into the next target (the mixer leaves bones whose clip value didn't change as they are) */
  restore(id: number) {
    const rig = this.rigs.get(id); if (!rig) return;
    for (const pt of rig.parts) { if (pt.anim) pt.bone.quaternion.copy(pt.anim); if (pt.animP) pt.bone.position.copy(pt.animP); }
    if (rig.stickAnim) { const o = rig.stick!.spec.obj; rig.stickAnim.decompose(o.position, o.quaternion, o.scale); rig.stickAnim = undefined; }
    for (const pt of rig.parts) { pt.anim = undefined; pt.animP = undefined; }
  }
  /** a hit: push the part nearest the contact (world point, impulse) */
  push(id: number, at: THREE.Vector3, imp: THREE.Vector3) {
    const rig = this.rigs.get(id); if (!rig) return;
    let best = rig.parts[0], bd = Infinity;
    for (const pt of rig.parts) { const x = pt.body.translation(), d = Math.hypot(x.x - at.x, x.y - at.y, x.z - at.z); if (d < bd) { bd = d; best = pt; } }
    best.body.applyImpulseAtPoint(imp, at, true);
  }
  stats(reset = false) { const s = this.stat; if (reset) this.stat = { bad: [], tgap: {}, frames: 0, ms: [], ang: [], pos: [], gap: 0, jumps: 0, fast: 0, nan: 0, blade: [] }; return s; }
}
