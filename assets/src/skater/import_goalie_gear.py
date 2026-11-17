# Imported goalie gear: fits real models onto the skater rig. Run inside Blender after animate.py and
# build_goalie_gear.py (it uses that script's helpers and the posed goalie stance), with the source models already
# imported into the scene (MCP for Blender: import_asset from Sketchfab).
#
# Sources (CC-BY 4.0, credit both in the game's credits):
#   "True L12.2 CP31 Version" by YeaBoiiiiiiiii  https://sketchfab.com/3d-models/5ace50e9a12d4c029614820d3112dcb3
#       leg pads, blocker, catching glove, goalie stick (brand names on it are removed below)
#   "Hockey Goalie Mask" by matyprokop09          https://sketchfab.com/3d-models/12fe01ffe0d4443b96292815bb79958a
#
# For each part in PARTS: join its source pieces, drop small loose islands (embossed brand text), decimate to a
# game budget, recolour (white -> gear_body = team colour, red/blue -> gear_trim = trim colour, black/grey ->
# gear_dark), scale it to the size given in the rig's own measure (pad height = knee to boot, and so on), turn it
# to face forward, place it, and parent it to its bone. The procedural pieces it replaces are deleted.
#
# PARTS is filled in after the first import, once the source objects' names and axes are known: `src` lists the
# source object names (or name prefixes), `rot` the Euler turn (degrees) that makes the part face -Y with +Z up.
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler

exec(open('/Users/brianyao/claude-web-game/assets/src/skater/build_goalie_gear.py').read())   # helpers, materials, posed stance

PARTS = {
    # name:        src (source objects), bone, size (m, the part's longest side), anchor (world point fn), rot, faces
    # 'g_pad_l':   dict(src=[...], bone='calf_l',  size=None, rot=(0, 0, 0), faces=2500),
    # 'g_pad_r':   dict(src=[...], bone='calf_r',  size=None, rot=(0, 0, 0), faces=2500),
    # 'g_blocker': dict(src=[...], bone='hand_r',  size=0.38, rot=(0, 0, 0), faces=1200),
    # 'g_glove':   dict(src=[...], bone='hand_l',  size=0.40, rot=(0, 0, 0), faces=1500),
    # 'g_stick':   dict(src=[...], bone='hand_r',  size=1.55, rot=(0, 0, 0), faces=600),
    # 'g_mask':    dict(src=[...], bone='Head',    size=None, rot=(0, 0, 0), faces=2500),
}
REPLACES = {'g_pad_l': ['g_pad_l', 'g_padstripe_l'], 'g_pad_r': ['g_pad_r', 'g_padstripe_r'], 'g_blocker': ['g_blocker'],
            'g_stick': ['g_stick_']}

def sources(names):
    return [o for o in bpy.data.objects if o.type == 'MESH' and any(o.name == n or o.name.startswith(n) for n in names)]

def join(objs, name):
    for o in sc.objects: o.select_set(False)
    for o in objs: o.hide_set(False); o.select_set(True)
    vl.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = vl.objects.active; o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o

def drop_small_islands(o, keep_frac=0.02):
    """brand text and logos are small loose pieces sitting on the surface: delete islands under keep_frac of the
    largest island's bounding-box diagonal (squared ratio of volume is too strict for thin pads)"""
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
    seen, islands = set(), []
    for v in bm.verts:
        if v.index in seen: continue
        stack, isl = [v], []
        while stack:
            u = stack.pop()
            if u.index in seen: continue
            seen.add(u.index); isl.append(u)
            stack.extend(e.other_vert(u) for e in u.link_edges)
        islands.append(isl)
    def diag(isl):
        xs = [u.co for u in isl]; lo = Vector((min(c.x for c in xs), min(c.y for c in xs), min(c.z for c in xs)))
        hi = Vector((max(c.x for c in xs), max(c.y for c in xs), max(c.z for c in xs))); return (hi - lo).length
    big = max(diag(i) for i in islands)
    gone = [u for isl in islands if diag(isl) < big * keep_frac * 10 and len(isl) < 400 for u in isl]
    bmesh.ops.delete(bm, geom=gone, context='VERTS'); bm.to_mesh(o.data); bm.free()
    return len(islands), len(gone)

def decimate(o, faces):
    n = len(o.data.polygons)
    if n <= faces: return n
    m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = faces / n
    vl.objects.active = o; bpy.ops.object.modifier_apply(modifier=m.name)
    return len(o.data.polygons)

def recolour(o):
    """every source material becomes one of the three gear materials by its base colour"""
    mats = []
    for slot in o.material_slots:
        m = slot.material; c = (1, 1, 1)
        if m and m.use_nodes:
            b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if b: c = tuple(b.inputs['Base Color'].default_value)[:3]
        lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; sat = max(c) - min(c)
        slot.material = BODY if lum > 0.55 and sat < 0.25 else DARK if lum < 0.18 or sat < 0.12 else TRIM
        mats.append(slot.material.name)
    return mats

def place(o, bone, size, rot, centre, forward_offset=0.0):
    """turn to face forward, scale so the longest side is `size`, centre it on `centre`, attach to the bone"""
    o.rotation_euler = Euler([math.radians(a) for a in rot]); vl.update()
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); vl.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))); hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    if size: o.scale *= size / max(hi - lo)
    vl.update()
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    c = Vector((sum(p.x for p in pts), sum(p.y for p in pts), sum(p.z for p in pts))) / len(pts)
    o.location += centre - c + Vector((0, -forward_offset, 0)); vl.update()
    attach(o, bone)

def fit_all():
    done = []
    for name, cfg in PARTS.items():
        src = sources(cfg['src'])
        if not src: print('missing source for', name); continue
        for old in [x for x in bpy.data.objects if any(x.name.startswith(p) for p in REPLACES.get(name, [name]))]: bpy.data.objects.remove(old)
        o = join(src, name)
        isl, gone = drop_small_islands(o)
        f = decimate(o, cfg.get('faces', 2000))
        mats = recolour(o)
        place(o, cfg['bone'], cfg.get('size'), cfg.get('rot', (0, 0, 0)), cfg['centre'](), cfg.get('fwd', 0.0))
        done.append((name, f, isl, gone, sorted(set(mats))))
    print('imported gear', done)

if PARTS: fit_all()
else: print('PARTS is empty: import the Sketchfab models, inspect their object names and axes, then fill it in')
