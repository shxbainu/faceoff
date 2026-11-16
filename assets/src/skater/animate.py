# Skater animation clips, keyed on one timeline. Run inside Blender after pose_ready.py and
# rig_controls.py. Every key starts from the ready pose and adds offsets, so clips stay consistent:
#   pelvis   - world shift (sway, bob) and turn
#   spine    - lean and twist (world axes, about each bone's head)
#   feet     - the foot targets: blades slide on the ice, lift on recovery, turn out on the push
#   stick    - turns about the point between the hands; the hands follow it through the arm IK
# The character faces -Y; his left is +X. Clip frame ranges are written to clips.json for the
# sprite renderer.
import bpy, math, json
from mathutils import Vector, Matrix, Quaternion

sc = bpy.context.scene; vl = bpy.context.view_layer
arm = bpy.data.objects['Armature']; P = arm.pose.bones; W = arm.matrix_world
ctl = bpy.data.objects['stick_ctl']; FT = {s: bpy.data.objects['foot_tgt_' + s] for s in 'lr'}
HT = {s: bpy.data.objects['hand_tgt_' + s] for s in 'lr'}
BODY = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'clavicle_r']

for o in (arm, ctl, *FT.values()):
    if o.animation_data: o.animation_data_clear()
vl.update()
READY = {n: (P[n].location.copy(), P[n].rotation_quaternion.copy()) for n in BODY}
READY_OBJ = {o.name: o.matrix_basis.copy() for o in (ctl, *FT.values())}

def reset():
    for n, (l, q) in READY.items(): P[n].location = l; P[n].rotation_quaternion = q
    for o in (ctl, *FT.values()): o.matrix_basis = READY_OBJ[o.name]
    vl.update()
def brot(name, axis, deg):
    pb = P[name]; M = pb.matrix.copy(); piv = M.translation.copy()
    pb.matrix = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-piv) @ M; vl.update()
def bmove(name, d):
    pb = P[name]; pb.matrix = Matrix.Translation(Vector(d)) @ pb.matrix; vl.update()
def foot(s, dx=0, dy=0, dz=0, yaw=0, roll=0):
    o = FT[s]; Mw = o.matrix_world.copy(); p = Mw.translation.copy()
    R = Matrix.Rotation(math.radians(yaw), 4, 'Z') @ Matrix.Rotation(math.radians(roll), 4, 'Y')
    o.matrix_world = Matrix.Translation(p + Vector((dx, dy, dz))) @ R @ Matrix.Translation(-p) @ Mw; vl.update()
def stick(rot=(), move=(0, 0, 0)):
    """rot: list of (world axis, degrees) about the point between the hands; move: world shift."""
    piv = (HT['l'].matrix_world.translation + HT['r'].matrix_world.translation) / 2
    Mw = ctl.matrix_world.copy()
    for ax, deg in rot:
        Mw = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(deg), 4, Vector(ax).normalized()) @ Matrix.Translation(-piv) @ Mw
    ctl.matrix_world = Matrix.Translation(Vector(move)) @ Mw; vl.update()

def key(f):
    for n in BODY:
        P[n].keyframe_insert('location', frame=f); P[n].keyframe_insert('rotation_quaternion', frame=f)
    for o in (ctl, *FT.values()):
        o.keyframe_insert('location', frame=f); o.keyframe_insert('rotation_euler', frame=f)
for o in (ctl, *FT.values()): o.rotation_mode = 'XYZ'
READY_OBJ = {o.name: o.matrix_basis.copy() for o in (ctl, *FT.values())}

CLIPS = {}
def clip(name, start, length, loop, poser, keys):
    for k in keys:
        reset(); poser(k / length if loop else k / length); key(start + k)
    CLIPS[name] = {'start': start, 'end': start + length - (1 if loop else 0), 'loop': loop}
    return start + length + 6

S = math.sin; C = math.cos; TAU = 2 * math.pi

# ---- idle: ready stance, breathing, stick blade tapping lightly ----
def idle(t):
    b = S(TAU * t)
    bmove('pelvis', (0, 0, -0.006 * (1 + b)))
    brot('spine_02', 'X', 1.0 * b)
    stick(rot=[((1, 0, 0), 1.5 * max(0, S(TAU * t)))])
