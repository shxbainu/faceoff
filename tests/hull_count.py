# Counts outline-shell pixels that show INSIDE a skater (poke-through), in frames rendered with ?hulldbg
# (shell drawn magenta). A magenta pixel counts as poke-through when no background pixel lies within
# 4 px of it, i.e. it is not part of the outline around the skater's edge.
# Usage: <python with PIL+numpy> tests/hull_count.py tests/out/look-hulldbg_*.png
import sys
import numpy as np
from PIL import Image
for f in sys.argv[1:]:
    a = np.asarray(Image.open(f).convert('RGB')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mag = (r > 170) & (g < 110) & (b > 170)
    mx, mn = a.max(-1), a.min(-1)
    bg = (mx > 175) & ((mx - mn) < 40) & ~mag            # pale ice and boards
    k = 4; near = np.zeros_like(bg)
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            near |= np.roll(np.roll(bg, dy, 0), dx, 1)
    inner = mag & ~near
    print(f'{f.split("/")[-1]:52s} shell px {int(mag.sum()):7d}   poke-through px {int(inner.sum()):6d}')
