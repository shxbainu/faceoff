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

def weld(o, rel=0.0005):
    """The source meshes are split at every UV seam, so each panel is a loose shell of triangles. Decimating that
    tears it further, and an outline shell pushed out along split normals breaks into splinters that poke through
    the surface (the black scribbles on the gear). Weld coincident vertices and point the normals outward.
    rel: weld distance as a fraction of the piece's size (tiny = exactly coincident seams only)."""
    bm = bmesh.new(); bm.from_mesh(o.data)
    lo, hi = bbox(o); d = (hi - lo).length
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=d * rel)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data); bm.free(); o.data.update()

def non_manifold(o):
    bm = bmesh.new(); bm.from_mesh(o.data); n = sum(1 for e in bm.edges if not e.is_manifold); bm.free(); return n

CREASE = math.radians(30)   # hard-surface gear: an edge folding more than this is a crease, kept and shaded sharp
def border_edges(bm):
    """edges between two faces of different materials (colour borders) and edges folding past CREASE"""
    mat, crease = [], []
    for e in bm.edges:
        if len(e.link_faces) != 2: continue
        a, b = e.link_faces
        if a.material_index != b.material_index: mat.append(e)
        elif e.calc_face_angle(0) > CREASE: crease.append(e)
    return mat, crease
def border_length(o):
    bm = bmesh.new(); bm.from_mesh(o.data); mat, _ = border_edges(bm)
    n = sum(e.calc_length() for e in mat); bm.free(); return n

def needle_faces(bm, ref):
    """long thin triangles: an edge over 1.5x the longest edge of the undecimated piece, and almost no area"""
    out = []
    for f in bm.faces:
        L = max(e.calc_length() for e in f.edges)
        if L > ref * 1.5 and f.calc_area() < 0.08 * L * L: out.append(f)
    return out

def decimate(o, faces):
    """Collapse-decimate to a face budget, then collapse any needle triangles it made. Cut hard (the old budgets were
    15-30% of the source), the decimator left needles up to half a piece long that stuck out as thin black lines, and
    faceted the curved parts. The budgets now keep 50-100% of each piece; locking the colour borders against collapse
    kept them no better and made more needles, so the borders rely on the budget instead."""
    n = len(o.data.polygons)
    bm = bmesh.new(); bm.from_mesh(o.data); ref = max(e.calc_length() for e in bm.edges); bm.free()
    if n > faces:
        m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = faces / n; m.use_collapse_triangulate = False
        vl.objects.active = o; bpy.ops.object.modifier_apply(modifier=m.name)
    bm = bmesh.new(); bm.from_mesh(o.data); fixed = 0
    for _ in range(4):
        long_ngons = [f for f in bm.faces if len(f.verts) > 3 and max(e.calc_length() for e in f.edges) > ref * 1.5]
        if long_ngons: bmesh.ops.triangulate(bm, faces=long_ngons)
        bad = needle_faces(bm, ref)
        if not bad: break
        edges = list({min(f.edges, key=lambda e: e.calc_length()) for f in bad})
        bmesh.ops.collapse(bm, edges=edges); fixed += len(edges)
        bmesh.ops.dissolve_degenerate(bm, dist=ref * 0.001, edges=bm.edges)
    left = len(needle_faces(bm, ref))
    bm.to_mesh(o.data); bm.free(); o.data.update()
    return len(o.data.polygons), fixed, left

def hard_normals(o):
    """Hard-surface shading: smooth within a panel, split at creases (past CREASE) and colour borders. Smooth normals
    across the creases bent through flat panels and the toon ramp and contour ink smeared black across them."""
    me = o.data
    me.shade_smooth(); me.set_sharp_from_angle(angle=CREASE)
    bm = bmesh.new(); bm.from_mesh(me); mat, _ = border_edges(bm)
    for e in mat: e.smooth = False
    n = sum(1 for e in bm.edges if not e.smooth); bm.to_mesh(me); bm.free(); me.update()
    return n

def merge_slots(o):
    """one slot per game material (several source materials recolour to the same one), so only real colour
    borders count as borders"""
    mats = [s.material for s in o.material_slots]; uniq = []
    for m in mats:
        if m not in uniq: uniq.append(m)
    remap = [uniq.index(m) for m in mats]
    idx = [remap[p.material_index] for p in o.data.polygons]
    o.data.materials.clear()
    for m in uniq: o.data.materials.append(m)
    o.data.polygons.foreach_set('material_index', idx); o.data.update()

