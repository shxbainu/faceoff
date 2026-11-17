// Predictive follow camera for the rink view.
//
// Broadcast auto-cameras pan to where play is going, not where it was. This follows a target point (the puck,
// pulled slightly toward your skater) with:
//   - a critically damped spring (fast, no overshoot, no wobble) with velocity feed-forward: a plain spring chasing
//     a moving point trails it by 2v/w (about 3 units in a rush); feeding the target's velocity in removes that lag
//   - a look-ahead offset along the target's velocity (lead = velocity x LEAD_T, capped), itself on a softer
//     spring so a pass that changes direction swings the view smoothly instead of snapping
//   - a zoom that pulls back a little as play gets fast, so a rush keeps the ice ahead in view
// Pure maths, no Three.js: the renderer turns (x, z, dist) into a camera pose.

export interface CamTarget {
  x: number; z: number;     // point to follow (world x up-ice, z across)
  vx: number; vz: number;   // its velocity (also fed forward into the follow spring)
  extraDist: number;        // zoom out on top of the speed zoom (e.g. puck far from your skater)
  minX: number; maxX: number; minZ: number; maxZ: number;   // where the view centre may go
  lead: boolean;            // false: no look-ahead (faceoffs, test rink)
}

export const CAM = {
  omega: 7.5,        // follow spring (rad/s): about 0.4 s to settle on a new point
  leadOmega: 3.5,    // look-ahead spring: slower, so the lead eases in and out
  leadT: 0.45,       // seconds of travel to look ahead
  leadMaxX: 8, leadMaxZ: 4.5,
  zoomOmega: 2.5,
  zoomPerSpeed: 0.2, zoomFrom: 8, zoomMax: 4,   // +0.2 distance per unit of speed above 8, up to +4
};

export class FollowCam {
  x = 0; z = 0; vx = 0; vz = 0;    // view centre and its velocity
  lx = 0; lz = 0; lvx = 0; lvz = 0; // look-ahead offset and its velocity
  dist: number; dv = 0;
  /** last frame's numbers, for diagnostics */
  last = { leadX: 0, leadZ: 0, errX: 0, errZ: 0, speed: 0 };
  constructor(public base: number) { this.dist = base; }

  /** critically damped spring step with velocity feed-forward:
   *  x'' = w^2 (target - x) + 2 w (targetVel - x'), integrated in small substeps. With targetVel = 0 it is a
   *  plain critically damped spring; with the target's real velocity it tracks steady motion with no lag. */
  private static spring(x: number, v: number, target: number, w: number, dt: number, tv = 0): [number, number] {
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) { v += (w * w * (target - x) + 2 * w * (tv - v)) * h; x += v * h; }
    return [x, v];
  }

  update(dt: number, t: CamTarget, aspectK: number) {
    if (dt <= 0) return this;
    const speed = Math.hypot(t.vx, t.vz);
    const wantLX = t.lead ? Math.max(-CAM.leadMaxX, Math.min(CAM.leadMaxX, t.vx * CAM.leadT)) : 0;
    const wantLZ = t.lead ? Math.max(-CAM.leadMaxZ, Math.min(CAM.leadMaxZ, t.vz * CAM.leadT * 0.6)) : 0;
    [this.lx, this.lvx] = FollowCam.spring(this.lx, this.lvx, wantLX, CAM.leadOmega, dt);
    [this.lz, this.lvz] = FollowCam.spring(this.lz, this.lvz, wantLZ, CAM.leadOmega, dt);
    const tx = Math.max(t.minX, Math.min(t.maxX, t.x + this.lx));
    const tz = Math.max(t.minZ, Math.min(t.maxZ, t.z + this.lz));
    // feed-forward stops at the view limits, so the camera eases into a boundary instead of pushing against it
    const fx = tx > t.minX && tx < t.maxX ? t.vx : 0, fz = tz > t.minZ && tz < t.maxZ ? t.vz : 0;
    [this.x, this.vx] = FollowCam.spring(this.x, this.vx, tx, CAM.omega, dt, fx);
    [this.z, this.vz] = FollowCam.spring(this.z, this.vz, tz, CAM.omega, dt, fz);
    const wantD = (this.base + t.extraDist + Math.max(0, Math.min(CAM.zoomMax, (speed - CAM.zoomFrom) * CAM.zoomPerSpeed))) * aspectK;
    [this.dist, this.dv] = FollowCam.spring(this.dist, this.dv, wantD, CAM.zoomOmega, dt);
    this.last = { leadX: this.lx, leadZ: this.lz, errX: tx - this.x, errZ: tz - this.z, speed };
    return this;
  }
}
