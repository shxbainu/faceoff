# Ready stance for the skater rig (Quaternius UE-style bone names), with the stick held in two hands.
# Run inside Blender after build_outfit.py: exec(open(path).read()).
# Right-hand shot: blade on the right, left hand on top of the stick, right hand partway down.
# The character faces -Y, so his LEFT side is +X and his right side is -X.
#
# How the grip works: the fingers curl into a ring with a hollow the size of the shaft. The hollow (its
# centre and the line through it, from the pinky to the index finger) is measured on the real glove mesh,
# in the hand bone's own frame. Each hand is then placed so that hollow sits on the shaft line and runs
# along it, turned about the shaft to keep the wrist as straight as possible. The stick is built through
# both hollows, so the fingers wrap the shaft instead of the shaft running past a closed fist.
import bpy, bmesh, math, itertools
from mathutils import Vector, Matrix, Quaternion

sc = bpy.context.scene; vl = bpy.context.view_layer
arm = bpy.data.objects['Armature']; P = arm.pose.bones; W = arm.matrix_world
out = bpy.data.objects['skater_outfit']
if arm.animation_data: arm.animation_data.action = None
arm.location = (0, 0, 0)
for pb in P:
    pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
    for c in list(pb.constraints): pb.constraints.remove(c)
for n in ('stick', 'grip_l', 'grip_r', 'pole_l', 'pole_r'):
    x = bpy.data.objects.get(n)
    if x: bpy.data.objects.remove(x)
vl.update()

def rot(name, axis, deg):
    pb = P[name]; M = pb.matrix.copy(); piv = M.translation.copy()
    pb.matrix = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-piv) @ M
    vl.update()

# ---- body: knees bent over the toes, flat back leaning forward, head up ----
# Most of the lean comes from the hips (pelvis tips forward, thighs stay put), not from bending the lower
# back: a bent lumbar spine balloons the jersey into a hump.
HINGE = 18
rot('pelvis', 'X', HINGE)
for side in 'lr': rot('thigh_' + side, 'X', -HINGE)
for s, side in ((1, 'l'), (-1, 'r')):
    rot('thigh_' + side, 'Y', -s * 10); rot('thigh_' + side, 'X', -48); rot('calf_' + side, 'X', 80)
    rot('foot_' + side, 'Y', s * 8); rot('foot_' + side, 'X', -32); rot('thigh_' + side, 'Z', s * 8)
rot('pelvis', 'X', 8)
rot('spine_01', 'X', 46 - HINGE); rot('spine_02', 'X', 4); rot('spine_03', 'X', -6)
rot('spine_02', 'Z', -10); rot('clavicle_r', 'X', 12)
rot('neck_01', 'X', -22); rot('Head', 'X', -26)
dg = bpy.context.evaluated_depsgraph_get(); low = 1e9
for n in ('blade_l', 'blade_r'):
    o = bpy.data.objects[n].evaluated_get(dg); m = o.to_mesh()
    low = min(low, min((o.matrix_world @ v.co).z for v in m.vertices)); o.to_mesh_clear()
arm.location.z -= low; vl.update()

# ---- fingers: curl into a ring around a shaft-sized hollow ----
SHAFT_W, SHAFT_T = 0.030, 0.021            # stick shaft cross-section (m)
FINGS = ('index', 'middle', 'ring', 'pinky')
gnames = {g.index: g.name for g in out.vertex_groups}
def verts_of(keys, thr=0.5):
    return [v.index for v in out.data.vertices if sum(g.weight for g in v.groups if gnames.get(g.group) in keys) > thr]
HV = {s: verts_of(['hand_' + s] + [f'{f}_{j}_{s}' for f in FINGS + ('thumb',) for j in ('01', '02', '03')]) for s in 'lr'}
FINGERS = {s: set(verts_of([f'{f}_{j}_{s}' for f in FINGS for j in ('02', '03')])) for s in 'lr'}
def evaluated_points(ids):
    dg = bpy.context.evaluated_depsgraph_get(); o = out.evaluated_get(dg); m = o.to_mesh()
    pts = {i: o.matrix_world @ m.vertices[i].co for i in ids}; o.to_mesh_clear(); return pts
