# Exports the animated skater as assets/models/skater.glb for the 3D build.
# Run inside Blender after pose_ready.py, rig_controls.py and animate.py.
#  1. Bakes the uniform pattern (and every other outfit colour) into one texture on the body's UVs:
#     white = team colour, red = trim colour, which the game re-tints per team.
#  2. Bakes each clip from clips.json into its own action (visual keys, so the IK, the stick
#     controller and the twist bones are all captured), then drops the controls.
#  3. Exports armature, outfit, helmet, visor, blades and stick (the stick rides on the right hand).
# The .blend is not saved: rebuild with build_outfit -> build_visor -> pose_ready -> rig_controls ->
# animate before running this again.
import bpy, json, os

ROOT = '/Users/brianyao/claude-web-game/'
SRC = ROOT + 'assets/src/skater/'
OUTF = ROOT + 'assets/models/skater.glb'
TEX = 1024
sc = bpy.context.scene; vl = bpy.context.view_layer
arm = bpy.data.objects['Armature']; out = bpy.data.objects['skater_outfit']
PARTS = ['skater_outfit', 'helmet3', 'visor_half', 'blade_l', 'blade_r', 'stick']

def select_only(objs, active):
    for o in sc.objects: o.select_set(False)
    for o in objs: o.hide_set(False); o.select_set(True)
    vl.objects.active = active

# ---------------------------------------------------------------- 1. texture bake
def bake_texture():
    me = out.data
    img = bpy.data.images.get('skater_tex') or bpy.data.images.new('skater_tex', TEX, TEX)
    img.scale(TEX, TEX)
    if me.uv_layers.get('UVMap'): me.uv_layers.active = me.uv_layers['UVMap']
    nodes = []
    for m in me.materials:
        n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.image = img; m.node_tree.nodes.active = n; nodes.append((m, n))
    prev = sc.render.engine
    try: sc.render.engine = 'CYCLES'
    except TypeError: pass
    sc.cycles.samples = 4; sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False
    sc.render.bake.margin = 4
    select_only([out], out)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True)
    for m, n in nodes: m.node_tree.nodes.remove(n)
    sc.render.engine = prev
    img.filepath_raw = SRC + 'skater_tex.png'; img.file_format = 'PNG'; img.save()
    return img

def export_material(img):
    m = bpy.data.materials.get('skater_export') or bpy.data.materials.new('skater_export'); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
    b = nt.nodes.new('ShaderNodeBsdfPrincipled'); b.inputs['Roughness'].default_value = 0.7
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(t.outputs[0], b.inputs['Base Color']); nt.links.new(b.outputs[0], o.inputs[0])
    return m

# ---------------------------------------------------------------- 2. animation bake
def bake_clips():
    clips = json.load(open(SRC + 'clips.json'))
    select_only([arm], arm); bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    for n in clips:                      # old bakes of the same clips
        if bpy.data.actions.get(n): bpy.data.actions.remove(bpy.data.actions[n])
    actions = []; orig = arm.animation_data.action
    for name, c in clips.items():
        arm.animation_data.action = orig     # always sample the authored timeline, not the last bake
        bpy.ops.nla.bake(frame_start=c['start'], frame_end=c['end'], step=1, only_selected=False,
                         visual_keying=True, clear_constraints=False, clear_parents=False,
                         use_current_action=False, bake_types={'POSE'})
        a = arm.animation_data.action; a.name = name; a.use_fake_user = True
        # clips start at frame 0
        shift = c['start']
        for fc in fcurves_of(a):
            for k in fc.keyframe_points:
                k.co.x -= shift; k.handle_left.x -= shift; k.handle_right.x -= shift
        actions.append(a)
    bpy.ops.object.mode_set(mode='OBJECT')
    return actions

def fcurves_of(a):
    if hasattr(a, 'fcurves') and len(getattr(a, 'fcurves', [])): return a.fcurves
    res = []
    for layer in getattr(a, 'layers', []):
        for strip in layer.strips:
            for cb in strip.channelbags: res.extend(cb.fcurves)
    return res

