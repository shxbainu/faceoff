# Batch sprite generation for the 2D skater, run against the local ComfyUI (Qwen-Image-Edit 2511 GGUF,
# Lightning 4-step, full 1 MP). Runs on its own; restart it any time, finished images are skipped.
#
# Consistency:
#   stage A  - each direction is redrawn from the one approved character (skater_ref.png), 3 seeds
#   stage B  - each pose uses TWO references: that direction's first drawing (pose/angle anchor) and the
#              original character (look anchor); same character text and seeds everywhere
#   sheets   - contact sheets per direction so whole sets can be compared side by side
#
# Usage: <ComfyUI venv python> batch_sprites.py     (logs to raw/batch.log)
import json, os, shutil, sys, time, urllib.request

URL = 'http://127.0.0.1:8188'
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
CIN = os.path.expanduser('~/ComfyUI-Shared/input')
COUT = os.path.expanduser('~/ComfyUI-Shared/output')
REF = 'skater_ref.png'
os.makedirs(RAW, exist_ok=True)
LOG = open(os.path.join(RAW, 'batch.log'), 'a', buffering=1)
def log(*a):
    line = time.strftime('%H:%M:%S ') + ' '.join(str(x) for x in a)
    print(line); LOG.write(line + '\n')

CHARACTER = ('Keep the identical cartoon hockey player: identical drawing style with thick dark ink outlines and flat '
             'two-tone shading, white jersey with a red shoulder yoke and red thin-thick-thin stripes on the sleeves and '
             'above the hem, red breezers with a white side stripe, white socks with red stripes, black skates, red gloves, '
             'red helmet with a dark visor, wooden stick with black tape, right-handed (blade on his right side). '
             'Same proportions and size. No puck. Full body in frame, viewed from a high camera looking down at about '
             '40 degrees. Plain flat light grey background.')
DIRS = {
    'back':    'seen from directly behind, facing away from the camera',
    'back34':  'seen from behind and to his right, a three-quarter back view, facing away from the camera at an angle',
    'side':    'seen from his right side, a side profile view, facing toward the right edge of the image',
    'front34': 'seen from the front and to his right, a three-quarter front view, turned toward the camera at an angle',
    'front':   'seen from the front, facing directly toward the camera',
}
POSES = {
    'ready':        'in a ready stance: knees bent, leaning forward, stick held in both hands with the blade flat on the ice',
    'stride_l1':    'skating: his left leg pushes out to the side and back, weight over his right skate, stick blade on the ice',
    'stride_l2':    'skating: his left leg fully extended out to the side and back, body low, stick blade on the ice',
    'stride_r1':    'skating: his right leg pushes out to the side and back, weight over his left skate, stick blade on the ice',
    'stride_r2':    'skating: his right leg fully extended out to the side and back, body low, stick blade on the ice',
    'glide':        'gliding on both skates, feet together and knees bent, stick blade on the ice',
    'wrist_draw':   'starting a wrist shot: stick blade drawn back beside his right skate, weight on his back leg',
    'wrist_flick':  'finishing a wrist shot: wrists rolled, stick blade swept forward and just off the ice, weight forward',
    'slap_windup':  'winding up a slapshot: stick raised high behind his right shoulder, body turned, knees bent',
    'slap_contact': 'mid slapshot: stick swinging down and striking the ice just in front of him, body low and twisted',
    'slap_follow':  'after a slapshot: follow-through with the stick high in front of him pointing forward',
    'pass':         'passing: sweeping the stick forward along the ice, blade turned toward the target',
    'check':        'body checking: lunging forward shoulder first, stick held low across his body',
    'poke':         'poke checking: reaching forward with one hand, stick extended along the ice toward the puck',
    'hit':          'being hit: knocked off balance, leaning backward, arms out, stick flying up',
    'fallen':       'fallen down, lying on his back on the ice, stick beside him',
}
SEEDS_A = [11, 23, 37]
SEEDS_B = [11, 23]