def hand_frame(side): return W @ P['hand_' + side].matrix

def fit_grip(side):
    """Curl each finger so its joints sit on a circle around the shaft, the way fingers wrap a stick:
    each bone is a chord of that circle. Returns the shaft centre and axis in the hand bone frame."""
    for f in FINGS:
        for j in '123': P[f'{f}_0{j}_{side}'].rotation_quaternion = (1, 0, 0, 0)
    vl.update()
    # finger thickness (bone line to glove surface), measured on the middle finger
    pb = P[f'middle_02_{side}']; h = W @ pb.head; t = W @ pb.tail; ax = (t - h).normalized()
    pts = evaluated_points(verts_of([f'middle_02_{side}'], 0.8)).values()
    thick = sum(((p - h) - ax * (p - h).dot(ax)).length for p in pts) / max(1, len(pts))
    R0 = SHAFT_T / 2 + thick * 0.85
    # which way a positive curl bends the finger, in the finger's frame
    M = W @ P[f'middle_01_{side}'].matrix; z = M.to_3x3().col[2].normalized()
    P[f'middle_01_{side}'].rotation_quaternion = Quaternion((1, 0, 0), math.radians(30)); vl.update()
    sgn = 1 if ((W @ P[f'middle_01_{side}'].tail) - (W @ P[f'middle_01_{side}'].head)).dot(z) > 0 else -1
    P[f'middle_01_{side}'].rotation_quaternion = (1, 0, 0, 0); vl.update()
    C = {}
    for f in FINGS:
        M = W @ P[f'{f}_01_{side}'].matrix; C[f] = M.translation + M.to_3x3().col[2].normalized() * R0 * sgn
    a = (C['index'] - C['pinky']).normalized(); Cm = sum(C.values(), Vector()) / 4
    for f in FINGS:
        J0 = (W @ P[f'{f}_01_{side}'].matrix).translation
        R = max(R0 * 0.8, ((J0 - Cm) - a * (J0 - Cm).dot(a)).length)
        th = [2 * math.asin(min(0.99, P[f'{f}_0{j}_{side}'].length / (2 * R))) for j in '123']
        bends = [th[0] / 2, (th[0] + th[1]) / 2, (th[1] + th[2]) / 2]
        for j, bnd in zip('123', bends):
            P[f'{f}_0{j}_{side}'].rotation_quaternion = Quaternion((1, 0, 0), bnd * sgn)
    for j, deg in zip('123', (20, 35, 35)):
        P[f'thumb_0{j}_{side}'].rotation_quaternion = Quaternion((1, 0, 0), math.radians(deg) * sgn)
    vl.update()
    Mi = hand_frame(side).inverted()
    return (Mi @ Cm, (Mi.to_3x3() @ a).normalized(), R0, thick)
GRIP = {s: fit_grip(s) for s in 'lr'}
HOLLOW = {s: GRIP[s][:2] for s in 'lr'}
CURL_K = {s: (round(GRIP[s][3] * 100, 2), None, None, GRIP[s][2]) for s in 'lr'}   # (finger thickness cm, -, -, ring radius)

# ---- where the stick goes: top hand in front of the hips, blade out front to his right ----
SL = W @ P['upperarm_l'].head; SR = W @ P['upperarm_r'].head; pel = W @ P['pelvis'].head
UP = arm.data.bones['upperarm_r'].length; LO = arm.data.bones['lowerarm_r'].length
c_r = HOLLOW['r'][0]; HAND_OFF = c_r.length                 # wrist to the middle of the grip
reach150 = math.sqrt(UP * UP + LO * LO + 2 * UP * LO * math.cos(math.radians(30))) + HAND_OFF * 0.9
# the belly: the stick must pass in front of it
dg = bpy.context.evaluated_depsgraph_get(); o = out.evaluated_get(dg); m = o.to_mesh()
torso_keys = {'pelvis', 'spine_01', 'spine_02', 'spine_03'}
tv = [i for i, v in enumerate(out.data.vertices) if sum(g.weight for g in v.groups if gnames.get(g.group) in torso_keys) > 0.6]
torso = [o.matrix_world @ m.vertices[i].co for i in tv]; o.to_mesh_clear()
def clear_of_body(T, d, s):
    for t in [s * x / 6 for x in range(7)]:
        q = T + d * t
        near = [p for p in torso if abs(p.z - q.z) < 0.03 and abs(p.x - q.x) < 0.05]
        if near and q.y > min(p.y for p in near) - 0.07: return False
    return True
