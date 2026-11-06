# n8n plus the media tools the Gillbert workflows call (ffmpeg, ImageMagick 7 with HEIC, curl).
# The n8n image has no package manager, so the tools are installed in a throwaway Alpine stage
# and copied in, together with the libraries they need.
#
# The builder's Alpine release MUST match the one the n8n image is built on: /usr/lib and /lib
# are copied over the image's own, so an older builder would replace newer system libraries
# (libstdc++, musl, OpenSSL) with older ones and Node can fail to start. Check on every upgrade:
#   docker run --rm --entrypoint sh n8nio/n8n:<version> -c "grep VERSION_ID /etc/os-release"
# 2.15.1 = Alpine 3.22, 2.46.6 = Alpine 3.24 (Node 24 -> 26).
FROM alpine:3.24 AS ffmpeg-builder
RUN apk add --no-cache ffmpeg curl imagemagick libheif

# Same version on both servers. Upgrade deliberately: Staging (here) first, then vps-bridge01.
FROM n8nio/n8n:2.46.6
USER root
COPY --from=ffmpeg-builder /usr/bin/ffmpeg /usr/bin/ffmpeg
COPY --from=ffmpeg-builder /usr/bin/curl /usr/bin/curl
COPY --from=ffmpeg-builder /usr/bin/convert /usr/bin/convert
# IM7's real binary; the workflows call `magick`
COPY --from=ffmpeg-builder /usr/bin/magick /usr/bin/magick
COPY --from=ffmpeg-builder /usr/lib /usr/lib
COPY --from=ffmpeg-builder /lib /lib
USER node