f = clip('idle', 1, 32, True, idle, range(0, 33, 4))

# ---- stride: alternating side push, recovery under the body, weight over the gliding skate ----
def stride(t):
    for s, ph, sx in (('l', 0.0, 1), ('r', 0.5, -1)):
        u = (t + ph) % 1.0
        if u < 0.55:          # push: blade turned out, drives out to the side and back
            p = u / 0.55; e = 0.5 - 0.5 * C(math.pi * p)
            foot(s, dx=sx * (0.36 * e - 0.03), dy=0.22 * e - 0.05, yaw=sx * (10 + 25 * e), roll=-sx * 12 * e)
        else:                 # recovery: lift, swing back under the hips, set down pointing ahead
            p = (u - 0.55) / 0.45; e = 0.5 + 0.5 * C(math.pi * p)
            foot(s, dx=sx * (0.36 * e - 0.03), dy=0.22 * e - 0.05 - 0.04 * S(math.pi * p), dz=0.07 * S(math.pi * p), yaw=sx * 10 * (1 - p) + sx * 25 * e * (1 - p))
    sway = S(TAU * t)                    # weight over the gliding (non-pushing) leg
    bob = abs(C(TAU * t))                # lowest as each push finishes
    bmove('pelvis', (-0.09 * sway, 0, -0.025 - 0.03 * bob))
    brot('pelvis', 'Z', 9 * sway); brot('spine_02', 'Z', -13 * sway); brot('spine_01', 'X', 4 + 4 * bob)
    brot('spine_03', 'Y', 5 * sway)      # shoulders roll with each push
    brot('Head', 'Z', 6 * sway)
    stick(rot=[((0, 0, 1), -14 * sway), ((1, 0, 0), 3 * bob)], move=(-0.08 * sway, 0, 0))
f = clip('stride', f, 20, True, stride, range(0, 21, 2))

# ---- glide: both blades on the ice, low and quiet ----
def glide(t):
    for s, sx in (('l', 1), ('r', -1)): foot(s, dx=-sx * 0.03, yaw=-sx * 4)
    bmove('pelvis', (0, 0, -0.03 - 0.01 * (1 + S(TAU * t))))
    brot('spine_01', 'X', 3); brot('spine_02', 'Z', 4 * S(TAU * t))
    stick(rot=[((0, 0, 1), 8 * S(TAU * t))])   # stick sweeps the ice while coasting
f = clip('glide', f, 24, True, glide, range(0, 25, 6))

# Shots are keyed as stick poses: where the bottom hand is and which way the shaft points (top hand to
# blade), in the ready frame. The top hand and both arms follow through the IK.
reset(); G0 = ctl.matrix_world.translation.copy(); R0 = ctl.matrix_world.to_3x3(); D0 = R0.col[2].normalized()
def stick_pose(G, d, roll=0.0):
    d = Vector(d).normalized()
    R = Matrix.Rotation(math.radians(roll), 3, d) @ D0.rotation_difference(d).to_matrix() @ R0
    ctl.matrix_world = Matrix.Translation(Vector(G)) @ R.to_4x4(); vl.update()