def fr(a, b, n): return [a + (b - a) * i / (n - 1) for i in range(n)]
cands = []
for tx, ty, tz in itertools.product(fr(0.0, 0.2, 5), fr(-0.25, -0.5, 6), fr(0.70, 0.95, 6)):
    T = Vector((pel.x + tx, ty, tz)); dl = (T - SL).length
    if not 0.30 < dl < 0.52: continue
    for hx, hy in itertools.product(fr(-0.85, -0.3, 12), fr(-0.8, -1.4, 13)):
        H = Vector((pel.x + hx, hy, 0.04)); d = (H - T).normalized(); Ls = (H - T).length + 0.05
        if not 1.36 < Ls < 1.52: continue
        for s in (0.40, 0.37, 0.34, 0.31, 0.28):
            G = T + d * s
            if (G - SR).length <= reach150 and clear_of_body(T, d, s):
                # prefer a wide grip, then a long stick, then the blade further out front
                # wide grip, full-length stick, top hand down at the hips, blade out front
                score = s * 100 - abs(Ls - 1.45) * 150 - abs(tz - 0.82) * 40 - hy * 5 - abs(tx - 0.05) * 80   # top hand in front, not on the hip
                cands.append((s, score, 0, T, H)); break
cands.sort(key=lambda c: c[1], reverse=True)

# ---- put each hand on the shaft ----
def poles(side):
    S = W @ P['upperarm_' + side].head; sx = 1 if side == 'l' else -1
    return [S + Vector((sx * ox, oy, oz)) for ox in (0.2, 0.4, 0.6) for oy in (-0.2, 0.1, 0.35) for oz in (-0.4, -0.1, 0.2)]
iks = {}
for side in 'lr':
    g = bpy.data.objects.new('grip_' + side, None); sc.collection.objects.link(g)
    p = bpy.data.objects.new('pole_' + side, None); sc.collection.objects.link(p)
    c = P['lowerarm_' + side].constraints.new('IK'); c.target = g; c.chain_count = 2
    c.pole_target = p; c.pole_angle = math.radians(-90); iks[side] = (g, p)

def hand_twist(side, Rt):
    """Twist of the hand about the forearm (degrees) if the hand had world rotation Rt."""
    B = arm.data.bones; rest = (B['lowerarm_' + side].matrix_local.inverted() @ B['hand_' + side].matrix_local).to_3x3()
    Rlow = (W @ P['lowerarm_' + side].matrix).to_3x3()
    q = ((Rlow @ rest).inverted() @ Rt).to_quaternion(); tw = Quaternion((q.w, 0, q.y, 0)); tw.normalize()
    a = math.degrees(2 * math.atan2(tw.y, tw.w))
    return (a + 180) % 360 - 180
def wrist_cost(side, Rt):
    # a real wrist bends a little and turns over mostly through the forearm, so big twists are expensive
    fore = (W @ P['lowerarm_' + side].matrix).to_3x3().col[1].normalized()
    bend = math.degrees(fore.angle(Rt.col[1])); tw = abs(hand_twist(side, Rt))
    return bend + 1.5 * max(0.0, tw - 90)   # the forearm twist bones carry the turn