def drop_controls():
    sc.frame_set(1)
    st = bpy.data.objects['stick']; Mw = st.matrix_world.copy()
    st.parent = arm; st.parent_type = 'BONE'; st.parent_bone = 'hand_r'; vl.update(); st.matrix_world = Mw
    for pb in arm.pose.bones:
        for c in list(pb.constraints): pb.constraints.remove(c)

# ---------------------------------------------------------------- 2b. clips from the Quaternius library
# Universal Animation Library (CC0) uses this same skeleton, so its clips play on the skater directly.
# 'fall' = Death01 with the backward slide removed (the game already moves a knocked-down skater);
# only the drop of the hips is kept.
def library_clip(name, src):
    old = bpy.data.actions.get(name)
    if old: bpy.data.actions.remove(old)
    a = bpy.data.actions[src].copy(); a.name = name; a.use_fake_user = True
    curves = {f.array_index: f for f in fcurves_of(a) if f.data_path == 'pose.bones["pelvis"].location'}
    if 1 in curves and 2 in curves:
        B = arm.data.bones['pelvis'].matrix_local.to_3x3(); ay, az = B.col[1], B.col[2]   # local y/z in armature space
        fy, fz = curves[1], curves[2]
        frames = sorted({round(k.co.x) for f in (fy, fz) for k in f.keyframe_points})
        ly0, lz0 = fy.evaluate(frames[0]), fz.evaluate(frames[0])
        back0 = ly0 * ay.y + lz0 * az.y
        vals = []
        for fr in frames:
            ly, lz = fy.evaluate(fr), fz.evaluate(fr)
            up = ly * ay.z + lz * az.z                 # keep the drop
            # back/forward stays at its first value: solve local y/z for (back0, up)
            det = ay.y * az.z - az.y * ay.z
            vals.append((fr, (back0 * az.z - az.y * up) / det, (ay.y * up - back0 * ay.z) / det))
        for f in (fy, fz):
            while f.keyframe_points: f.keyframe_points.remove(f.keyframe_points[0])
        for fr, ly, lz in vals:
            fy.keyframe_points.insert(fr, ly); fz.keyframe_points.insert(fr, lz)
    return a

# ---------------------------------------------------------------- 3. export
def export(actions, mat):
    me = out.data; saved = list(me.materials); saved_idx = [p.material_index for p in me.polygons]
    me.materials.clear(); me.materials.append(mat)
    for p in me.polygons: p.material_index = 0
    arm.animation_data.action = None
    ad = arm.animation_data   # one NLA track per clip: the exporter writes exactly these animations
    for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
    for a in actions:
        t = ad.nla_tracks.new(); t.name = a.name; t.strips.new(a.name, 0, a)
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.scale = (1, 1, 1)
    objs = [arm] + [bpy.data.objects[n] for n in PARTS]
    select_only(objs, arm)
    # export from a collection holding only the skater, so nothing from other scenes slips in
    col = bpy.data.collections.get('export_skater') or bpy.data.collections.new('export_skater')
    if col.name not in sc.collection.children: sc.collection.children.link(col)
    for o in objs:
        if o.name not in col.objects: col.objects.link(o)
    vl.active_layer_collection = vl.layer_collection.children[col.name]
    bpy.ops.export_scene.gltf(filepath=OUTF, use_selection=False, use_active_collection=True, use_active_scene=True, export_format='GLB', export_apply=True,
                              export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True,
                              export_def_bones=True, export_image_format='WEBP', export_yup=True,
                              export_extras=False, export_cameras=False, export_lights=False)
    for o in objs: col.objects.unlink(o)
    for t in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(t)   # so re-posing starts clean
    sc.collection.children.unlink(col); vl.active_layer_collection = vl.layer_collection
    me.materials.clear()                        # back to the editable outfit materials
    for m in saved: me.materials.append(m)
    for p, i in zip(me.polygons, saved_idx): p.material_index = i
    return saved

if bpy.context.object and bpy.context.object.mode != 'OBJECT': bpy.ops.object.mode_set(mode='OBJECT')
img = bake_texture(); mat = export_material(img)
acts = bake_clips(); drop_controls()
acts.append(library_clip('fall', 'Death01'))
saved = export(acts, mat)
print('exported', OUTF, os.path.getsize(OUTF) // 1024, 'KB', [a.name for a in acts])
