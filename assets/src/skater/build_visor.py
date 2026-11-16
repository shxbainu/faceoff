# Half visor: a clear, lightly smoked shield from the helmet brow down to just below the eyes,
# shaped from the head's own front so it follows the face. Replaces the full cage.
# Run inside Blender after build_outfit.py (needs 'SuperHero_Male' and 'Armature').
import bpy, bmesh
from mathutils import Vector

sc = bpy.context.scene; arm = bpy.data.objects['Armature']; src = bpy.data.objects['SuperHero_Male']
for n in ('visor_half',):
    x = bpy.data.objects.get(n)
    if x: bpy.data.objects.remove(x)
cage = bpy.data.objects.get('cage')
if cage: cage.hide_set(True); cage.hide_render = True

TOPZ, BOTZ = 1.742, 1.662   # brow to just under the eyes (rest pose, metres)
CX, CY = 0.0, 0.012         # centre of the head seen from above
RX, RY = 0.118, 0.142       # front of the helmet, as an ellipse
SPAN = 78                   # degrees each side of straight ahead (temple to temple)
me = bpy.data.meshes.new('visor_half'); bm = bmesh.new()
import math
cols, rows = 28, 6; grid = []
for j in range(rows + 1):
    t = j / rows; z = BOTZ + (TOPZ - BOTZ) * t
    flare = 0.012 * (1 - t)          # bottom edge stands off a little more
    row = []
    for i in range(cols + 1):
        a = math.radians(-SPAN + 2 * SPAN * i / cols)
        x = CX + (RX + flare) * math.sin(a); y = CY - (RY + flare) * math.cos(a)
        row.append(bm.verts.new((x, y, z)))
    grid.append(row)
for j in range(rows):
    for i in range(cols):
        bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
for f in bm.faces: f.smooth = True
bm.to_mesh(me); bm.free()
m = bpy.data.materials.get('visor_clear') or bpy.data.materials.new('visor_clear'); m.use_nodes = True
b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
b.inputs['Base Color'].default_value = (0.55, 0.62, 0.7, 1); b.inputs['Roughness'].default_value = 0.05
b.inputs['Alpha'].default_value = 0.32
try: m.surface_render_method = 'BLENDED'
except Exception: pass
m.use_backface_culling = False
me.materials.clear(); me.materials.append(m)
v = bpy.data.objects.new('visor_half', me); sc.collection.objects.link(v)
s = v.modifiers.new('thick', 'SOLIDIFY'); s.thickness = 0.004
vg = v.vertex_groups.new(name='Head'); vg.add(range(len(me.vertices)), 1.0, 'REPLACE')
v.parent = arm; a = v.modifiers.new('Armature', 'ARMATURE'); a.object = arm
print('visor faces', len(me.polygons))
