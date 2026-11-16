# Sends a Qwen-Image-Edit 2511 job (GGUF, Lightning 4-step) to the local ComfyUI and waits for the image.
# Usage: python3 qwen_edit.py <input image name in ComfyUI input/> <output prefix> "<prompt>" [seed] [steps]
import json, sys, time, urllib.request
URL = 'http://127.0.0.1:8188'
img, prefix, prompt = sys.argv[1], sys.argv[2], sys.argv[3]
seed = int(sys.argv[4]) if len(sys.argv) > 4 else 7
steps = int(sys.argv[5]) if len(sys.argv) > 5 else 4
lightning = steps <= 8
MP = float(sys.argv[6]) if len(sys.argv) > 6 else 0.6   # smaller is much faster on this Mac
g = {
  '1': {'class_type': 'UnetLoaderGGUF', 'inputs': {'unet_name': 'qwen-image-edit-2511-Q4_K_M.gguf'}},
  '2': {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': ['1', 0], 'lora_name': 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors', 'strength_model': 1.0 if lightning else 0.0}},
  '3': {'class_type': 'ModelSamplingAuraFlow', 'inputs': {'model': ['2', 0], 'shift': 3.1}},
  '4': {'class_type': 'CFGNorm', 'inputs': {'model': ['3', 0], 'strength': 1.0}},
  '5': {'class_type': 'CLIPLoaderGGUF', 'inputs': {'clip_name': 'Qwen2.5-VL-7B-Instruct-Q6_K.gguf', 'type': 'qwen_image'}},
  '6': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'qwen_image_vae.safetensors'}},
  '7': {'class_type': 'LoadImage', 'inputs': {'image': img}},
  '8': {'class_type': 'ImageScaleToTotalPixels', 'inputs': {'image': ['7', 0], 'upscale_method': 'lanczos', 'megapixels': MP, 'resolution_steps': 16}},
  '9': {'class_type': 'TextEncodeQwenImageEditPlus', 'inputs': {'clip': ['5', 0], 'prompt': prompt, 'vae': ['6', 0], 'image1': ['8', 0]}},
  '10': {'class_type': 'TextEncodeQwenImageEditPlus', 'inputs': {'clip': ['5', 0], 'prompt': '', 'vae': ['6', 0], 'image1': ['8', 0]}},
  '11': {'class_type': 'FluxKontextMultiReferenceLatentMethod', 'inputs': {'conditioning': ['9', 0], 'reference_latents_method': 'index_timestep_zero'}},
  '12': {'class_type': 'FluxKontextMultiReferenceLatentMethod', 'inputs': {'conditioning': ['10', 0], 'reference_latents_method': 'index_timestep_zero'}},
  '13': {'class_type': 'VAEEncode', 'inputs': {'pixels': ['8', 0], 'vae': ['6', 0]}},
  '14': {'class_type': 'KSampler', 'inputs': {'model': ['4', 0], 'positive': ['11', 0], 'negative': ['12', 0], 'latent_image': ['13', 0],
          'seed': seed, 'steps': steps, 'cfg': 1.0 if lightning else 3.0, 'sampler_name': 'euler', 'scheduler': 'simple', 'denoise': 1.0}},
  '15': {'class_type': 'VAEDecode', 'inputs': {'samples': ['14', 0], 'vae': ['6', 0]}},
  '16': {'class_type': 'SaveImage', 'inputs': {'images': ['15', 0], 'filename_prefix': prefix}},
}
req = urllib.request.Request(URL + '/prompt', data=json.dumps({'prompt': g}).encode(), headers={'Content-Type': 'application/json'})
r = json.load(urllib.request.urlopen(req)); pid = r['prompt_id']; t0 = time.time()
while True:
    time.sleep(3)
    h = json.load(urllib.request.urlopen(f'{URL}/history/{pid}'))
    if pid in h:
        st = h[pid].get('status', {})
        if st.get('status_str') == 'error':
            print('ERROR', json.dumps(st.get('messages', [])[-1:])[:1500]); sys.exit(1)
        outs = [i['filename'] for o in h[pid]['outputs'].values() for i in o.get('images', [])]
        print(f'done in {time.time() - t0:.0f}s:', outs); break
