# Builds the skater outfit on the Quaternius CC0 "Superhero_Male" body (Universal Base Characters).
# Run inside Blender: exec(open(path).read()). Needs objects 'SuperHero_Male' and 'skater_outfit'
# (a copy of the body that keeps its armature modifier and vertex groups), and the outfit materials.
# Garments are shaped as loose cloth around the body, not inflated skin, so the jersey hangs and the
# breezers are boxy. Colour regions are decided on the original body positions, before reshaping,
# so every colour border is a clean edge loop.
import bpy, bmesh, math
from mathutils import Vector
from collections import Counter

YOKE = 1.45
HEM = 0.93; KNEE = 0.60; SKATE = 0.20; CUFF = 0.62; GLOVE = 0.665; COLLAR = 1.49; NECK_W = 0.095
E = 1e-4

def sstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
def lerp(a, b, t): return a + (b - a) * t
def superell(ang, a, b, p):
    c, s = math.cos(ang), math.sin(ang)
    return a * math.copysign(abs(c) ** (2 / p), c), b * math.copysign(abs(s) ** (2 / p), s)
def torso_ab(z):
    # jersey section: straight hang from the hem, widening into rounded shoulder pads
    a = lerp(0.195, 0.21, sstep(HEM, 1.30, z)); a = lerp(a, 0.245, sstep(1.32, 1.44, z))
    b = lerp(0.135, 0.148, sstep(HEM, 1.35, z))
    return a, b

def region(c, bone):
    ax = abs(c.x)
    if bone == 'Head': return 'head'
    if c.z > COLLAR - E and ax < NECK_W + E: return 'neck'
    if ax > GLOVE - E and c.z > 1.2: return 'glove'
    if ax > CUFF - E and c.z > 1.2: return 'cuff'
    if c.z > HEM - E:
        if c.z > 1.2 and 0.52 - E < ax < 0.57 + E: return 'stripe'
        if c.z > YOKE - E and NECK_W < ax < 0.22 and c.y > -0.06: return 'stripe'   # yoke: top of the shoulders only
        if c.z < HEM + 0.03 + E: return 'stripe'                         # double hem stripe
        if HEM + 0.05 - E < c.z < HEM + 0.08 + E: return 'stripe'
        return 'jersey'
    if c.z < SKATE + E: return 'skate'
    if c.z < KNEE + E: return 'stripe' if 0.36 - E < c.z < 0.41 + E else 'sock'
    if ax > 0.17 and abs(c.y - 0.035) < 0.022 and c.z < 0.88: return 'pstripe'   # breezer side stripe, down the thigh
    return 'pants'

REGION_MAT = {'jersey': 'team_body', 'stripe': 'team_trim', 'pants': 'team_trim', 'sock': 'team_body',
              'glove': 'team_trim', 'cuff': 'team_trim', 'skate': 'skate_boot', 'neck': 'neck_guard', 'head': 'skin', 'pstripe': 'team_body'}

