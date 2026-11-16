# Animation controls for the posed skater. Run inside Blender after pose_ready.py.
#  - stick_ctl: one empty that carries the stick; both hands follow it (IK on the forearm to a target
#    parented to the stick, hand rotation copied from that target), so the grip never comes apart.
#    It rides on the chest (spine_02), so leaning and turning carry the stick.
#  - foot_tgt_l/r: blades planted where these empties are (leg IK, foot rotation copied), knee poles.
#  - arm poles ride on the upper chest so the elbows keep their line when the body moves.
#  - forearm twist bones copy a share of the hand's twist, so turning the hand never wrings the wrist.
import bpy, math
from mathutils import Vector, Matrix

sc = bpy.context.scene; vl = bpy.context.view_layer
arm = bpy.data.objects['Armature']; P = arm.pose.bones; W = arm.matrix_world
stick = bpy.data.objects['stick']

def empty(name, Mw, size=0.05, shape='PLAIN_AXES'):
    e = bpy.data.objects.get(name)
    if e: bpy.data.objects.remove(e)
    e = bpy.data.objects.new(name, None); sc.collection.objects.link(e)
    e.empty_display_size = size; e.empty_display_type = shape; e.matrix_world = Mw; return e
def parent_keep(child, parent, bone=None):
    Mw = child.matrix_world.copy(); child.parent = parent
    if bone: child.parent_type = 'BONE'; child.parent_bone = bone
    vl.update(); child.matrix_world = Mw
def world(bone): return W @ P[bone].matrix

vl.update()
KEYS = ['hand_l', 'hand_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'lowerarm_l', 'lowerarm_r', 'Head']
BEFORE = {k: (W @ P[k].head).copy() for k in KEYS}
BEFORE_ROT = {k: (W @ P[k].matrix).to_quaternion() for k in ('hand_l', 'hand_r', 'foot_l', 'foot_r')}
# ---- stick controller at the bottom hand, Z along the shaft ----
Mh = world('hand_r'); sm = stick.matrix_world.copy()
me = stick.data; pts = [sm @ v.co for v in me.vertices]
shaft_dir = (min(pts, key=lambda p: p.z) - max(pts, key=lambda p: p.z)).normalized()
rotm = Vector((0, 0, 1)).rotation_difference(shaft_dir).to_matrix().to_4x4()
ctl = empty('stick_ctl', Matrix.Translation(Mh.translation) @ rotm, 0.15, 'ARROWS')
parent_keep(ctl, arm, 'spine_02')
parent_keep(stick, ctl)

# ---- hands follow targets on the stick ----
for s in 'lr':
    t = empty('hand_tgt_' + s, world('hand_' + s), 0.04, 'CUBE'); parent_keep(t, ctl)
    ik = next(c for c in P['lowerarm_' + s].constraints if c.type == 'IK')
    ik.target = t
    pole = bpy.data.objects['pole_' + s]; parent_keep(pole, arm, 'spine_03')
    for c in [c for c in P['hand_' + s].constraints]: P['hand_' + s].constraints.remove(c)
    cr = P['hand_' + s].constraints.new('COPY_ROTATION'); cr.target = t
    cr.target_space = 'WORLD'; cr.owner_space = 'WORLD'
    P['hand_' + s].rotation_quaternion = (1, 0, 0, 0)
    for i, f in ((1, 1 / 3), (2, 2 / 3), (3, 1.0)):
        pb = P[f'lowerarm_twist_0{i}_{s}']
        for c in list(pb.constraints): pb.constraints.remove(c)
        pb.rotation_quaternion = (1, 0, 0, 0)
        c = pb.constraints.new('COPY_ROTATION'); c.target = arm; c.subtarget = 'hand_' + s
        c.use_x = False; c.use_z = False; c.euler_order = 'YXZ'
        c.target_space = 'LOCAL'; c.owner_space = 'LOCAL'; c.influence = f
for n in ('grip_l', 'grip_r'):
    x = bpy.data.objects.get(n)
    if x: bpy.data.objects.remove(x)
vl.update()

# ---- legs: blades stay where the foot targets are ----
def knee_check(s): return (W @ P['calf_' + s].head).copy()
for s in 'lr':
    knee0 = knee_check(s); foot0 = world('foot_' + s)
    t = empty('foot_tgt_' + s, foot0, 0.08, 'CUBE'); parent_keep(t, arm)
    hip = W @ P['thigh_' + s].head; ank = foot0.translation; mid = (hip + ank) / 2
    pole = empty('knee_pole_' + s, Matrix.Translation(knee0 + (knee0 - mid).normalized() * 0.6), 0.05, 'SPHERE')
    parent_keep(pole, arm)
    for c in list(P['calf_' + s].constraints): P['calf_' + s].constraints.remove(c)
    ik = P['calf_' + s].constraints.new('IK'); ik.target = t; ik.pole_target = pole; ik.chain_count = 2
    best = None
    for a in range(-180, 180, 3):
        ik.pole_angle = math.radians(a); vl.update()
        err = (knee_check(s) - knee0).length
        if best is None or err < best[0]: best = (err, a)
    ik.pole_angle = math.radians(best[1])
    cr = P['foot_' + s].constraints.new('COPY_ROTATION'); cr.target = t
    cr.target_space = 'WORLD'; cr.owner_space = 'WORLD'
vl.update()

# ---- report how far anything moved when the controls took over ----
REPORT = {k: round((W @ P[k].head - BEFORE[k]).length * 100, 2) for k in KEYS}
REPORT.update({k + '_rot': round(math.degrees((W @ P[k].matrix).to_quaternion().rotation_difference(BEFORE_ROT[k]).angle), 1) for k in BEFORE_ROT})
print('controls ready; moved (cm / deg):', REPORT)
