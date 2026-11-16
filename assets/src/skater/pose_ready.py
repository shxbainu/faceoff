# Ready stance for the skater rig (Quaternius UE-style bone names), with the stick held in two hands.
# Run inside Blender after build_outfit.py: exec(open(path).read()).
# Right-hand shot: blade on the right, left hand on top of the stick, right hand partway down.
# The character faces -Y, so his LEFT side is +X and his right side is -X.
import bpy, bmesh, math
from mathutils import Vector, Matrix, Quaternion

sc = bpy.context.scene; vl = bpy.context.view_layer
arm = bpy.data.objects['Armature']; P = arm.pose.bones
if arm.animation_data: arm.animation_data.action = None
arm.location = (0, 0, 0)
for pb in P:
    pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
    for c in list(pb.constraints): pb.constraints.remove(c)
vl.update()

def rot(name, axis, deg):
    pb = P[name]; M = pb.matrix.copy(); piv = M.translation.copy()
    pb.matrix = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-piv) @ M
    vl.update()

# legs: shoulder-width stance, toes turned out, knees bent over the toes, skates flat on the ice
for s, side in ((1, 'l'), (-1, 'r')):
    rot('thigh_' + side, 'Y', -s * 16)      # spread the legs (left leg out to +X)
    rot('thigh_' + side, 'X', -40)          # knee forward
    rot('calf_' + side, 'X', 66)            # shin back
    rot('foot_' + side, 'Y', s * 14)        # keep the blade flat after the spread
    rot('foot_' + side, 'X', -26)
    rot('thigh_' + side, 'Z', s * 12)       # toes out
# torso: lean forward from the hips, chest up, eyes up the ice
rot('pelvis', 'X', 8)
rot('spine_01', 'X', 26); rot('spine_02', 'X', 10)
rot('neck_01', 'X', -10); rot('Head', 'X', -16)
vl.update()

# drop the body so the blades rest on the ice
dg = bpy.context.evaluated_depsgraph_get(); low = 1e9
for n in ('blade_l', 'blade_r'):
    o = bpy.data.objects[n].evaluated_get(dg); m = o.to_mesh()
    low = min(low, min((o.matrix_world @ v.co).z for v in m.vertices)); o.to_mesh_clear()
arm.location.z -= low; vl.update()

# stick: out in front, blade ahead and a little to the right, shaft at a natural lie angle
pelvis = arm.matrix_world @ P['pelvis'].matrix.translation
TOP = pelvis + Vector((0.14, -0.30, 0.12))           # in front of the left hip
HEEL = Vector((pelvis.x - 0.32, pelvis.y - 1.05, 0.035))  # out front, to his right
for n in ('stick', 'grip_l', 'grip_r', 'pole_l', 'pole_r'):
    x = bpy.data.objects.get(n)
    if x: bpy.data.objects.remove(x)
sh = HEEL - TOP; L = sh.length; d = sh.normalized()

# hands: top hand at the knob, bottom hand about a third of the way down; elbows out, not tucked in
def empty(name, loc):
    e = bpy.data.objects.new(name, None); sc.collection.objects.link(e); e.location = loc; return e
gl = empty('grip_l', TOP + d * 0.06)
gr = empty('grip_r', TOP + d * (L * 0.46))
pl = empty('pole_l', pelvis + Vector((0.6, 0.15, 0.45)))
pr = empty('pole_r', pelvis + Vector((-0.6, 0.1, 0.25)))
for side, g, pole in (('l', gl, pl), ('r', gr, pr)):
    c = P['lowerarm_' + side].constraints.new('IK'); c.target = g; c.chain_count = 3 if side == 'r' else 2
    c.pole_target = pole; c.pole_angle = math.radians(-90)
vl.update()

# fingers wrap the shaft: every finger joint bends about its local X axis (same on both hands)
def curl(name, deg):
    pb = P[name]; pb.rotation_quaternion = Quaternion((1, 0, 0), math.radians(deg))
for side in 'lr':
    for f in ('index', 'middle', 'ring', 'pinky'):
        curl(f'{f}_01_{side}', 55); curl(f'{f}_02_{side}', 75); curl(f'{f}_03_{side}', 45)
    curl(f'thumb_01_{side}', 20); curl(f'thumb_02_{side}', 30)
