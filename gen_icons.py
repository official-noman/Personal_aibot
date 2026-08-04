"""Generate PWA icons (regular + maskable) with a gradient background and a check+moon motif."""
from PIL import Image, ImageDraw
import math


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    top = (99, 102, 241)     # indigo-500
    bottom = (139, 92, 246)  # violet-500

    # background: rounded square (regular) or full bleed (maskable)
    radius = int(size * 0.22)
    for y in range(size):
        d.line([(0, y), (size, y)], fill=lerp(top, bottom, y / size))

    if not maskable:
        # mask corners to rounded square
        mask = Image.new("L", (size, size), 0)
        md = ImageDraw.Draw(mask)
        md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
        img.putalpha(mask)

    # crescent moon (upper area) drawn on its own layer, then pasted
    moon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mdl = ImageDraw.Draw(moon)
    mr = size * 0.17
    mcx, mcy = size * 0.42, size * 0.38
    mdl.ellipse([mcx - mr, mcy - mr, mcx + mr, mcy + mr], fill=(255, 255, 255, 245))
    off = mr * 0.62
    # cut out an offset circle to form the crescent
    mdl.ellipse([mcx - mr + off, mcy - mr - off * 0.35,
                 mcx + mr + off, mcy + mr - off * 0.35], fill=(0, 0, 0, 0))
    img.alpha_composite(moon)

    # checkmark (lower-right)
    cw = max(6, int(size * 0.05))
    p1 = (size * 0.48, size * 0.66)
    p2 = (size * 0.59, size * 0.77)
    p3 = (size * 0.80, size * 0.50)
    d.line([p1, p2, p3], fill=(255, 255, 255, 255), width=cw, joint="curve")

    return img


for s in (192, 512):
    draw_icon(s, maskable=False).save(f"icons/icon-{s}.png")
    draw_icon(s, maskable=True).save(f"icons/maskable-{s}.png")

# apple touch icon
draw_icon(180, maskable=False).save("icons/apple-touch-icon.png")
print("icons generated")
