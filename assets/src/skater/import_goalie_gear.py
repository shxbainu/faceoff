# Imported goalie gear: fits real models onto the skater rig. Run inside Blender after animate.py and
# build_goalie_gear.py (it reuses that script's helpers and the posed goalie stance), with both source models
# already imported (MCP for Blender: import_asset from Sketchfab, ids below). The source objects are left untouched
# and hidden; the game pieces are fresh copies named g_*.
#
# Sources (CC-BY 4.0, credited in assets/CREDITS.md):
#   "True L12.2 CP31 Version" by YeaBoiiiiiiiii  https://sketchfab.com/3d-models/5ace50e9a12d4c029614820d3112dcb3
#       groups: Cube_3 = the pair of leg pads, Cube.001_2 = blocker, Cube.003_5 + NurbsPath.043_80 = catching glove,
#       Cube.002_4 = goalie stick. The glove's ~60 lace curves are left out (far too fine for the game).
#   "Hockey Goalie Mask" by matyprokop09          https://sketchfab.com/3d-models/12fe01ffe0d4443b96292815bb79958a
#       Object_3.* = shell, Object_2.* = cage; the face points -X in the file.
# Both sets face -Y like the character, except the mask (turned 90 degrees here).
#
# Steps per piece: copy and join its meshes, drop tiny loose islands (embossed brand text), decimate to a game
# budget, recolour to the three gear materials (white -> team colour, red/blue -> trim, black/grey -> dark), then
# scale, turn and place it in the goalie stance and parent it to its bone.
import bpy, bmesh, math
from mathutils import Vector, Matrix

exec(open('/Users/brianyao/claude-web-game/assets/src/skater/build_goalie_gear.py').read())   # helpers, materials, posed stance

SET, MASK = 'Sketchfab_model.005', 'Sketchfab_model.006'

def group_meshes(name):
    o = bpy.data.objects[name]
    return [c for c in [o, *o.children_recursive] if c.type == 'MESH']

def copy_join(meshes, name):
    vl.update(); made = []
    for m in meshes:
        c = m.copy(); c.data = m.data.copy(); col.objects.link(c)
        c.parent = None; c.matrix_world = m.matrix_world.copy(); made.append(c)
    for o in sc.objects: o.select_set(False)
    for o in made: o.select_set(True)
    vl.objects.active = made[0]
    if len(made) > 1: bpy.ops.object.join()
    o = vl.objects.active; o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)   # vertices in world space, identity transform
    return o

def islands(bm):
    bm.verts.ensure_lookup_table(); seen, out = set(), []
    for v in bm.verts:
        if v.index in seen: continue
        stack, isl = [v], []
        while stack:
            u = stack.pop()
            if u.index in seen: continue
            seen.add(u.index); isl.append(u); stack.extend(e.other_vert(u) for e in u.link_edges)
        out.append(isl)
    return out

def drop_small(o, frac=0.06):
    """loose pieces under `frac` of the piece's size (lettering, rivets, laces) are too small to read in game"""
    bm = bmesh.new(); bm.from_mesh(o.data)
    def diag(isl):
        xs = [u.co for u in isl]
        return (Vector((max(c.x for c in xs), max(c.y for c in xs), max(c.z for c in xs))) - Vector((min(c.x for c in xs), min(c.y for c in xs), min(c.z for c in xs)))).length
    isl = islands(bm); big = max(diag(i) for i in isl)
    gone = [u for i in isl if diag(i) < big * frac for u in i]
    bmesh.ops.delete(bm, geom=gone, context='VERTS'); bm.to_mesh(o.data); bm.free()
    return len(isl), len(gone)

def keep_side(o, cx, side):
    """keep the faces whose centre is on one side of x = cx (side +1: x > cx)"""
    bm = bmesh.new(); bm.from_mesh(o.data)
    gone = [f for f in bm.faces if (f.calc_center_median().x - cx) * side < 0]
    bmesh.ops.delete(bm, geom=gone, context='FACES'); bm.to_mesh(o.data); bm.free()

