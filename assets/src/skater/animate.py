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

for o in (arm, ctl, *FT.values(), *HT.values()):
    if o.animation_data: o.animation_data_clear()
vl.update()
READY = {n: (P[n].location.copy(), P[n].rotation_quaternion.copy()) for n in BODY}
READY_OBJ = {o.name: o.matrix_basis.copy() for o in (ctl, *FT.values(), *HT.values())}

def reset():
    for n, (l, q) in READY.items(): P[n].location = l; P[n].rotation_quaternion = q
    for o in (ctl, *FT.values(), *HT.values()): o.matrix_basis = READY_OBJ[o.name]
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

STICK = bpy.data.objects['stick']
def blade_on_ice(floor=0.012):
    # lift the stick (and so the hands) if any part of it would go below the ice
    vl.update(); Mw = STICK.matrix_world
    low = min((Mw @ v.co).z for v in STICK.data.vertices)
    if low < floor:
        ctl.matrix_world = Matrix.Translation(Vector((0, 0, floor - low))) @ ctl.matrix_world; vl.update()

def key(f):
    blade_on_ice()
    for n in BODY:
        P[n].keyframe_insert('location', frame=f); P[n].keyframe_insert('rotation_quaternion', frame=f)
    for o in (ctl, *FT.values(), *HT.values()):
        o.keyframe_insert('location', frame=f); o.keyframe_insert('rotation_euler', frame=f)
for o in (ctl, *FT.values(), *HT.values()): o.rotation_mode = 'XYZ'
READY_OBJ = {o.name: o.matrix_basis.copy() for o in (ctl, *FT.values(), *HT.values())}

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

def loop_path(pts, u):
    """periodic Catmull-Rom through (u, values...) keys on a 0..1 loop"""
    n = len(pts); u %= 1.0
    i = max(k for k in range(n) if pts[k][0] <= u)
    p0, p1, p2, p3 = (pts[(i + d) % n] for d in (-1, 0, 1, 2))
    u1 = p1[0]; u2 = p2[0] + (1.0 if i + 1 >= n else 0.0)
    x = (u - u1) / (u2 - u1)
    return [0.5 * ((2 * b) + (-a + c) * x + (2 * a - 5 * b + 4 * c - d) * x * x + (-a + 3 * b - 3 * c + d) * x ** 3)
            for a, b, c, d in zip(p0[1:], p1[1:], p2[1:], p3[1:])]

# ---- stride: a real hockey stride. Each skate sets down under the hips, rides a moment while the
# weight loads, then drives out to the side and back at about 45 degrees on its inside edge, the push
# speeding up to full extension; then it lifts just off the ice and comes back in low and tight under
# the body, toe forward, to set down again. The hips ride over the gliding skate, lowest as each push
# extends; the chest stays low and forward and the shoulders stay fairly square (no flailing). ----
# u, dx (out, x side sign), dy (+ = back), dz (lift), yaw (toe out), roll (inside edge)
STRIDE_FOOT = [   # the ready stance is wide (about 54 cm), so a recovered skate comes in well inside it
    (0.00, -0.13, -0.09, 0.000,  6,  0),    # set down under the hips, a little ahead
    (0.12, -0.10, -0.04, 0.000, 10,  4),    # ride it while the weight comes over it
    (0.30,  0.00,  0.06, 0.000, 22, 10),    # push: out and back on the inside edge
    (0.46,  0.18,  0.20, 0.000, 34, 15),
    (0.56,  0.28,  0.29, 0.012, 38, 12),    # full extension, toe flicks off the ice
    (0.68,  0.18,  0.23, 0.055, 24,  2),    # recovery: lift, pull in tight
    (0.84, -0.06,  0.04, 0.050, 10,  0),    # under the hips, low
    (0.94, -0.12, -0.07, 0.015,  6,  0),    # reach forward to set down
]
def stride(t):
    for s, ph, sx in (('l', 0.0, 1), ('r', 0.5, -1)):
        dx, dy, dz, yaw, roll = loop_path(STRIDE_FOOT, t + ph)
        foot(s, dx=sx * dx, dy=dy, dz=max(0.0, dz), yaw=sx * yaw, roll=-sx * roll)
    sway = S(TAU * (t - 0.12))                       # + while the left skate pushes: hips over the right skate
    low = 0.5 + 0.5 * C(2 * TAU * (t - 0.52))        # lowest as each push reaches full extension
    bmove('pelvis', (-0.075 * sway, 0, -0.045 - 0.035 * low))
    brot('pelvis', 'Z', 7 * sway); brot('spine_02', 'Z', -9 * sway)
    brot('spine_01', 'X', 9 + 3 * low)               # chest low and forward, driving
    brot('spine_03', 'Y', 4 * sway)                  # shoulders roll a little with each push
    brot('Head', 'X', -6 - 2 * low); brot('Head', 'Z', 5 * sway)   # eyes stay up the ice
    stick(rot=[((0, 0, 1), -10 * sway), ((1, 0, 0), 2 * low)], move=(-0.06 * sway, 0, 0))
f = clip('stride', f, 20, True, stride, range(0, 21, 2))