def base_colour(mat):
    if mat and mat.use_nodes:
        b = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if b: return tuple(b.inputs['Base Color'].default_value)[:3]
    return (1, 1, 1)

def recolour(o, force=None):
    """white -> team colour, red/blue -> trim, black/grey -> dark. Small dark materials (under 5% of the piece's
    faces) are the maker's lettering and logos ("TRUE" on the blocker, glove and pads): they take the body colour
    so the brand disappears into the panel around it."""
    share = [0] * len(o.material_slots)
    for p in o.data.polygons: share[p.material_index] += 1
    total = max(1, len(o.data.polygons)); out = []
    for i, slot in enumerate(o.material_slots):
        c = base_colour(slot.material)
        lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; sat = max(c) - min(c)
        m = BODY if lum > 0.5 and sat < 0.25 else DARK if lum < 0.15 or (sat < 0.1 and lum < 0.5) else TRIM
        if m is DARK and share[i] / total < 0.05: m = BODY
        slot.material = force or m
        out.append(slot.material.name)
    return sorted(set(out))

def verts(o): return [o.matrix_world @ v.co for v in o.data.vertices]
def bbox(o):
    p = verts(o); return (Vector((min(q.x for q in p), min(q.y for q in p), min(q.z for q in p))), Vector((max(q.x for q in p), max(q.y for q in p), max(q.z for q in p))))

def transform(o, M):
    """apply a world-space matrix to the mesh data (the object keeps an identity transform)"""
    o.data.transform(M); o.data.update()

def absorb_decals(o, frac=0.08):
    """The maker's lettering ("TRUE": red letters on the pads' white edge strip, white letters cut into the red
    side panels, more on the blocker and glove) is made of faces of another material inside a panel, joined to it
    once the seams are welded, so it is not a loose island. Flood-fill regions of one material across the welded
    mesh; a region smaller than `frac` of the piece takes the material of the faces around it. Raised lettering is
    also pressed flat onto the surface around it (its inner vertices onto the plane through its rim): with crisp
    normals and enough faces kept, raised letters still read as relief even in the panel's colour."""
    import numpy as np
    bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
    lo, hi = bbox(o); lim = (hi - lo).length * frac
    seen = set(); changed = 0
    for f in bm.faces:
        if f.index in seen: continue
        mi = f.material_index; stack = [f]; reg = []; border = {}
        while stack:
            x = stack.pop()
            if x.index in seen: continue
            seen.add(x.index); reg.append(x)
            for e in x.edges:
                for y in e.link_faces:
                    if y.material_index == mi:
                        if y.index not in seen: stack.append(y)
                    else: border[y.material_index] = border.get(y.material_index, 0) + 1
        if not border: continue
        pts = [v.co for x in reg for v in x.verts]
        size = (Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))) - Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))).length
        if size < lim:
            to = max(border, key=border.get)
            for x in reg: x.material_index = to
            changed += len(reg)
            inside = {x.index for x in reg}
            verts = {v for x in reg for v in x.verts}
            rim = [v for v in verts if any(g.index not in inside for g in v.link_faces)]
            if len(rim) >= 3:
                P = np.array([tuple(v.co) for v in rim]); c = P.mean(0); nrm = Vector(np.linalg.svd(P - c)[2][2]); c = Vector(c)
                # only lettering raised off a flat panel: a region wrapping round a curved part (a band round the
                # stick's shaft) has a rim far off any one plane, and pressing it flat would squash the part
                if max(abs((v.co - c).dot(nrm)) for v in rim) < 0.05 * size:
                    for v in verts:
                        if v not in rim: v.co = v.co - nrm * (v.co - c).dot(nrm)
    bmesh.ops.dissolve_degenerate(bm, dist=(hi - lo).length * 1e-4, edges=bm.edges)
    bm.to_mesh(o.data); bm.free(); o.data.update()
    return changed

def prep(name, meshes, faces, force=None, frac=0.06, decal=0.08):
    o = copy_join(meshes, name)
    # seams first (so a panel is one island), then drop the small islands (raised lettering, stitching), then the
    # full weld: welding wider before the drop fuses the raised letters onto the panels under them. Then lettering
    # set into the panels takes the panel's colour.
    # Recolour before decimating, so the decimator protects only the borders between the game colours.
    n0 = len(o.data.polygons)
    weld(o, 0.00002); isl, gone = drop_small(o, frac); weld(o); dec = absorb_decals(o, decal)
    mats = recolour(o, force); merge_slots(o); b0 = border_length(o)
    f, fixed, left = decimate(o, faces); weld(o); sharp = hard_normals(o)
    b1 = border_length(o)
    return o, (name, f'{n0}->{f} faces', 'needles fixed/left', fixed, left, 'islands', isl, gone, 'decal faces', dec, mats, 'sharp edges', sharp,
               'colour border length after/before', round(b1 / b0, 2) if b0 else None, 'non-manifold', non_manifold(o))