def place_hand(side, G):
    """Hand so the hollow is at G and runs along the shaft; roll chosen for the most natural wrist."""
    c_loc, a_loc = HOLLOW[side]; g, pole = iks[side]
    best = None
    for pp in poles(side):
        pole.location = pp; vl.update()
        R = hand_frame(side).to_3x3()
        for _ in range(5):
            fore = (W @ P['lowerarm_' + side].matrix).to_3x3().col[1].normalized()
            R0 = (R @ a_loc).rotation_difference(d).to_matrix() @ R
            R = min((Matrix.Rotation(math.radians(th), 3, d) @ R0 for th in range(0, 360, 5)), key=lambda Rt: wrist_cost(side, Rt))
            wrist = G - R @ c_loc
            g.location = wrist; vl.update()
            Mh = Matrix.Translation(wrist) @ R.to_4x4()
            P['hand_' + side].matrix = W.inverted() @ Mh; vl.update()
        fore = (W @ P['lowerarm_' + side].matrix).to_3x3().col[1].normalized()
        bend = math.degrees(fore.angle(hand_frame(side).to_3x3().col[1]))
        miss = ((W @ P['lowerarm_' + side].tail) - wrist).length
        score = wrist_cost(side, hand_frame(side).to_3x3()) + miss * 2000
        if best is None or score < best[0]: best = (score, pp.copy(), bend, miss)
    pole.location = best[1]; vl.update()
    # settle once more with the chosen pole
    R = hand_frame(side).to_3x3()
    for _ in range(5):
        fore = (W @ P['lowerarm_' + side].matrix).to_3x3().col[1].normalized()
        R0 = (R @ a_loc).rotation_difference(d).to_matrix() @ R
        R = min((Matrix.Rotation(math.radians(th), 3, d) @ R0 for th in range(0, 360, 5)), key=lambda Rt: wrist_cost(side, Rt))
        wrist = G - R @ c_loc; g.location = wrist; vl.update()
        P['hand_' + side].matrix = W.inverted() @ (Matrix.Translation(wrist) @ R.to_4x4()); vl.update()
    return best

def elbow(side):
    u = (W @ P['upperarm_' + side].matrix).to_3x3().col[1]; l = (W @ P['lowerarm_' + side].matrix).to_3x3().col[1]
    return 180 - math.degrees(u.angle(l))
def wrist_bend(side):
    return math.degrees((W @ P['lowerarm_' + side].matrix).to_3x3().col[1].angle(hand_frame(side).to_3x3().col[1]))
# try the best-looking layouts and keep the first one both arms can really hold:
# hands on the shaft (IK reaches), wrists bent at most 35 degrees, bottom elbow not locked straight
tried = []
for cand in cands[:24]:
    s_grip, _, _, T, HEEL = cand; d = (HEEL - T).normalized()
    rl = place_hand('l', T); rr = place_hand('r', T + d * s_grip)
    tl = abs(hand_twist('l', hand_frame('l').to_3x3())); tr = abs(hand_twist('r', hand_frame('r').to_3x3()))
    ok = rl[3] < 0.005 and rr[3] < 0.005 and wrist_bend('l') <= 35 and wrist_bend('r') <= 35 and elbow('r') <= 160 and tl <= 100 and tr <= 100
    score = s_grip * 100 - max(0, wrist_bend('l') - 25) - max(0, wrist_bend('r') - 25) - (rl[3] + rr[3]) * 1000 - max(0, elbow('r') - 150) - max(0, tl - 90) - max(0, tr - 90)
    tried.append((score, cand))
    if ok: break
else:
    cand = max(tried, key=lambda t: t[0])[1]
    s_grip, _, _, T, HEEL = cand; d = (HEEL - T).normalized()
    place_hand('l', T); place_hand('r', T + d * s_grip)
GL = T
# spread each hand's twist along its forearm (twist bones from twist_bones.py)
for side in 'lr':
    tw = hand_twist(side, hand_frame(side).to_3x3())
    for i, f in ((1, 1 / 3), (2, 2 / 3), (3, 1.0)):
        pb = P.get(f'lowerarm_twist_0{i}_{side}')
        if pb: pb.rotation_quaternion = Quaternion((0, 1, 0), math.radians(tw * f))
vl.update()