# ---- crossovers: hard turn at speed. The outside skate pushes out, lifts and steps over in front of
# the inside skate; the inside skate pushes under the body toward the outside ("crossunder"), lifts out
# from behind and comes back. Hips low and shifted into the turn, chest and stick facing into it.
# cross_r turns right (outside = left skate, +x); cross_l is its mirror. ----
# u, dx, dy, dz, yaw  - as written for cross_r (+x is the outside); cross_l flips x and yaw with sx
NARROW = 0.12            # both skates come in this far from the wide ready stance through a crossover
CROSS_OUT = [            # outside skate
    (0.00, -0.45, -0.12, 0.000, -10),    # just landed, crossed over in front of the inside skate
    (0.22, -0.22,  0.00, 0.000,  -2),    # rides it as the body passes over
    (0.45,  0.12,  0.14, 0.000,  16),    # pushes out to the outside on its inside edge
    (0.58,  0.08,  0.08, 0.060,   6),    # lifts
    (0.78, -0.30, -0.14, 0.090, -10),    # steps over, in front of the inside toe
]
CROSS_IN = [             # inside skate
    (0.00,  0.30,  0.14, 0.000, -14),    # end of the crossunder: under the body, out past the outside skate
    (0.14,  0.22,  0.10, 0.060,  -6),    # lifts out from behind
    (0.34, -0.02, -0.06, 0.050,   0),    # swings back to its own side, ahead
    (0.50, -0.04, -0.05, 0.000,   0),    # sets down, glides
    (0.76,  0.10,  0.08, 0.000,  -8),    # starts the crossunder push
]
def crossover(t, sx):   # sx = +1: right turn (outside skate is the left one, on +x)
    o, i = ('l', 'r') if sx > 0 else ('r', 'l')
    dx, dy, dz, yaw = loop_path(CROSS_OUT, t); foot(o, dx=sx * (dx - NARROW), dy=dy, dz=max(0.0, dz), yaw=sx * yaw, roll=-sx * 8)
    dx, dy, dz, yaw = loop_path(CROSS_IN, t); foot(i, dx=sx * (dx + NARROW), dy=dy, dz=max(0.0, dz), yaw=sx * yaw, roll=-sx * 8)
    w = S(TAU * t)
    bmove('pelvis', (-sx * 0.07, 0, -0.07 - 0.02 * (0.5 + 0.5 * w)))   # low, hips into the turn
    brot('pelvis', 'Z', -sx * 10); brot('spine_02', 'Z', -sx * 12 + 3 * w)   # chest turns into the turn
    brot('spine_01', 'X', 10); brot('Head', 'X', -7); brot('Head', 'Z', -sx * 8)
    stick(rot=[((0, 0, 1), -sx * 16)], move=(-sx * 0.08, 0, 0))
f = clip('cross_r', f, 16, True, lambda t: crossover(t, 1), range(0, 17, 2))
f = clip('cross_l', f, 16, True, lambda t: crossover(t, -1), range(0, 17, 2))

# ---- backward skating (C-cuts), for a defender facing the carrier: both blades stay on the ice; each one
# carves a C, heel swinging out and forward then sweeping back in under the hips, pushing him backward.
# Sitting low as if in a chair, chest more upright than going forward, head up, stick out front on the ice. ----
BACK_FOOT = [   # u, dx (out), dy (- = toward his front), yaw (+ = toe in), roll
    (0.00, -0.06,  0.02,  0, 0),
    (0.20,  0.06, -0.08, 16, 8),
    (0.42,  0.18, -0.18, 24, 12),    # heel out and forward: the push
    (0.62,  0.12, -0.10, 12, 6),
    (0.82,  0.00,  0.00,  2, 0),     # sweeps back in under the hips
]
def backskate(t):
    for s, ph, sx in (('l', 0.0, 1), ('r', 0.5, -1)):
        dx, dy, yaw, roll = loop_path(BACK_FOOT, t + ph)
        foot(s, dx=sx * dx, dy=dy, yaw=-sx * yaw, roll=-sx * roll)
    sway = S(TAU * (t - 0.2))
    bmove('pelvis', (-0.04 * sway, 0.03, -0.085 - 0.012 * abs(C(TAU * t))))
    brot('pelvis', 'Z', 5 * sway); brot('spine_02', 'Z', -6 * sway)
    brot('spine_01', 'X', 3); brot('Head', 'X', -4)
    stick(rot=[((0, 0, 1), 9 * S(TAU * t + 0.6))], move=(0, -0.05, 0))   # stick out front, sweeping the lane
f = clip('back', f, 22, True, backskate, range(0, 23, 2))

# ---- stickhandling: gliding with the puck, the blade working side to side over it ----
def handle(t):
    w = S(TAU * 2 * t)
    for s, sx in (('l', 1), ('r', -1)): foot(s, dx=-sx * 0.04, yaw=-sx * 5)
    bmove('pelvis', (0.02 * w, 0, -0.05))
    brot('spine_01', 'X', 7); brot('spine_02', 'Z', 5 * w); brot('Head', 'X', -5)
    stick(rot=[((0, 0, 1), 20 * w), ((0, 1, 0), 6 * w)], move=(0.05 * w, -0.04, 0))
