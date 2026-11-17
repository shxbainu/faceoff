# Goalie gear for the skater rig. Run inside Blender after animate.py (it needs the posed goalie stance).
# Every piece is a rigid mesh parented to the bone it rides on, built in the goalie stance from the posed bones,
# so it follows every clip (stance, butterfly, glove, blocker and pad saves) with no extra skinning:
#   g_pad_l/r, g_padstripe*   leg pads on the calves, over the top of the skate, with two trim bands
#   g_knee_l/r                knee and thigh blocks on the thighs
#   g_blocker                 blocker board on the stick (right) hand
#   (catching glove and mask: imported models, see import_goalie_gear.py)
#   g_stick*                  goalie stick: shaft, wide paddle, blade, held in the blocker hand
# Materials: gear_body (white: the game tints it the team colour), gear_trim (red: trim colour), gear_dark.
# The game shows these only on goalies and hides the skater helmet, visor and stick for them.
import bpy, bmesh, json, math
from mathutils import Vector, Matrix

sc = bpy.context.scene; vl = bpy.context.view_layer
arm = bpy.data.objects['Armature']; P = arm.pose.bones; W = arm.matrix_world
CLIPS = json.load(open('/Users/brianyao/claude-web-game/assets/src/skater/clips.json'))
sc.frame_set(CLIPS['goalie']['start']); vl.update()

for o in [o for o in bpy.data.objects if o.name.startswith('g_')]: bpy.data.objects.remove(o)
col = sc.collection

def mat(name, rgb):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1); bsdf.inputs['Roughness'].default_value = 0.7
    return m
BODY = mat('gear_body', (0.92, 0.92, 0.92)); TRIM = mat('gear_trim', (0.75, 0.08, 0.08)); DARK = mat('gear_dark', (0.06, 0.06, 0.08))

def hd(b): return W @ P[b].head
def tl(b): return W @ P[b].tail

def frame_from(z, fwd):
    """columns x, y, z: z along z, y = fwd made perpendicular, x = y x z"""
    z = z.normalized(); y = (fwd - z * fwd.dot(z)).normalized(); x = y.cross(z).normalized()
    return x, y, z

def box(name, centre, x, y, z, size, material, bevel=0.02):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); col.objects.link(o)
    o.matrix_world = Matrix((
        (x.x * size[0], y.x * size[1], z.x * size[2], centre.x),
        (x.y * size[0], y.y * size[1], z.y * size[2], centre.y),
        (x.z * size[0], y.z * size[1], z.z * size[2], centre.z),
        (0, 0, 0, 1)))
    me.materials.append(material)
    if bevel > 0:
        m = o.modifiers.new('bevel', 'BEVEL'); m.width = bevel; m.segments = 3; m.limit_method = 'NONE'
    return o

def blob(name, centre, radii, material, axes=None):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1.0); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me); col.objects.link(o)
    x, y, z = axes or (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
    o.matrix_world = Matrix((
        (x.x * radii[0], y.x * radii[1], z.x * radii[2], centre.x),
        (x.y * radii[0], y.y * radii[1], z.y * radii[2], centre.y),
        (x.z * radii[0], y.z * radii[1], z.z * radii[2], centre.z),
        (0, 0, 0, 1)))
    me.materials.append(material)
    return o

def rod(name, a, b, r, material):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=r, radius2=r, depth=1.0); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); col.objects.link(o)
    d = b - a; z = d.normalized(); x, y, z = frame_from(z, Vector((0, -1, 0)) if abs(z.y) < 0.9 else Vector((1, 0, 0)))
    c = (a + b) / 2
    o.matrix_world = Matrix(((x.x, y.x, z.x * d.length, c.x), (x.y, y.y, z.y * d.length, c.y), (x.z, y.z, z.z * d.length, c.z), (0, 0, 0, 1)))
    me.materials.append(material)
    return o

def attach(o, bone):
    Mw = o.matrix_world.copy()
    o.parent = arm; o.parent_type = 'BONE'; o.parent_bone = bone
    vl.update(); o.matrix_world = Mw

FWD = Vector((0, -1, 0))   # the character faces -Y
made = []

# ---- leg pads: on the calf, front of the shin, from just above the knee to over the boot
for s in 'lr':
    k, a = hd('calf_' + s), tl('calf_' + s)
    x, y, z = frame_from(a - k, FWD)
    L = (a - k).length
    top, bot = k - z * 0.08, a + z * 0.13
    c = (top + bot) / 2 + y * 0.085
    pad = box('g_pad_' + s, c, x, y, z, (0.30, 0.15, (bot - top).length), BODY, 0.035); attach(pad, 'calf_' + s); made.append(pad)
    for i, f in enumerate((0.3, 0.62)):
        st = box(f'g_padstripe_{s}{i}', top.lerp(bot, f) + y * 0.087, x, y, z, (0.305, 0.155, 0.04), TRIM, 0.01); attach(st, 'calf_' + s); made.append(st)
    # knee and lower-thigh block
    h, kk = hd('thigh_' + s), tl('thigh_' + s)
    x2, y2, z2 = frame_from(kk - h, FWD)
    c2 = h.lerp(kk, 0.72) + y2 * 0.09
    kn = box('g_knee_' + s, c2, x2, y2, z2, (0.29, 0.14, (kk - h).length * 0.55), BODY, 0.035); attach(kn, 'thigh_' + s); made.append(kn)

# ---- blocker: a board on the back of the stick hand, facing the shooter
H = hd('hand_r')
bl = box('g_blocker', H + Vector((-0.07, -0.05, 0.05)), Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)), (0.2, 0.05, 0.36), BODY, 0.015)
attach(bl, 'hand_r'); made.append(bl)
bt = box('g_blockerTrim', H + Vector((-0.07, -0.078, 0.05)), Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)), (0.16, 0.01, 0.06), TRIM, 0.004)
attach(bt, 'hand_r'); made.append(bt)

# The catching glove, mask, chest and shoulders are not built here any more: round primitives made him look like a
# ball. The glove and mask come from real models (import_goalie_gear.py); the chest and arms are bulked by the game
# thickening the jersey itself on goalies.

# ---- goalie stick in the blocker hand: shaft down to a wide paddle, blade flat along the ice
top = H + Vector((0, 0, 0.06))
heel = Vector((H.x + 0.12, H.y - 0.34, 0.035))
pad_top = heel + Vector((0, 0, 0.42))
shaft = rod('g_stick_shaft', top, pad_top, 0.017, DARK)
x, y, z = frame_from(heel - pad_top, FWD)
paddle = box('g_stick_paddle', (pad_top + heel) / 2, x, y, z, (0.075, 0.028, (heel - pad_top).length), TRIM, 0.006)
toe = heel + Vector((0.36, -0.06, 0))
bx, by, bz = frame_from(Vector((0, 0, 1)), toe - heel)
blade = box('g_stick_blade', (heel + toe) / 2 + Vector((0, 0, 0.012)), bx, by, bz, (0.03, (toe - heel).length, 0.09), DARK, 0.006)
for o in (shaft, paddle, blade): attach(o, 'hand_r'); made.append(o)

print('goalie gear', len(made), 'pieces', sorted(o.name for o in made))
