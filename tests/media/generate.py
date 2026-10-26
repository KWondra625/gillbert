"""Makes the small media files the upload tests use. Run once; the output is committed.

Needs: pip install pillow pillow-heif imageio-ffmpeg   (in a throwaway venv is fine)
Real phone files (an iPhone HEIC and MOV, ideally one portrait) are better tests of the
conversion and rotation paths; drop them in this folder as phone-*.heic / phone-*.mov.
"""
import subprocess
from pathlib import Path

import imageio_ffmpeg
import pillow_heif
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
pillow_heif.register_heif_opener()


def test_image(w, h, label):
    img = Image.new('RGB', (w, h), (30, 110, 160))
    d = ImageDraw.Draw(img)
    d.rectangle([w // 10, h // 10, w * 9 // 10, h * 9 // 10], outline=(255, 210, 60), width=8)
    d.text((w // 8, h // 2), f'E2E test {label}', fill=(255, 255, 255))
    return img


img = test_image(640, 480, 'landscape')
img.save(HERE / 'photo.jpg', quality=80)
img.save(HERE / 'photo.jpeg', quality=80)
img.save(HERE / 'photo.png', optimize=True)
img.convert('P', palette=Image.ADAPTIVE, colors=32).save(HERE / 'photo.gif')
img.save(HERE / 'photo.webp', quality=70)
img.save(HERE / 'photo.heic', quality=60)
img.save(HERE / 'photo.heif', quality=60)
test_image(480, 640, 'portrait').save(HERE / 'photo-portrait.heic', quality=60)

ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
source = ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=2',
          '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2']
encode = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-c:a', 'aac', '-b:a', '64k', '-shortest']
subprocess.run([ffmpeg, '-y', '-loglevel', 'error', *source, *encode, HERE / 'video.mp4'], check=True)
subprocess.run([ffmpeg, '-y', '-loglevel', 'error', *source, *encode, '-f', 'mov', HERE / 'video.mov'], check=True)
# Like a phone held upright: landscape pixels plus a rotation flag the player must honor.
subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-display_rotation', '90', '-i', HERE / 'video.mov',
                '-c', 'copy', HERE / 'video-portrait.mov'], check=True)
print('done')