# ---- the stick: knob just past the top hand, through both hollows, heel on the ice ----
KNOB = GL - d * 0.05; L = (HEEL - KNOB).length
me = bpy.data.meshes.new('stick'); bm = bmesh.new()
zq = Vector((0, 0, 1)).rotation_difference(d).to_matrix()
flat = Vector((d.x, d.y, 0)).normalized(); side_v = d.cross(Vector((0, 0, 1))).normalized()
# shaft: rounded rectangle, the wide face toward the blade's face
def shaft_ring(center, w, t, n=16):
    vs = []
    for i in range(n):
        ang = 2 * math.pi * i / n; cx, cy = math.cos(ang), math.sin(ang)
        x = w / 2 * math.copysign(abs(cx) ** 0.5, cx); y = t / 2 * math.copysign(abs(cy) ** 0.5, cy)
        vs.append(bm.verts.new(center + side_v * y + (d.cross(side_v)).normalized() * x))
    return vs
rings = [shaft_ring(KNOB + d * (L * t), SHAFT_W, SHAFT_T) for t in (0, 0.0001, 0.12, 0.98, 1.0)]
for r0, r1 in zip(rings, rings[1:]):
    for i in range(16): bm.faces.new((r0[i], r0[(i + 1) % 16], r1[(i + 1) % 16], r1[i]))
bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
for f in bm.faces: f.smooth = True; f.material_index = 0
# knob tape: the top 12 cm
for f in bm.faces:
    c = f.calc_center_median()
    if (c - KNOB).dot(d) < L * 0.12: f.material_index = 1
# blade: thin, curved, out to his right from the heel
bd = -side_v if side_v.x > 0 else side_v
bd = (bd * 0.75 + flat * 0.66).normalized()
up = Vector((0, 0, 1)); nrm = bd.cross(up).normalized()
cols = []
for i in range(9):
    t = i / 8; c = HEEL + bd * (0.30 * t) + nrm * (0.025 * t * t) + up * (0.0)
    h = 0.065 - 0.012 * t
    cols.append([bm.verts.new(c + nrm * (sgn * 0.006) + up * z) for sgn in (-1, 1) for z in (0.0, h)])
for a_, b_ in zip(cols, cols[1:]):
    for (i, j) in ((0, 1), (3, 2), (1, 3), (2, 0)):
        f = bm.faces.new((a_[i], b_[i], b_[j], a_[j])); f.material_index = 1
bm.faces.new((cols[-1][0], cols[-1][1], cols[-1][3], cols[-1][2])).material_index = 1
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me); bm.free()
me.materials.append(bpy.data.materials['stick_shaft']); me.materials.append(bpy.data.materials['stick_tape'])
st = bpy.data.objects.new('stick', me); sc.collection.objects.link(st)
st.parent = arm; st.parent_type = 'BONE'; st.parent_bone = 'hand_r'
st.matrix_world = Matrix.Identity(4); vl.update()

# ---- checks ----
def grip_check(side):
    c_loc, a_loc = HOLLOW[side]; Mh = hand_frame(side); cw = Mh @ c_loc; aw = (Mh.to_3x3() @ a_loc).normalized()
    off = ((cw - KNOB) - d * (cw - KNOB).dot(d)).length; ang = math.degrees(aw.angle(d))
    pts = evaluated_points(FINGERS[side]).values()
    dist = [((p - KNOB) - d * (p - KNOB).dot(d)).length for p in pts if abs((p - cw).dot(d)) < 0.05]
    return dict(hollow_off_shaft_cm=round(off * 100, 2), axis_vs_shaft_deg=round(ang, 1), finger_thick_cm=CURL_K[side][0], ring_r_cm=round(CURL_K[side][3] * 100, 2), finger_to_axis_min_cm=round(min(dist) * 100, 2),
                finger_to_axis_mean_cm=round(sum(dist) / len(dist) * 100, 2),
                wrist_bend=round(wrist_bend(side)), wrist_twist=round(hand_twist(side, hand_frame(side).to_3x3())), elbow=round(elbow(side)))
REPORT = dict(tried=len(tried), stick_len=round(L, 2), grip_gap_cm=round(s_grip * 100), top=tuple(round(x, 2) for x in T),
              heel=tuple(round(x, 2) for x in HEEL), left=grip_check('l'), right=grip_check('r'))
print(REPORT)
