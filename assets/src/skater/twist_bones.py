# Forearm twist bones. A real forearm turns the hand over along its whole length (radius rolls over
# ulna); the base rig has no twist bones, so any turn of the hand wrings the wrist like a candy wrapper.
# This adds three twist bones per forearm (at 1/3, 2/3 and the wrist) and moves each forearm vertex's
# 'lowerarm' weight onto them by how far down the forearm it sits. pose_ready.py then turns each twist
# bone by that share of the hand's twist. Run after build_outfit.py (it rebuilds the mesh weights).
import bpy
from mathutils import Vector

arm = bpy.data.objects['Armature']; out = bpy.data.objects['skater_outfit']
TW = [(1, 1 / 3), (2, 2 / 3), (3, 1.0)]   # (index, share of the hand twist)

def ensure_bones():
    vl = bpy.context.view_layer; prev = vl.objects.active
    for o in bpy.context.selected_objects: o.select_set(False)
    vl.objects.active = arm; arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); eb = arm.data.edit_bones
    for s in 'lr':
        low = eb['lowerarm_' + s]; d = (low.tail - low.head)
        for i, f in TW:
            n = f'lowerarm_twist_0{i}_{s}'
            b = eb.get(n) or eb.new(n)
            pos = low.head + d * min(f, 0.98)
            b.head = pos; b.tail = pos + d.normalized() * 0.05; b.roll = low.roll
            b.parent = low; b.use_connect = False; b.use_deform = True
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.select_set(False); vl.objects.active = prev

def reweight():
    B = arm.data.bones; gi = {g.name: g.index for g in out.vertex_groups}
    for s in 'lr':
        for i, f in TW:
            n = f'lowerarm_twist_0{i}_{s}'
            if n not in gi: gi[n] = out.vertex_groups.new(name=n).index
        a = B['lowerarm_' + s].head_local; b = B['lowerarm_' + s].tail_local; L = (b - a).length; ax = (b - a) / L
        stops = [('lowerarm_' + s, 0.0)] + [(f'lowerarm_twist_0{i}_{s}', f) for i, f in TW]
        low = gi['lowerarm_' + s]
        for v in out.data.vertices:
            w = next((g.weight for g in v.groups if g.group == low), 0.0)
            if w <= 0: continue
            t = max(0.0, min(1.0, (v.co - a).dot(ax) / L))
            for n, _ in stops: out.vertex_groups[n].remove([v.index])
            for k in range(len(stops) - 1):     # share w between the two stops around t
                (n0, f0), (n1, f1) = stops[k], stops[k + 1]
                if f0 <= t <= f1:
                    u = (t - f0) / (f1 - f0)
                    out.vertex_groups[n0].add([v.index], w * (1 - u), 'REPLACE')
                    if u > 0: out.vertex_groups[n1].add([v.index], w * u, 'REPLACE')
                    break

ensure_bones(); reweight()
print('twist bones ready')
