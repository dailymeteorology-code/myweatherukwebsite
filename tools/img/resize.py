"""A web-sized copy of an uploaded image (server/imageSizes.js runs this once per size).

    python resize.py SRC DST WIDTH

Never larger than the original; WebP at quality 82, which keeps a 5120 px, 12 MB forecast
graphic sharp on a phone at a few hundred kilobytes.
"""
import sys

from PIL import Image, ImageOps

src, dst, width = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = ImageOps.exif_transpose(Image.open(src))
if im.mode not in ('RGB', 'RGBA'):
    im = im.convert('RGBA' if 'A' in im.getbands() else 'RGB')
if im.width > width:
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
im.save(dst, 'WEBP', quality=82, method=5)