def track(keys, t):
    """keys: [(t, G, d, roll)]; smooth blend between neighbouring keys."""
    for (t0, g0, d0, r0), (t1, g1, d1, r1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            u = (t - t0) / (t1 - t0) if t1 > t0 else 1.0; u = u * u * (3 - 2 * u)
            g = Vector(g0).lerp(Vector(g1), u); d = Vector(d0).normalized().slerp(Vector(d1).normalized(), u)
            return g, d, r0 + (r1 - r0) * u
    return Vector(keys[-1][1]), Vector(keys[-1][2]), keys[-1][3]
READY_STICK = (tuple(G0), tuple(D0), 0.0)

# ---- wrist shot: draw the puck back on the forehand, sweep it forward, roll the wrists, low follow-through ----
WRIST = [(0.0, *READY_STICK),
         (0.35, (-0.10, -0.26, 0.68), (-0.80, -0.12, -0.58), 0.0),
         (0.55, (-0.18, -0.48, 0.68), (-0.48, -0.68, -0.55), -15.0),
         (0.80, (-0.14, -0.60, 0.80), (-0.30, -0.88, -0.25), -35.0),
         (1.0, (-0.14, -0.58, 0.78), (-0.30, -0.88, -0.28), -35.0)]
def wrist(t):   # body first: the stick rides on the chest, so its world pose is set last
    draw = max(0.0, 1 - abs(t - 0.35) / 0.35); sweep = min(1.0, max(0.0, (t - 0.35) / 0.3))
    brot('spine_02', 'Z', -10 * draw + 12 * sweep); brot('pelvis', 'Z', -4 * draw + 6 * sweep)
    foot('l', dy=-0.05 * sweep); foot('r', dy=0.06 * draw)
    stick_pose(*track(WRIST, t))
f = clip('wrist_shot', f, 20, False, wrist, [0, 3, 7, 9, 11, 13, 16, 20])

# ---- slapshot: blade up behind the right shoulder, swing down into the ice, follow through toward the net ----
SLAP = [(0.0, *READY_STICK),
        (0.45, (-0.17, -0.06, 1.00), (-0.35, 0.55, 0.75), 0.0),
        (0.52, (-0.17, -0.08, 1.02), (-0.33, 0.58, 0.74), 0.0),
        (0.64, (-0.22, -0.42, 0.66), (-0.62, -0.55, -0.56), 0.0),
        (0.85, (-0.07, -0.58, 0.88), (-0.25, -0.85, 0.45), -20.0),
        (1.0, (-0.07, -0.56, 0.86), (-0.25, -0.85, 0.42), -20.0)]
def slap(t):
    w = max(0.0, 1 - abs(t - 0.5) / 0.5); s_ = min(1.0, max(0.0, (t - 0.52) / 0.12))
    brot('spine_02', 'Z', -22 * w + 16 * s_); brot('spine_01', 'X', -6 * w + 6 * s_)
    brot('pelvis', 'Z', -8 * w + 8 * s_)
    foot('r', dy=0.08 * w, yaw=-10 * w); foot('l', dy=-0.06 * s_, yaw=6 * s_)
    stick_pose(*track(SLAP, t))
f = clip('slapshot', f, 36, False, slap, [0, 6, 12, 16, 19, 21, 23, 26, 30, 36])

# ---- body check: sink, then drive the shoulder through; stick held across ----
def check(t):
    if t < 0.35: p = t / 0.35; sink, drive = 0.5 - 0.5 * C(math.pi * p), 0.0
    elif t < 0.6: p = (t - 0.35) / 0.25; sink, drive = 1 - p, p
    else: p = (t - 0.6) / 0.4; sink, drive = 0.0, 1 - p
    bmove('pelvis', (0.05 * drive, -0.12 * drive, -0.05 * sink))
    brot('spine_02', 'Z', 25 * drive - 8 * sink); brot('spine_01', 'X', 6 * sink - 4 * drive)
    brot('clavicle_l', 'X', -8 * drive)
    foot('l', dy=-0.15 * drive, yaw=8 * drive)
    stick(rot=[((0, 0, 1), 15 * drive)], move=(0.05 * drive, -0.1 * drive, 0.05 * drive))
f = clip('check', f, 20, False, check, [0, 4, 7, 10, 12, 16, 20])

reset()
sc.frame_start = 1; sc.frame_end = f
for o in (arm, ctl, *FT.values()):
    if o.animation_data and o.animation_data.action:
        for fc in getattr(o.animation_data.action, 'fcurves', []):
            for kp in fc.keyframe_points: kp.interpolation = 'BEZIER'
json.dump(CLIPS, open('/Users/brianyao/claude-web-game/assets/src/skater/clips.json', 'w'), indent=1)

# ---- checks: do the hands still reach the stick, do the blades stay on the ice ----
worst = {'hand_miss_cm': 0, 'blade_below_ice_cm': 0}
dg = bpy.context.evaluated_depsgraph_get()
for fr in range(1, f, 2):
    sc.frame_set(fr)
    for s in 'lr':
        miss = ((W @ P['lowerarm_' + s].tail) - HT[s].matrix_world.translation).length * 100
        worst['hand_miss_cm'] = max(worst['hand_miss_cm'], round(miss, 1))
sc.frame_set(1)
print('clips', CLIPS, 'worst', worst)