vl.update()

# the stick runs from the top palm to the blade spot on the ice; the bottom hand takes the point on the
# shaft nearest its shoulder that is within reach, so both hands really hold it.
# Each wrist turns so the shaft lies ACROSS the palm (the hand's local X axis, the axis the fingers curl
# around), not along the forearm; otherwise the stick runs past the side of the fist.
def palm(side):
    M = arm.matrix_world @ P['hand_' + side].matrix
    return M.translation + M.to_3x3() @ Vector((0, 0.075, 0.03))   # inside the curled fingers
def align_hand(side, d):
    pb = P['hand_' + side]; Mw = arm.matrix_world @ pb.matrix
    x = Mw.to_3x3().col[0].normalized(); tgt = d if x.dot(d) > 0 else -d
    o = Mw.translation
    Mw2 = Matrix.Translation(o) @ x.rotation_difference(tgt).to_matrix().to_4x4() @ Matrix.Translation(-o) @ Mw
    pb.matrix = arm.matrix_world.inverted() @ Mw2; vl.update()
HEEL = Vector((pelvis.x - 0.30, pelvis.y - 0.82, 0.035))
for _ in range(3):
    pt = palm('l'); d = (HEEL - pt).normalized(); align_hand('l', d)
pt = palm('l'); d = (HEEL - pt).normalized(); Ls = (HEEL - pt).length
S = arm.matrix_world @ P['upperarm_r'].matrix.translation
reach = (arm.data.bones['upperarm_r'].length + arm.data.bones['lowerarm_r'].length) * 0.97 + 0.07 + 0.1  # the shoulder drops toward the stick
best = 0.25
for k in range(26, 75):
    t = Ls * k / 100
    if (pt + d * t - S).length <= reach: best = t
goal = pt + d * best
g = bpy.data.objects['grip_r']; g.location = goal
for _ in range(8):   # turn the wrist across the shaft, then walk the IK until the grip sits on the shaft
    vl.update(); align_hand('r', d); err = goal - palm('r'); g.location += err * 0.9
vl.update(); align_hand('r', d)
pb_ = palm('r')
TOP = pt - d * 0.12
L = (HEEL - TOP).length
me = bpy.data.meshes.new('stick'); bm = bmesh.new()
def box(center, size, rotm, mi):
    r = bmesh.ops.create_cube(bm, size=1)
    for v in r['verts']: v.co = center + rotm @ Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = mi
zq = Vector((0, 0, 1)).rotation_difference(d).to_matrix()
box((TOP + HEEL) / 2, (0.026, 0.018, L), zq, 0)
box(TOP + d * 0.05, (0.032, 0.024, 0.09), zq, 1)
flat = Vector((d.x, d.y, 0)).normalized()
bd = Vector((flat.y, -flat.x, 0)) if flat.length > 0 else Vector((-1, 0, 0))   # blade turned across the shaft
if bd.x > 0: bd = -bd                                                           # toward his right (-X)
bd = (bd * 0.6 + flat * 0.8).normalized()
bq = Vector((1, 0, 0)).rotation_difference(bd).to_matrix()
box(HEEL + bd * 0.14 + Vector((0, 0, 0.03)), (0.30, 0.012, 0.065), bq, 1)
bm.to_mesh(me); bm.free()
me.materials.append(bpy.data.materials['stick_shaft']); me.materials.append(bpy.data.materials['stick_tape'])
st = bpy.data.objects.new('stick', me); sc.collection.objects.link(st)
# the stick rides on the bottom hand so any animation carries it
Mh = arm.matrix_world @ P['hand_r'].matrix
st.parent = arm; st.parent_type = 'BONE'; st.parent_bone = 'hand_r'
st.matrix_world = Matrix.Identity(4)
vl.update()
off = ((pb_ - pt) - d * (pb_ - pt).dot(d)).length
print('pose set; stick length', round(L, 2), 'bottom hand along shaft', round(best / Ls, 2), 'bottom palm off the shaft by', round(off, 3))
