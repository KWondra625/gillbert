"""Makes small, committable stand-ins for real phone photos and videos (Gillbert #33).

Run once; the output is committed. Needs the same tools as generate.py:
    pip install pillow pillow-heif imageio-ffmpeg   (in a throwaway venv is fine)

The real phone files in phone/ are git-ignored (they're personal). These are made from test
patterns but copy the traits that matter to the site's conversion, taken from real files
(an iPhone 16 Pro HEIC and MOV, a Samsung Galaxy S25+ HDR video):

  phone-like-iphone.heic           portrait HEIC with Apple camera fields and a colour profile,
                                   stored upright (like an edited or screenshot-style photo)
  phone-like-iphone-rotated.heic   how an iPhone actually stores a portrait photo: sideways
                                   pixels plus a HEIF "irot" box (angle 3 = turn 90° clockwise),
                                   which pillow-heif writes from EXIF orientation 6. Must come
                                   out upright.
  phone-like-iphone.mov            QuickTime file laid out like an iPhone's: audio before video,
                                   a second (4-channel) audio track, a timecode data track
                                   (stands in for Apple's metadata tracks) and Apple metadata
  phone-like-iphone-portrait.mov   the same, held upright (rotation flag)
  phone-like-android-hdr.mp4       Samsung-style: 10-bit HLG HEVC in an MP4, held upright,
                                   with Android metadata

Not reproduced (tools can't write them): the HEIC's HDR gain map and Apple's spatial audio
(APAC) and "mebx" metadata tracks. The converter only keeps the first video and first audio
stream, so stand-in extra tracks exercise the same path.
"""
import subprocess
from pathlib import Path

import imageio_ffmpeg
import pillow_heif
from PIL import Image, ImageCms, ImageDraw

HERE = Path(__file__).parent
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
pillow_heif.register_heif_opener()


def pattern(w, h, label):
    img = Image.new('RGB', (w, h), (40, 90, 60))
    d = ImageDraw.Draw(img)
    d.rectangle([w // 12, h // 12, w * 11 // 12, h * 11 // 12], outline=(250, 200, 40), width=10)
    # An arrow pointing at the top, so a sideways result is obvious when looked at
    d.polygon([(w // 2, h // 6), (w // 2 - w // 8, h // 3), (w // 2 + w // 8, h // 3)], fill=(255, 255, 255))
    d.text((w // 10, h // 2), f'E2E test {label} (top)', fill=(255, 255, 255))
    return img


def apple_exif(orientation):
    exif = Image.Exif()
    exif[0x010F] = 'Apple'                    # Make
    exif[0x0110] = 'iPhone 16 Pro'            # Model
    exif[0x0131] = '18.6.2'                   # Software
    exif[0x013C] = 'iPhone 16 Pro'            # HostComputer
    exif[0x0112] = orientation                # Orientation
    ifd = exif.get_ifd(0x8769)                # Exif IFD
    ifd[0x9003] = '2026:01:01 12:00:00'       # DateTimeOriginal
    ifd[0xA433] = 'Apple'                     # LensMake
    ifd[0xA434] = 'iPhone 16 Pro back triple camera 6.765mm f/1.78'  # LensModel
    return exif.tobytes()


SRGB_ICC = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()

# Portrait, like an iPhone photo (3:4), at a small size
pattern(756, 1008, 'iPhone portrait').save(
    HERE / 'phone-like-iphone.heic', quality=60, exif=apple_exif(1), icc_profile=SRGB_ICC)
# Landscape pixels plus "rotate 90° clockwise" (EXIF orientation 6): the upright portrait picture
# stored turned 90° counter-clockwise (PIL's rotate(90)), so it must display portrait, arrow up
pattern(756, 1008, 'iPhone rotated').rotate(90, expand=True).save(
    HERE / 'phone-like-iphone-rotated.heic', quality=60, exif=apple_exif(6), icc_profile=SRGB_ICC)


def run(*args):
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', *map(str, args)], check=True)


video_src = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2']
stereo = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2']
quad = ['-f', 'lavfi', '-i', 'sine=frequency=660:duration=2']
apple_meta = ['-movflags', 'use_metadata_tags',
              '-metadata', 'com.apple.quicktime.make=Apple',
              '-metadata', 'com.apple.quicktime.model=iPhone 16 Pro',
              '-metadata', 'com.apple.quicktime.software=18.6.2',
              '-metadata', 'com.apple.quicktime.creationdate=2026-01-01T12:00:00+0000']
# iPhone order: AAC stereo, a second audio track, then H.264 video, then a data track
iphone_layout = ['-map', '1:a', '-map', '2:a', '-map', '0:v',
                 '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '30',
                 '-c:a', 'aac', '-b:a', '64k', '-ac:a:0', '2', '-ac:a:1', '4',
                 '-metadata:s:a:0', 'handler_name=Core Media Audio',
                 '-metadata:s:a:1', 'handler_name=Core Media Audio',
                 '-metadata:s:v:0', 'handler_name=Core Media Video',
                 '-timecode', '00:00:00:00', '-shortest', '-f', 'mov']
run(*video_src, *stereo, *quad, *iphone_layout, *apple_meta, HERE / 'phone-like-iphone.mov')
# Held upright: same file with a rotation flag (copied, not re-encoded)
run('-display_rotation', '90', '-i', HERE / 'phone-like-iphone.mov',
    '-map', '0', '-c', 'copy', '-movflags', 'use_metadata_tags', '-f', 'mov', HERE / 'phone-like-iphone-portrait.mov')

# Samsung-style HDR video held upright: 10-bit HLG HEVC in an MP4, rotation flag, Android metadata
run(*video_src, *stereo, '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc',
    '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', '-crf', '32',
    '-c:a', 'aac', '-b:a', '64k', '-shortest',
    '-movflags', 'use_metadata_tags', '-metadata', 'com.android.version=15',
    '-metadata', 'com.android.manufacturer=samsung', '-metadata', 'com.android.model=SM-S936U',
    HERE / 'phone-like-android-hdr-tmp.mp4')
run('-display_rotation', '-90', '-i', HERE / 'phone-like-android-hdr-tmp.mp4',
    '-map', '0', '-c', 'copy', '-movflags', 'use_metadata_tags', HERE / 'phone-like-android-hdr.mp4')
(HERE / 'phone-like-android-hdr-tmp.mp4').unlink()

print('done')