def build():
    src = bpy.data.objects['SuperHero_Male']; o = bpy.data.objects['skater_outfit']
    old = o.data; o.data = src.data.copy(); bpy.data.meshes.remove(old)
    me = o.data; me.name = 'skater_outfit'
    gname = {g.index: g.name for g in o.vertex_groups}
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0008)
    cuts = [((0, 0, z), (0, 0, 1)) for z in (HEM, HEM + 0.03, HEM + 0.05, HEM + 0.08, KNEE, 0.36, 0.41, SKATE, COLLAR, YOKE, 0.88)]
    cuts += [((0, y, 0), (0, 1, 0)) for y in (0.013, 0.057, -0.06)]
    cuts += [((s * x, 0, 0), (1, 0, 0)) for s in (1, -1) for x in (CUFF, GLOVE, 0.52, 0.57, NECK_W, 0.22, 0.17)]
    for co, no in cuts:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table(); bm.normal_update()
    dl = bm.verts.layers.deform.active
    def bone(v):
        d = v[dl]
        return gname.get(max(d.items(), key=lambda kv: kv[1])[0], '') if len(d) else ''
    vbone = {v.index: bone(v) for v in bm.verts}
    # colour regions from the ORIGINAL positions (clean borders)
    fregion = [region(f.calc_center_median(), Counter(vbone[v.index] for v in f.verts).most_common(1)[0][0]) for f in bm.faces]
    vregion = {v.index: region(v.co, vbone[v.index]) for v in bm.verts}

    torso = [v for v in bm.verts if vregion[v.index] in ('jersey', 'stripe') and v.co.z > HEM - E and abs(v.co.x) < 0.33]
    for _ in range(12): bmesh.ops.smooth_vert(bm, verts=torso, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=False)
    for v in bm.verts:
        c = v.co.copy(); r = vregion[v.index]; ax = abs(c.x); sx = 1 if c.x >= 0 else -1
        if r in ('jersey', 'stripe') and c.z > 1.46 and ax < 0.16:
            continue   # collar ring stays on the body so the neckline is a clean edge
        if r in ('jersey', 'stripe') and c.z > HEM - E and (ax < 0.30 or c.z < 1.2):
            a, b = torso_ab(c.z); ang = math.atan2((c.y - 0.02) / b, c.x / a); px, py = superell(ang, a, b, 2.4)
            w = 1 - sstep(0.24, 0.33, ax) if c.z > 1.2 else 1
            v.co = c.lerp(Vector((px, 0.02 + py, c.z)), w); c = v.co.copy()
            if 0.13 < ax < 0.32 and c.z > 1.34:   # sloped shoulder pads
                v.co.z -= 0.06 * ((ax - 0.13) / 0.19) ** 2 * sstep(1.34, 1.5, c.z); c = v.co.copy()
        if r in ('jersey', 'stripe', 'cuff') and ax > 0.22 and c.z > 1.2:
            R = 0.064 if r == 'cuff' else lerp(0.08, 0.066, sstep(0.25, 0.6, ax))
            axis = Vector((c.x, 0.07, 1.456)); d = c - axis; d.x = 0
            if d.length > 1e-5: v.co = c.lerp(axis + d.normalized() * R, sstep(0.22, 0.32, ax))
        if r in ('pants', 'pstripe'):
            if c.z > 0.86:
                a, b = 0.195, 0.14; ang = math.atan2((c.y - 0.03) / b, c.x / a); px, py = superell(ang, a, b, 2.4)
                v.co = Vector((px, 0.03 + py, c.z))
            else:
                axis = Vector((sx * 0.125, 0.03, c.z)); d = c - axis; d.z = 0
                if d.length > 1e-5: v.co = axis + d.normalized() * lerp(0.098, 0.106, sstep(KNEE, 0.86, c.z))
        if r in ('sock', 'stripe') and SKATE < c.z < KNEE + E:
            t = (KNEE - c.z) / (KNEE - SKATE); axis = Vector((sx * 0.114, lerp(0.036, 0.08, t), c.z)); d = c - axis; d.z = 0
            if d.length > 1e-5: v.co = axis + d.normalized() * (0.062 if d.y < 0 else 0.052)
    # knee: breezer cuff blends into the shin pad, with a knee cap in front
    for v in bm.verts:
        c = v.co
        if KNEE - 0.11 < c.z < KNEE + 0.04 and c.z > 0.3 and abs(c.x) < 0.3:
            sx = 1 if c.x >= 0 else -1; t = sstep(KNEE - 0.11, KNEE + 0.04, c.z)
            ay = 0.036 + 0.044 * max(0, (KNEE - c.z) / (KNEE - 0.2))
            axis = Vector((sx * (0.114 + 0.011 * t), ay * (1 - t) + 0.03 * t, c.z)); d = c - axis; d.z = 0
            if d.length < 1e-5: continue
            front = d.normalized().y < 0
            R = (0.066 if front else 0.054) * (1 - t) + 0.098 * t
            if front: R += 0.01 * max(0, 1 - abs(c.z - (KNEE - 0.05)) / 0.05)
            v.co = axis + d.normalized() * R
    bm.normal_update()
    gl = [v for v in bm.verts if vregion[v.index] == 'glove']
    for _ in range(2): bmesh.ops.smooth_vert(bm, verts=gl, factor=0.3, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    sk = [v for v in bm.verts if vregion[v.index] == 'skate']
    for _ in range(10): bmesh.ops.smooth_vert(bm, verts=sk, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    for v in gl: v.co += v.normal * (0.03 if abs(v.co.x) < GLOVE + 0.05 else 0.012)  # padded back of hand, slim fingers
    for v in sk: v.co += v.normal * 0.02
    cl = [v for v in bm.verts if vregion[v.index] in ('jersey', 'stripe', 'pants', 'pstripe', 'sock', 'cuff')]
    for _ in range(3): bmesh.ops.smooth_vert(bm, verts=cl, factor=0.4, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    from mathutils import noise
    for v in bm.verts:
        r = vregion[v.index]; c = v.co
        if r in ('jersey', 'stripe') and c.z > HEM - E:
            # soft vertical drape folds plus a little crumple, strongest low on the jersey where it hangs
            hang = 1 - sstep(1.15, 1.42, c.z)
            fold = 0.006 * math.sin(math.atan2(c.y - 0.02, c.x) * 9 + c.z * 3) * hang
            v.co += v.normal * (fold + 0.004 * noise.noise(c * 14))
        elif r in ('pants', 'pstripe'):
            # breezers: horizontal padding ridges and a little crumple
            v.co += v.normal * (0.005 * max(0, math.sin(c.z * 70)) + 0.003 * noise.noise(c * 16))
        elif r == 'sock' and c.z < KNEE - 0.06:
            v.co += v.normal * 0.003 * noise.noise(c * 22)
        if r in ('jersey', 'stripe') and c.z > 1.2 and 0.38 < abs(c.x) < 0.48:
            # elbow pad bump under the sleeve
            v.co += v.normal * 0.012 * max(0, 1 - abs(abs(c.x) - 0.43) / 0.05)

    names = ['team_body', 'team_trim', 'skate_boot', 'neck_guard', 'skin']
    me.materials.clear()
    for n in names: me.materials.append(bpy.data.materials[n])
    idx = {n: i for i, n in enumerate(names)}
    for f, r in zip(bm.faces, fregion):
        f.material_index = idx[REGION_MAT[r]]; f.smooth = True
    bm.to_mesh(me); bm.free()
    # corrective smooth after the skeleton: stops the padded shoulders pinching when the arms come down
    if not any(m.type == 'CORRECTIVE_SMOOTH' for m in o.modifiers):
        cs = o.modifiers.new('settle', 'CORRECTIVE_SMOOTH'); cs.factor = 0.6; cs.iterations = 12; cs.rest_source = 'ORCO'
        cs.smooth_type = 'LENGTH_WEIGHTED'
    return Counter(fregion)

result = build()
print(result)