report = []
for p in [x for x in bpy.data.objects if x.name.startswith(('g_pad', 'g_knee', 'g_blocker', 'g_stick'))]: bpy.data.objects.remove(p)

# ---------------------------------------------------------------- leg pads
def skin_pad(pad, s):
    """The pad is skinned, not rigid on the calf: below the knee it rides on the calf, its knee block (above the
    knee) on the thigh, blended over about 10 cm, so a bent knee carries the knee block with the thigh instead of
    pushing the thigh out through it. The fitted (stance) shape is carried back to the rest pose through the
    blended bone matrices, since a skinned mesh is stored in its rest shape."""
    knee = hd('calf_' + s)
    up = (hd('thigh_' + s) - knee).normalized()
    def D(b): return W @ P[b].matrix @ arm.data.bones[b].matrix_local.inverted() @ W.inverted()
    Dc, Dt = D('calf_' + s), D('thigh_' + s)
    gc = pad.vertex_groups.new(name='calf_' + s); gt = pad.vertex_groups.new(name='thigh_' + s)
    for v in pad.data.vertices:
        u = (v.co - knee).dot(up)
        t = max(0.0, min(1.0, (u + 0.03) / 0.10)); wt = t * t * (3 - 2 * t)
        M = Dc * (1 - wt) + Dt * wt
        v.co = M.inverted() @ v.co
        if wt < 1: gc.add([v.index], 1 - wt, 'REPLACE')
        if wt > 0: gt.add([v.index], wt, 'REPLACE')
    pad.data.update()
    pad.parent = arm; pad.matrix_parent_inverse = arm.matrix_world.inverted()
    m = pad.modifiers.new('rig', 'ARMATURE'); m.object = arm
    vl.update()
def evaluated_pts(o):
    dg = bpy.context.evaluated_depsgraph_get(); e = o.evaluated_get(dg); me = e.to_mesh()
    pts = [e.matrix_world @ v.co for v in me.vertices]; e.to_mesh_clear(); return pts
pair, r = prep('pads_pair', group_meshes('Cube_3'), 14000, frac=0.075); report.append(r)   # pads are built from many panels: drop specks, stitch dashes and the 3-5 cm "TRUE" letters on the edge strip (under 5.5 cm; the smallest real parts are 5.8 cm)
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
    skin_pad(pad, s); report.append(('g_pad_' + s, len(pad.data.polygons)))
bpy.data.objects.remove(pair)

# ---------------------------------------------------------------- blocker (stick hand) and catching glove
def hand_centre(s):
    """centre of the posed hand mesh (outfit vertices on the hand and finger bones). The gear goes around the hand
    itself, not the wrist bone: placed off the bone the bare hand stuck 4-7 cm out of the glove and blocker."""
    out = bpy.data.objects['skater_outfit']; dg = bpy.context.evaluated_depsgraph_get(); ev = out.evaluated_get(dg); me = ev.to_mesh()
    names = {g.index: g.name for g in out.vertex_groups}
    def is_hand(n): return n.endswith('_' + s) and n.split('_')[0] in ('hand', 'thumb', 'index', 'middle', 'ring', 'pinky')
    pts = [ev.matrix_world @ v.co for v in me.vertices if sum(g.weight for g in out.data.vertices[v.index].groups if is_hand(names.get(g.group, ''))) > 0.5]
    ev.to_mesh_clear()
    lo_ = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))); hi_ = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return (lo_ + hi_) / 2
def on_hand(o, side, offset):
    lo_, hi_ = bbox(o); c = (lo_ + hi_) / 2
    transform(o, Matrix.Translation(hand_centre(side) + Vector(offset)) @ Matrix.Scale(S, 4) @ Matrix.Translation(-c))
    attach(o, 'hand_' + side)
bl, r = prep('g_blocker', group_meshes('Cube.001_2'), 9000, decal=0.14); report.append(r)   # its "TRUE" letters are 12-13% of the blocker, its stripes 35% and up
on_hand(bl, 'r', (-0.01, 0.04, 0.05))   # board on the back of the hand, reaching up past the knuckles
gl, r = prep('g_glove', group_meshes('Cube.003_5') + group_meshes('NurbsPath.043_80'), 14000, decal=0.10); report.append(r)   # its lettering is 5-9% of the glove, its smallest real panel 21%
on_hand(gl, 'l', (0.02, -0.01, 0.04))   # hand deep in the glove, the pocket above it (4 cm further forward than before: kept at full detail, the pocket is thinner and the fist showed through it)

