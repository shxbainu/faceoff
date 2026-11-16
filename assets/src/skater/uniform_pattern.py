# The uniform's colour pattern: one material for jersey, breezers, socks and gloves, whose
# team / trim split is drawn per pixel from the body's rest-pose position (a 'rest' attribute stored
# on the mesh before the skeleton moves it). Every border is a clean designed line (shoulder yoke,
# thin-thick-thin stripes on sleeves, hem and socks, a side stripe down the breezers) and stays put
# when the body bends. The trim mask is also written out as 'trim' so the game export can bake it.
# Run inside Blender after build_outfit.py builds 'skater_outfit'.
import bpy

HEM = 0.93; KNEE = 0.60; SKATE = 0.20; CUFF = 0.62; GLOVE = 0.665
TEAM = (0.86, 0.86, 0.84, 1); TRIM = (0.62, 0.05, 0.05, 1)

def build_material():
    m = bpy.data.materials.get('uniform') or bpy.data.materials.new('uniform')
    m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); N = nt.nodes; Lk = nt.links
    col = [0]
    def node(t, **kw):
        n = N.new(t); n.location = (col[0] * 160, 0); col[0] += 1
        for k, v in kw.items(): setattr(n, k, v)
        return n
    def math(op, a, b=None, clamp=False):
        n = node('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, x in enumerate((a, b)):
            if x is None: continue
            if isinstance(x, (int, float)): n.inputs[i].default_value = x
            else: Lk.new(x, n.inputs[i])
        return n.outputs[0]
    gt = lambda a, v: math('GREATER_THAN', a, v)
    lt = lambda a, v: math('LESS_THAN', a, v)
    AND = lambda *xs: _fold('MULTIPLY', xs)
    OR = lambda *xs: _fold('MAXIMUM', xs)
    def _fold(op, xs):
        r = xs[0]
        for x in xs[1:]: r = math(op, r, x)
        return r
    NOT = lambda a: math('SUBTRACT', 1.0, a)
    band = lambda v, a, b: AND(gt(v, a), lt(v, b))
    def stripes(v, base):   # thin - thick - thin, starting at base and going up
        return OR(band(v, base, base + 0.014), band(v, base + 0.028, base + 0.078), band(v, base + 0.092, base + 0.106))

    attr = node('ShaderNodeAttribute', attribute_name='rest'); sep = node('ShaderNodeSeparateXYZ')
    Lk.new(attr.outputs['Vector'], sep.inputs[0])
    X = math('ABSOLUTE', sep.outputs[0]); Y = sep.outputs[1]; Z = sep.outputs[2]

    arm = AND(gt(Z, 1.2), gt(X, 0.24))
    # sleeves and gloves (the arm runs along X in the rest pose)
    glove = gt(X, CUFF)
    glove_band = band(X, 0.636, 0.648)
    sleeve = AND(NOT(glove), stripes(X, 0.468))
    cap = AND(lt(X, 0.36), gt(Z, math('ADD', 1.425, math('MULTIPLY', math('SUBTRACT', X, 0.24), 0.8))))  # yoke over the shoulder cap
    arm_trim = OR(AND(glove, NOT(glove_band)), sleeve, cap)
    # jersey body: yoke dipping to a point on the chest and back, collar band, stripes above the hem
    dip = math('MULTIPLY', math('SUBTRACT', 1.0, math('MINIMUM', math('DIVIDE', X, 0.2), 1.0)), 0.045)
    yoke = gt(Z, math('SUBTRACT', 1.425, dip))
    collar = AND(gt(Z, 1.468), lt(X, 0.17))
    jersey_trim = AND(gt(Z, HEM), OR(yoke, collar, stripes(Z, HEM + 0.018)))
    # breezers: trim colour with a team-colour stripe down the outside of each leg
    lx = math('SUBTRACT', X, 0.125); ly = math('SUBTRACT', Y, 0.03)
    leg_side = gt(math('DIVIDE', lx, math('ADD', math('SQRT', math('ADD', math('MULTIPLY', lx, lx), math('MULTIPLY', ly, ly))), 1e-4)), 0.955)
    hx = math('DIVIDE', X, 0.195); hy = math('DIVIDE', ly, 0.14)
    hip_side = gt(math('DIVIDE', hx, math('ADD', math('SQRT', math('ADD', math('MULTIPLY', hx, hx), math('MULTIPLY', hy, hy))), 1e-4)), 0.975)
    side = OR(AND(lt(Z, 0.86), leg_side), AND(gt(Z, 0.86), hip_side))
    pants = AND(gt(Z, KNEE), lt(Z, HEM))
    pants_trim = AND(pants, NOT(side))
    # socks: team colour with stripes below the knee
    sock_trim = AND(gt(Z, SKATE), lt(Z, KNEE), stripes(Z, 0.30))
    body_trim = OR(jersey_trim, pants_trim, sock_trim)
    trim = math('ADD', AND(arm, arm_trim), AND(NOT(arm), body_trim), clamp=True)

    mix = node('ShaderNodeMix', data_type='RGBA'); mix.inputs[6].default_value = TEAM; mix.inputs[7].default_value = TRIM
    Lk.new(trim, mix.inputs[0])
    # neck guard: a dark collar hugging the neck, above the trim collar band
    ny = math('SUBTRACT', Y, 0.025)
    rn = math('SQRT', math('ADD', math('MULTIPLY', X, X), math('MULTIPLY', ny, ny)))
    neck = AND(gt(Z, 1.49), lt(rn, 0.078), NOT(arm))   # round neckline
    mix2 = node('ShaderNodeMix', data_type='RGBA'); mix2.inputs[7].default_value = (0.03, 0.03, 0.035, 1)
    Lk.new(mix.outputs[2], mix2.inputs[6]); Lk.new(neck, mix2.inputs[0]); mix = mix2
    bsdf = node('ShaderNodeBsdfPrincipled'); outn = node('ShaderNodeOutputMaterial')
    Lk.new(mix.outputs[2], bsdf.inputs['Base Color'])
    # fabrics: knit jersey is matte, breezer nylon and glove leather have a soft sheen
    shiny = OR(pants, AND(arm, glove))
    rough = node('ShaderNodeMapRange'); Lk.new(shiny, rough.inputs[0])
    rough.inputs[3].default_value = 0.78; rough.inputs[4].default_value = 0.42
    Lk.new(rough.outputs[0], bsdf.inputs['Roughness'])
    # fine knit texture on the jersey only
    noise = node('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 900; Lk.new(attr.outputs['Vector'], noise.inputs['Vector'])
    bump = node('ShaderNodeBump'); bump.inputs['Distance'].default_value = 0.0004
    Lk.new(noise.outputs[0], bump.inputs['Height']); Lk.new(math('MULTIPLY', NOT(shiny), 0.35), bump.inputs['Strength'])
    Lk.new(bump.outputs[0], bsdf.inputs['Normal'])
    Lk.new(bsdf.outputs[0], outn.inputs[0])
    aov = None
    return m

def apply(o):
    me = o.data
    a = me.attributes.get('rest') or me.attributes.new('rest', 'FLOAT_VECTOR', 'POINT')
    a.data.foreach_set('vector', [c for v in me.vertices for c in v.co])
    m = build_material()
    if 'uniform' not in me.materials: me.materials.append(m)
    ui = list(me.materials).index(m)
    cloth = {list(me.materials).index(bpy.data.materials[n]) for n in ('team_body', 'team_trim', 'neck_guard') if n in me.materials}
    for p in me.polygons:
        if p.material_index in cloth: p.material_index = ui
    return m

apply(bpy.data.objects['skater_outfit'])
print('uniform pattern applied')
