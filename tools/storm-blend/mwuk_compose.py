"""Assemble the frames captured from the real graphic (server/uploads/*shot_NNN.jpg) into the
MWUK MP4: model + time chip, rain/strike key, end hold and the closing MWUK card.

    python mwuk_compose.py out.mp4
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

import mwuk as M

UP = os.path.join('..', '..', 'server', 'uploads')
FPS, HOLD = 12, 18


def main():
    out = sys.argv[1]
    man = json.load(open(os.path.join(UP, 'mwukshot', 'manifest.json')))
    shots = {}
    for n in os.listdir(UP):
        m = re.search(r'shot_(\d{3})\.jpg$', n)
        if m:
            shots[int(m.group(1))] = os.path.join(UP, n)
    frames = [shots[i] for i in range(man['frames'])]
    first = Image.open(frames[0]); W, H = first.size
    S = W / 640
    start = datetime.fromisoformat(man['start']); tz = ZoneInfo('Europe/London')
    fb = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', int(15 * S))
    fs = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', int(9 * S))
    proc = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                             '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'slow',
                             '-movflags', '+faststart', out], stdin=subprocess.PIPE)
    last = None
    for f in range(len(frames) + HOLD):
        i = min(f, len(frames) - 1)
        frame = Image.open(frames[i]).convert('RGBA')
        d = ImageDraw.Draw(frame)
        when = (start + timedelta(hours=i / man['fph'])).astimezone(tz)
        label = f"MWUK   {when:%a %H:%M}".upper()
        bx1, by0 = (640 - 14) * S, 92 * S
        tw = d.textlength(label, font=fb)
        d.rounded_rectangle([bx1 - tw - 22 * S, by0, bx1, by0 + 26 * S], radius=13 * S, fill=(10, 14, 32, 230), outline=(125, 211, 252, 200), width=max(1, int(S)))
        d.text((bx1 - tw - 11 * S, by0 + 5 * S), label, font=fb, fill=(255, 255, 255, 255))
        ky = by0 + 32 * S; kx0 = bx1 - 150 * S
        d.rounded_rectangle([kx0, ky, bx1, ky + 34 * S], radius=9 * S, fill=(10, 14, 32, 220))
        for n in range(100):
            c = tuple(int(x) for x in M.palette(np.array([0.1 * (300 ** (n / 99))]))[0])
            d.rectangle([kx0 + 8 * S + n * 0.8 * S, ky + 6 * S, kx0 + 8 * S + (n + 1) * 0.8 * S, ky + 13 * S], fill=c + (255,))
        d.text((kx0 + 8 * S, ky + 16 * S), 'RAIN  light → heavy', font=fs, fill=(226, 232, 240, 255))
        d.ellipse([bx1 - 50 * S, ky + 6 * S, bx1 - 43 * S, ky + 13 * S], fill=(255, 214, 64, 255))
        d.text((bx1 - 40 * S, ky + 5 * S), 'STRIKES', font=fs, fill=(226, 232, 240, 255))
        d.text((bx1 - 40 * S, ky + 16 * S), '(model)', font=fs, fill=(148, 163, 184, 255))
        last = frame.convert('RGB')
        proc.stdin.write(np.asarray(last).tobytes())
    # closing card
    logo_path = next((os.path.join(UP, n) for n in sorted(os.listdir(UP), reverse=True) if n.endswith('logo.png')), None)
    logo = Image.open(logo_path).convert('RGBA').resize((int(150 * S), int(150 * S)), Image.LANCZOS) if logo_path else None
    ft = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', int(24 * S))
    fm = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', int(62 * S))
    fsm = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', int(13 * S))
    for f in range(int(4.5 * FPS)):
        a = min(1, f / (0.8 * FPS))
        card = Image.new('RGBA', (W, H), (6, 4, 15, 255)); cd = ImageDraw.Draw(card)
        cx, cy = W / 2, H / 2
        if logo:
            card.alpha_composite(logo, (int(cx - logo.width / 2), int(cy - 230 * S)))
        for txt, font, y, col in [("Outlook made with MyWeatherUK's", ft, cy - 40 * S, (226, 232, 240)), ('New Weather Model', ft, cy - 8 * S, (226, 232, 240)),
                                  ('MWUK', fm, cy + 34 * S, (125, 211, 252)), ('UKV · HARMONIE · ECMWF · MET OFFICE GLOBAL · GFS', fsm, cy + 122 * S, (148, 163, 184))]:
            cd.text((cx - cd.textlength(txt, font=font) / 2, y), txt, font=font, fill=col + (255,))
        proc.stdin.write(np.asarray(Image.blend(last, card.convert('RGB'), a)).tobytes())
    proc.stdin.close(); proc.wait()
    print('wrote', out)


if __name__ == '__main__':
    main()