# ---------------------------------------------------------------- stick: held at the top of the paddle, blade flat on the ice
# A goalie holds the stick in the blocker hand where the shaft meets the paddle; the paddle leans forward to the
# blade, which lies flat on the ice in front of the skates with its toe toward the glove side, and the shaft runs up
# past the blocker. (It was fitted from the hand's top down to the ice before, held like a staff.)
st, r = prep('g_stick', group_meshes('Cube.002_4'), 1500, force=DARK, frac=0.02); report.append(r)   # one dark colour: no maker's name on it (the raised letters share the shaft's vertices, so they stay as bumps; the game draws no shell on the stick)
import numpy as np
PTS = verts(st)
top = max(PTS, key=lambda q: q.z)                                    # knob
L0 = max((q - top).length for q in PTS)
zmin = min(q.z for q in PTS); low = [q for q in PTS if q.z < zmin + 0.04 * (top.z - zmin)]
heel = min(low, key=lambda q: (q - top).length); toe = max(low, key=lambda q: (q - top).length)
shaft = np.array([tuple(q) for q in PTS if (q - top).length < 0.4 * L0])
ax = Vector(np.linalg.svd(shaft - shaft.mean(0))[2][0])               # shaft axis, knob -> blade
if ax.dot(heel - top) < 0: ax = -ax
edge = (toe - heel).normalized()                                   # blade bottom edge, heel -> toe
face = ax.cross(edge).normalized()                                     # paddle / blade face normal
# paddle top: walking down the shaft from the knob, the first band clearly wider than the shaft
side = face.cross(ax).normalized()
def width(t0, t1):
    w = [(q - top).dot(side) for q in PTS if t0 <= (q - top).dot(ax) < t1]
    return (max(w) - min(w)) if len(w) > 2 else 0.0