def graph(img1, img2, prompt, seed, prefix, mp=1.0):
    g = {
        '1': {'class_type': 'UnetLoaderGGUF', 'inputs': {'unet_name': 'qwen-image-edit-2511-Q4_K_M.gguf'}},
        '2': {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': ['1', 0], 'lora_name': 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors', 'strength_model': 1.0}},
        '3': {'class_type': 'ModelSamplingAuraFlow', 'inputs': {'model': ['2', 0], 'shift': 3.1}},
        '4': {'class_type': 'CFGNorm', 'inputs': {'model': ['3', 0], 'strength': 1.0}},
        '5': {'class_type': 'CLIPLoaderGGUF', 'inputs': {'clip_name': 'Qwen2.5-VL-7B-Instruct-Q6_K.gguf', 'type': 'qwen_image'}},
        '6': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'qwen_image_vae.safetensors'}},
        '7': {'class_type': 'LoadImage', 'inputs': {'image': img1}},
        '8': {'class_type': 'ImageScaleToTotalPixels', 'inputs': {'image': ['7', 0], 'upscale_method': 'lanczos', 'megapixels': mp, 'resolution_steps': 16}},
    }
    enc = {'clip': ['5', 0], 'vae': ['6', 0], 'image1': ['8', 0]}
    if img2:
        g['17'] = {'class_type': 'LoadImage', 'inputs': {'image': img2}}
        g['18'] = {'class_type': 'ImageScaleToTotalPixels', 'inputs': {'image': ['17', 0], 'upscale_method': 'lanczos', 'megapixels': mp, 'resolution_steps': 16}}
        enc['image2'] = ['18', 0]
    g['9'] = {'class_type': 'TextEncodeQwenImageEditPlus', 'inputs': {**enc, 'prompt': prompt}}
    g['10'] = {'class_type': 'TextEncodeQwenImageEditPlus', 'inputs': {**enc, 'prompt': ''}}
    g['11'] = {'class_type': 'FluxKontextMultiReferenceLatentMethod', 'inputs': {'conditioning': ['9', 0], 'reference_latents_method': 'index_timestep_zero'}}
    g['12'] = {'class_type': 'FluxKontextMultiReferenceLatentMethod', 'inputs': {'conditioning': ['10', 0], 'reference_latents_method': 'index_timestep_zero'}}
    g['13'] = {'class_type': 'VAEEncode', 'inputs': {'pixels': ['8', 0], 'vae': ['6', 0]}}
    g['14'] = {'class_type': 'KSampler', 'inputs': {'model': ['4', 0], 'positive': ['11', 0], 'negative': ['12', 0], 'latent_image': ['13', 0],
               'seed': seed, 'steps': 4, 'cfg': 1.0, 'sampler_name': 'euler', 'scheduler': 'simple', 'denoise': 1.0}}
    g['15'] = {'class_type': 'VAEDecode', 'inputs': {'samples': ['14', 0], 'vae': ['6', 0]}}
    g['16'] = {'class_type': 'SaveImage', 'inputs': {'images': ['15', 0], 'filename_prefix': prefix}}
    return g

def run(img1, img2, prompt, seed, dest):
    if os.path.exists(dest): return 'skip'
    prefix = 'batch/' + os.path.splitext(os.path.relpath(dest, RAW))[0].replace(os.sep, '_')
    body = json.dumps({'prompt': graph(img1, img2, prompt, seed, prefix)}).encode()
    pid = json.load(urllib.request.urlopen(urllib.request.Request(URL + '/prompt', data=body, headers={'Content-Type': 'application/json'})))['prompt_id']
    t0 = time.time()
    while True:
        time.sleep(5)
        h = json.load(urllib.request.urlopen(f'{URL}/history/{pid}'))
        if pid not in h: continue
        st = h[pid].get('status', {})
        if st.get('status_str') == 'error':
            log('ERROR', dest, json.dumps(st.get('messages', [])[-1:])[:600]); return 'error'
        files = [(i.get('subfolder', ''), i['filename']) for o in h[pid]['outputs'].values() for i in o.get('images', [])]
        if not files: continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy(os.path.join(COUT, files[0][0], files[0][1]), dest)
        return f'{time.time() - t0:.0f}s'

def sheet(direction):
    try:
        from PIL import Image
    except ImportError:
        return
    d = os.path.join(RAW, direction)
    files = sorted(f for f in os.listdir(d) if f.endswith('.png')) if os.path.isdir(d) else []
    if not files: return
    T = 320; cols = 8; rows = (len(files) + cols - 1) // cols
    S = Image.new('RGB', (cols * T, rows * (T + 24)), (40, 42, 50))
    from PIL import ImageDraw
    dr = ImageDraw.Draw(S)
    for i, f in enumerate(files):
        im = Image.open(os.path.join(d, f)).convert('RGB'); im.thumbnail((T, T))
        x, y = (i % cols) * T, (i // cols) * (T + 24)
        S.paste(im, (x, y)); dr.text((x + 4, y + T + 4), f[:-4], fill=(230, 230, 230))
    S.save(os.path.join(RAW, f'sheet_{direction}.png'))

def main():
    shutil.copy(os.path.join(HERE, 'gen', 'crop_gemini_full_res.png'), os.path.join(CIN, REF))
    jobs = []
    # stage A: every direction from the one approved character
    for seed in SEEDS_A:
        for dn, dv in DIRS.items():
            jobs.append(('A', dn, 'base', seed, REF, None, f'Show this exact same cartoon hockey player {dv}, in a ready stance with knees bent and the stick blade flat on the ice. {CHARACTER}'))
    # stage B: every pose, anchored to that direction's first drawing and to the original character
    for seed in SEEDS_B:
        for dn, dv in DIRS.items():
            for pn, pv in POSES.items():
                jobs.append(('B', dn, pn, seed, None, REF, f'Show the same hockey player from image 1, {dv}, {pv}. Keep him identical to image 1 and image 2. {CHARACTER}'))
    log(f'batch start: {len(jobs)} jobs')
    done = 0
    for stage, dn, pn, seed, img1, img2, prompt in jobs:
        dest = os.path.join(RAW, dn, f'{pn}_s{seed}.png')
        if stage == 'B':
            base = os.path.join(RAW, dn, f'base_s{SEEDS_A[0]}.png')
            if not os.path.exists(base): log('no base yet for', dn, '- skipping', pn); continue
            name = f'dirbase_{dn}.png'; shutil.copy(base, os.path.join(CIN, name)); img1 = name
        try:
            r = run(img1, img2, prompt, seed, dest)
        except Exception as e:
            log('FAILED', dest, repr(e)); time.sleep(20); continue
        done += 1
        if r != 'skip': log(f'[{done}/{len(jobs)}] {stage} {dn} {pn} seed {seed}: {r}'); sheet(dn)
    for dn in DIRS: sheet(dn)
    log('batch done')

if __name__ == '__main__':
    main()