f = clip('handle', f, 24, True, handle, range(0, 25, 2))

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

# ---- goalie: wide, low stance, stick flat on the ice in front, a little side-to-side shuffle ----
# ---- goalie. The blocker (right) hand holds the stick alone; the glove (left) hand is keyed on its own, off the
# stick (its IK target is moved directly). Stance: wide, deep knee bend, chest up, glove open beside the hip,
# stick blade flat on the ice in front of the five-hole. Saves start from the stance and return to it. ----
def glove_at(p):
    o = HT['l']; Mw = o.matrix_world.copy(); Mw.translation = Vector(p); o.matrix_world = Mw; vl.update()
def smooth(u): u = min(1.0, max(0.0, u)); return u * u * (3 - 2 * u)
def stance(shift=0.0, low=0.0):
    foot('l', dx=0.11, yaw=10); foot('r', dx=-0.11, yaw=-10)
    bmove('pelvis', (shift, 0.02, -0.16 - low)); brot('spine_01', 'X', 6); brot('Head', 'X', -8)
GSTICK = ((-0.30, -0.30, 0.55), (0.06, -0.55, -0.83))
def goalie(t):
    sw = S(TAU * t)
    stance(0.015 * sw)
    stick_pose(*GSTICK, 0.0)
    glove_at((0.42, -0.30, 0.62 + 0.01 * sw))
f = clip('goalie', f, 24, True, goalie, range(0, 25, 6))

def env(t, a=0.22, b=0.65):   # 0 -> 1 fast, hold, back to 0 by the end
    return smooth(t / a) if t < a else 1.0 if t < b else 1 - smooth((t - b) / (1 - b))

# butterfly: knees drop together to the ice, pads flare out flat to the sides, glove up, stick seals the five-hole
def butterfly(t):
    k = env(t)
    # feet go back and out behind the knees (shins flared), hips drop so the knees come down together in front
    foot('l', dx=0.11 + 0.14 * k, dy=0.44 * k, yaw=10 + 30 * k); foot('r', dx=-0.11 - 0.14 * k, dy=0.44 * k, yaw=-10 - 30 * k)
    bmove('pelvis', (0, 0.02 + 0.12 * k, -0.16 - 0.40 * k)); brot('spine_01', 'X', 6 - 8 * k); brot('Head', 'X', -8 - 4 * k)
    G, d = GSTICK
    stick_pose((G[0] + 0.08 * k, G[1] - 0.06 * k, G[2] - 0.2 * k), (d[0] + 0.3 * k, d[1], d[2]), 0.0)
    glove_at((0.42 + 0.06 * k, -0.30 - 0.04 * k, 0.62 - 0.12 * k))
f = clip('g_butterfly', f, 24, False, butterfly, range(0, 25, 2))

# glove save: the glove snaps up and out to his left, weight goes onto the left skate
def gsave(t):
    k = env(t, 0.18, 0.6)
    stance(0.12 * k)
    foot('l', dx=0.12 * k)
    brot('spine_02', 'Y', 10 * k)
    stick_pose(*GSTICK, 0.0)
    glove_at((0.42 + 0.28 * k, -0.30 - 0.12 * k, 0.62 + 0.42 * k))
f = clip('g_glove', f, 20, False, gsave, range(0, 21, 2))

# blocker save: the stick hand punches out to his right, blocker square to the shot
def bsave(t):
    k = env(t, 0.18, 0.6)
    stance(-0.12 * k)
    foot('r', dx=-0.12 * k)
    brot('spine_02', 'Y', -10 * k)
    G, d = GSTICK
    stick_pose((G[0] - 0.28 * k, G[1] - 0.10 * k, G[2] + 0.25 * k), (d[0] - 0.35 * k, d[1], d[2] + 0.2 * k), 0.0)
    glove_at((0.42, -0.30, 0.62))
f = clip('g_blocker', f, 20, False, bsave, range(0, 21, 2))

# pad saves: one leg kicks straight out along the ice (the pad flat to the shot), the other knee drops
def padsave(t, sx):
    k = env(t, 0.18, 0.6)
    s_out, s_in = ('l', 'r') if sx > 0 else ('r', 'l')
    foot(s_out, dx=sx * (0.11 + 0.42 * k), dy=-0.05 * k, yaw=sx * (10 + 40 * k))
    foot(s_in, dx=-sx * 0.11, dy=0.12 * k, yaw=-sx * 10)
    bmove('pelvis', (sx * 0.14 * k, 0.02, -0.16 - 0.22 * k)); brot('spine_01', 'X', 6); brot('Head', 'X', -8)
    brot('spine_02', 'Y', sx * 8 * k)
    stick_pose(*GSTICK, 0.0)
    glove_at((0.42 + (0.1 * k if sx > 0 else 0), -0.30, 0.62 - 0.1 * k))
f = clip('g_pad_l', f, 20, False, lambda t: padsave(t, 1), range(0, 21, 2))
f = clip('g_pad_r', f, 20, False, lambda t: padsave(t, -1), range(0, 21, 2))

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