Lax = (heel - top).dot(ax); bands = [i * Lax / 40 for i in range(41)]
ws = [width(bands[i], bands[i + 1]) for i in range(40)]
shaft_w = sorted(w for w in ws[:12] if w > 0)[len([w for w in ws[:12] if w > 0]) // 2]
ip = next(i for i in range(40) if ws[i] > 1.6 * shaft_w)
grip_s = top + ax * bands[ip]                                          # on the axis at the paddle top
k = 1.5 / (heel - top).length                                          # a goalie stick: ~1.5 m knob to heel
# lay it with the blade edge along +X (toe to the glove side), face to the shooter (-Y), shaft up
E = Vector((1, 0, 0)); N = Vector((0, -1, 0))
def basis(x, y): x = x.normalized(); y = (y - x * y.dot(x)).normalized(); return Matrix((x, y, x.cross(y))).transposed()
R0 = basis(E, N) @ basis(edge, face).inverted()
if (R0 @ (-ax)).z < 0: R0 = basis(E, -N) @ basis(edge, face).inverted()
HC = hand_centre('r')
def place(theta):
    """stick in world space: lie as built, paddle tilted back toward the goalie by theta about the blade edge,
    blade on the ice, paddle top at the blocker hand (x, y)"""
    Rt = Matrix.Rotation(theta, 3, E)
    M = (Rt @ R0).to_4x4() @ Matrix.Scale(k, 4)
    pts = [M @ (q - heel) for q in PTS]; g = M @ (grip_s - heel)
    z0 = min(q.z for q in pts)
    T = Vector((HC.x - g.x, HC.y - g.y, 0.012 - z0))
    return Matrix.Translation(T) @ M @ Matrix.Translation(-heel), g.z - z0 + 0.012
best = min((abs(place(math.radians(a))[1] - HC.z), a) for a in range(-10, 61))
Mst, gz = place(math.radians(best[1]))
if (Mst @ toe).y > (Mst @ grip_s).y: Mst, gz = place(math.radians(-best[1]))
transform(st, Mst)
attach(st, 'hand_r')
STICK_FIT = {'tilt_deg': best[1], 'grip_to_hand_cm': round(((Mst @ grip_s) - HC).length * 100, 1),
             'blade_ahead_of_hand_cm': round((HC.y - (Mst @ heel).y) * 100), 'heel_x': round((Mst @ heel).x, 2),
             'length_m': 1.5, 'paddle_top_frac': round(bands[ip] / Lax, 2)}
report.append(('stick fit', STICK_FIT))

# ---------------------------------------------------------------- mask on the head, sized to the helmet
hel = bpy.data.objects['helmet3']
dg = bpy.context.evaluated_depsgraph_get(); e = hel.evaluated_get(dg); me = e.to_mesh()
hp = [e.matrix_world @ v.co for v in me.vertices]; e.to_mesh_clear()
hlo = Vector((min(p.x for p in hp), min(p.y for p in hp), min(p.z for p in hp))); hhi = Vector((max(p.x for p in hp), max(p.y for p in hp), max(p.z for p in hp)))
mk_src = [o for o in group_meshes(MASK)]
shell = [o for o in mk_src if o.material_slots and 'back' in o.material_slots[0].material.name.lower()]
cage_src = [o for o in mk_src if o not in shell]
mk, r = prep('g_mask', shell, 14000, force=BODY); report.append(r)
cg, r = prep('g_cage', cage_src, 6600, force=DARK, frac=0.0); report.append(r)
Rz = Matrix.Rotation(math.radians(90), 4, 'Z')   # the file's face points -X; ours points -Y
for o in (mk, cg): transform(o, Rz)
mlo, mhi = bbox(mk); mc = (mlo + mhi) / 2
Sm = (hhi.x - hlo.x) * 1.12 / (mhi.x - mlo.x)
hc = (hlo + hhi) / 2 + Vector((0, -0.015, -0.03))
for o in (mk, cg):
    transform(o, Matrix.Translation(hc) @ Matrix.Scale(Sm, 4) @ Matrix.Translation(-mc))
    attach(o, 'Head')

# ---------------------------------------------------------------- settle the gear on the ice in every goalie clip
# The pads are rigid on the shins and the feet are pinned to the ice, so when a save flares the shins (butterfly,
# pad kicks) the pads swing up to 10 cm into the ice; the goalie stick is longer than the skater stick that
# animate.py keeps above the ice. On each keyed frame: lift a foot target until its pad rests on the ice (the skate
# comes off the ice, as in a real butterfly) and lift the blocker hand until the goalie stick clears it.
import json
CL = json.load(open('/Users/brianyao/claude-web-game/assets/src/skater/clips.json'))
FTG = {s: bpy.data.objects['foot_tgt_' + s] for s in 'lr'}; SCTL = bpy.data.objects['hand_tgt_r']   # the blocker hand holds the stick; the stick control also carries the glove
def low_z(name):
    return min(q.z for q in evaluated_pts(bpy.data.objects[name]))   # evaluated: the pads are skinned
def lift(o, dz, f):
    Mw = o.matrix_world.copy(); Mw.translation.z += dz; o.matrix_world = Mw; vl.update(); o.keyframe_insert('location', frame=f)
settled = {}
for c in ('goalie', 'g_butterfly', 'g_glove', 'g_blocker', 'g_pad_l', 'g_pad_r'):
    s0, s1 = CL[c]['start'], CL[c]['end']; most = 0.0
    for f in range(s0, s1 + 1, 2):
        sc.frame_set(f)
        for _ in range(6):
            dz = {s: 0.015 - low_z('g_pad_' + s) for s in 'lr'}; ds = 0.01 - low_z('g_stick')
            if max(dz.values()) <= 0.002 and ds <= 0.002: break
            for s in 'lr':
                if dz[s] > 0.002: lift(FTG[s], dz[s], f); most = max(most, dz[s])
            if ds > 0.002: lift(SCTL, ds, f); most = max(most, ds)
            sc.frame_set(f)
    settled[c] = round(most * 100, 1)
worst_ice = {}
for c in ('goalie', 'g_butterfly', 'g_glove', 'g_blocker', 'g_pad_l', 'g_pad_r'):
    lo_ = 9.0
    for f in range(CL[c]['start'], CL[c]['end'] + 1):
        sc.frame_set(f); lo_ = min(lo_, low_z('g_pad_l'), low_z('g_pad_r'), low_z('g_stick'))
    worst_ice[c] = round(lo_ * 100, 1)
sc.frame_set(CL['goalie']['start'])
report.append(('lifted cm', settled)); report.append(('lowest gear point cm', worst_ice))

for n in (SET, MASK):
    for o in [bpy.data.objects[n], *bpy.data.objects[n].children_recursive]: o.hide_set(True); o.hide_render = True
print('imported gear', report, 'set scale', round(S, 3))
