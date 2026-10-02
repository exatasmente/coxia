"""Redraws resources/icon.png at the PWA sizes, crisp (supersampled). Run: python3 scripts/pwa-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'src/renderer/public'
BG = (18, 22, 28, 255)
TEAL = (94, 234, 212, 255)
# Geometry measured on the 256 px original: bar center x, top and bottom.
BARS = [(58, 107, 148), (93, 88, 167), (127.5, 68, 187), (162, 88, 167), (197, 107, 148)]
BAR_W = 19
SS = 4


def draw(size: int, rounded: bool, scale: float) -> Image.Image:
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.22), fill=BG)
    else:
        d.rectangle((0, 0, big, big), fill=BG)
    k = big / 256
    for cx, top, bottom in BARS:
        cx = 128 + (cx - 128) * scale
        top = 128 + (top - 128) * scale
        bottom = 128 + (bottom - 128) * scale
        half = BAR_W * scale / 2
        d.rounded_rectangle((int((cx - half) * k), int(top * k), int((cx + half) * k), int(bottom * k)), radius=int(half * k), fill=TEAL)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
draw(192, True, 1).save(OUT / 'icon-192.png', optimize=True)
draw(512, True, 1).save(OUT / 'icon-512.png', optimize=True)
# Maskable: the platform crops it to its own shape, so the art stays inside the central 80 %.
draw(512, False, 0.7).save(OUT / 'icon-maskable-512.png', optimize=True)
draw(180, False, 0.8).save(OUT / 'apple-touch-icon.png', optimize=True)
