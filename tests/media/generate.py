"""Makes the small media files the upload tests use. Run once; the output is committed.

Needs: pip install pillow pillow-heif imageio-ffmpeg   (in a throwaway venv is fine)
Phone-like stand-ins (iPhone HEIC/MOV layout, Samsung HDR video) come from
generate_phone_like.py. Real phone files are better still: drop them in phone/ (git-ignored)
and run the media tests with PHONE_MEDIA=1.
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
# Like an Android phone: HEVC in an MP4. The site probes MP4s and converts only non-H.264 ones.
subprocess.run([ffmpeg, '-y', '-loglevel', 'error', *source, '-c:v', 'libx265', '-tag:v', 'hvc1',
                '-pix_fmt', 'yuv420p', '-crf', '32', '-c:a', 'aac', '-b:a', '64k', '-shortest',
                HERE / 'video-hevc.mp4'], check=True)
# Like a recent phone's HDR video: 10-bit HEVC with HLG colour. Must come out as 8-bit H.264,
# since 10-bit H.264 ("High 10") doesn't play on most browsers and phones.
subprocess.run([ffmpeg, '-y', '-loglevel', 'error', *source, '-c:v', 'libx265', '-tag:v', 'hvc1',
                '-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67',
                '-colorspace', 'bt2020nc', '-crf', '32', '-c:a', 'aac', '-b:a', '64k', '-shortest',
                HERE / 'video-hdr.mp4'], check=True)
# 4K: shrunk to 1080p on the server.
subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=3840x2160:rate=24:duration=2',
                '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', *encode, HERE / 'video-4k.mp4'], check=True)


# Not an image at all, just text with a .heic name: conversion must fail on it.
(HERE / 'broken.heic').write_text('This is not a real HEIC image. The upload tests use it to check what '
                                  'happens when conversion fails.\n')
print('done')