def decimate(o, faces):
    n = len(o.data.polygons)
    if n > faces:
        m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = faces / n
        vl.objects.active = o; bpy.ops.object.modifier_apply(modifier=m.name)
    return len(o.data.polygons)

def recolour(o, force=None):
    out = []
    for slot in o.material_slots:
        c = (1, 1, 1)
        if slot.material and slot.material.use_nodes:
            b = next((n for n in slot.material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if b: c = tuple(b.inputs['Base Color'].default_value)[:3]
        lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; sat = max(c) - min(c)
        slot.material = force or (BODY if lum > 0.5 and sat < 0.25 else DARK if lum < 0.15 or (sat < 0.1 and lum < 0.5) else TRIM)
        out.append(slot.material.name)
    return sorted(set(out))

def verts(o): return [o.matrix_world @ v.co for v in o.data.vertices]
def bbox(o):
    p = verts(o); return (Vector((min(q.x for q in p), min(q.y for q in p), min(q.z for q in p))), Vector((max(q.x for q in p), max(q.y for q in p), max(q.z for q in p))))

def transform(o, M):
    """apply a world-space matrix to the mesh data (the object keeps an identity transform)"""
    o.data.transform(M); o.data.update()

def prep(name, meshes, faces, force=None, frac=0.06):
    o = copy_join(meshes, name)
    isl, gone = drop_small(o, frac); f = decimate(o, faces); mats = recolour(o, force)
    return o, (name, f, isl, gone, mats)

report = []
for p in [x for x in bpy.data.objects if x.name.startswith(('g_pad', 'g_knee', 'g_blocker', 'g_stick'))]: bpy.data.objects.remove(p)

# ---------------------------------------------------------------- leg pads
pair, r = prep('pads_pair', group_meshes('Cube_3'), 5000, frac=0.012); report.append(r)   # pads are built from many panels: only drop specks
lo, hi = bbox(pair); cx = (lo.x + hi.x) / 2
calf = (hd('calf_l') - tl('calf_l')).length
S = (calf + 0.32) / (hi.z - lo.z)   # one scale for the whole set: a pad reaches from just above the knee to over the boot
for s, side in (('l', 1), ('r', -1)):   # the character's left is +x
    pad = pair.copy(); pad.data = pair.data.copy(); col.objects.link(pad); pad.name = 'g_pad_' + s
    keep_side(pad, cx, side)
    plo, phi = bbox(pad); pc = (plo + phi) / 2
    k, a = hd('calf_' + s), tl('calf_' + s)
    # In the crouch the shin leans far forward, so the pad does not simply follow it: it stands from the boot, resting
    # on the ice, up to a little above the knee (the thigh rise), in front of the shin.
    bottom = Vector((a.x, a.y - 0.08, 0.03)); top = Vector((k.x, k.y - 0.06, k.z + 0.18))   # near upright, knee covered
    up = (top - bottom).normalized(); h = (top - bottom).length
    Sp = h / (phi.z - plo.z); dpt = (phi.y - plo.y) * Sp
    fwd = (FWD - up * FWD.dot(up)).normalized()
    R = Vector((0, 0, 1)).rotation_difference(up).to_matrix().to_4x4()
    centre = (bottom + top) / 2 + fwd * (dpt / 2 - 0.02)   # its back against the front of the shin
    transform(pad, Matrix.Translation(centre) @ R @ Matrix.Scale(Sp, 4) @ Matrix.Translation(-pc))
    zlo = min(v.co.z for v in pad.data.vertices)
    if zlo < 0.015: transform(pad, Matrix.Translation((0, 0, 0.015 - zlo)))   # never into the ice
    attach(pad, 'calf_' + s); report.append(('g_pad_' + s, len(pad.data.polygons)))
bpy.data.objects.remove(pair)

# ---------------------------------------------------------------- blocker (stick hand) and catching glove
def on_hand(o, bone, offset):
    lo_, hi_ = bbox(o); c = (lo_ + hi_) / 2
    transform(o, Matrix.Translation(hd(bone) + Vector(offset)) @ Matrix.Scale(S, 4) @ Matrix.Translation(-c))
    attach(o, bone)
bl, r = prep('g_blocker', group_meshes('Cube.001_2'), 1500); report.append(r)
on_hand(bl, 'hand_r', (-0.07, -0.03, 0.06))
gl, r = prep('g_glove', group_meshes('Cube.003_5') + group_meshes('NurbsPath.043_80'), 2200); report.append(r)
on_hand(gl, 'hand_l', (0.07, -0.05, 0.04))

# ---------------------------------------------------------------- stick: shaft from the blocker hand to the ice, blade toward the glove side
st, r = prep('g_stick', group_meshes('Cube.002_4'), 900, force=DARK, frac=0.02); report.append(r)   # one dark colour: no maker's name on it
PTS = verts(st)
top = max(PTS, key=lambda q: q.z)
toe = max(PTS, key=lambda q: (q - top).length)
zmin = min(q.z for q in PTS); low = [q for q in PTS if q.z < zmin + 0.06 * (top.z - zmin)]
heel = min(low, key=lambda q: (q - top).length)
H = hd('hand_r')
top_t = H + Vector((0, 0, 0.05)); heel_t = Vector((H.x + 0.14, H.y - 0.36, 0.03)); toe_dir = Vector((1, -0.12, 0)).normalized()
def frame(shaft, blade):
    z = shaft.normalized(); x = (blade - z * blade.dot(z)).normalized(); y = z.cross(x)
    return Matrix((x, y, z)).transposed()
k = (heel_t - top_t).length / (heel - top).length
Rm = frame(heel_t - top_t, toe_dir) @ frame(heel - top, toe - heel).inverted()
transform(st, Matrix.Translation(top_t) @ Rm.to_4x4() @ Matrix.Scale(k, 4) @ Matrix.Translation(-top))
zlo = min(v.co.z for v in st.data.vertices)
if zlo < 0.01: transform(st, Matrix.Translation((0, 0, 0.01 - zlo)))   # blade on the ice, not in it
attach(st, 'hand_r')

# ---------------------------------------------------------------- mask on the head, sized to the helmet
hel = bpy.data.objects['helmet3']
dg = bpy.context.evaluated_depsgraph_get(); e = hel.evaluated_get(dg); me = e.to_mesh()
hp = [e.matrix_world @ v.co for v in me.vertices]; e.to_mesh_clear()
hlo = Vector((min(p.x for p in hp), min(p.y for p in hp), min(p.z for p in hp))); hhi = Vector((max(p.x for p in hp), max(p.y for p in hp), max(p.z for p in hp)))
mk_src = [o for o in group_meshes(MASK)]
shell = [o for o in mk_src if o.material_slots and 'back' in o.material_slots[0].material.name.lower()]
cage_src = [o for o in mk_src if o not in shell]
mk, r = prep('g_mask', shell, 2600, force=BODY); report.append(r)
cg, r = prep('g_cage', cage_src, 1600, force=DARK, frac=0.0); report.append(r)
Rz = Matrix.Rotation(math.radians(90), 4, 'Z')   # the file's face points -X; ours points -Y
for o in (mk, cg): transform(o, Rz)
mlo, mhi = bbox(mk); mc = (mlo + mhi) / 2
Sm = (hhi.x - hlo.x) * 1.12 / (mhi.x - mlo.x)
hc = (hlo + hhi) / 2 + Vector((0, -0.015, -0.03))
for o in (mk, cg):
    transform(o, Matrix.Translation(hc) @ Matrix.Scale(Sm, 4) @ Matrix.Translation(-mc))
    attach(o, 'Head')

for n in (SET, MASK):
    for o in [bpy.data.objects[n], *bpy.data.objects[n].children_recursive]: o.hide_set(True); o.hide_render = True
print('imported gear', report, 'set scale', round(S, 3))
