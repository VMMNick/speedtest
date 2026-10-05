"""Генерує PNG-іконки PWA (192, 512, maskable 512, apple-touch 180) у public/icons/.

Запуск: python3 scripts/generate-icons.py  (потрібен Pillow)
Малюємо у 4× розмірі й зменшуємо — так краї згладжені.
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'public' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)
C1, C2 = (6, 182, 212), (37, 99, 235)  # cyan → blue


def gradient(size):
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + (size - y)) / (2 * size)  # діагональ знизу-зліва → вгору-вправо
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(C1, C2))
    return img


def draw(size, *, maskable=False, rounded=True):
    S = size * 4
    bg = gradient(S // 8).resize((S, S), Image.BICUBIC)
    mask = Image.new('L', (S, S), 0)
    md = ImageDraw.Draw(mask)
    if maskable or not rounded:
        md.rectangle([0, 0, S, S], fill=255)
    else:
        md.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    img.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(img)
    # Maskable: вміст у «безпечній зоні» (центральні 80%)
    scale = 0.62 if maskable else 0.78
    cx, cy = S / 2, S * 0.54
    r = S * scale / 2
    w = max(4, int(S * 0.075))
    box = [cx - r, cy - r, cx + r, cy + r]
    track = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(track).arc(box, 135, 405, fill=(255, 255, 255, 80), width=w)  # напівпрозорий трек
    img = Image.alpha_composite(img, track)
    d = ImageDraw.Draw(img)
    d.arc(box, 135, 330, fill=(255, 255, 255, 255), width=w)  # прогрес ~70%
    # Стрілка
    ang = math.radians(330)
    L = r * 0.78
    tip = (cx + L * math.cos(ang), cy + L * math.sin(ang))
    nw = S * 0.035
    perp = ang + math.pi / 2
    base1 = (cx + nw * math.cos(perp), cy + nw * math.sin(perp))
    base2 = (cx - nw * math.cos(perp), cy - nw * math.sin(perp))
    d.polygon([base1, tip, base2], fill=(255, 255, 255, 255))
    hub = S * 0.06
    d.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


draw(192).save(OUT / 'icon-192.png', optimize=True)
draw(512).save(OUT / 'icon-512.png', optimize=True)
draw(512, maskable=True).save(OUT / 'icon-maskable-512.png', optimize=True)
draw(180, rounded=False).convert('RGB').save(OUT / 'apple-touch-icon.png', optimize=True)
print('ok:', sorted(p.name for p in OUT.iterdir()))
