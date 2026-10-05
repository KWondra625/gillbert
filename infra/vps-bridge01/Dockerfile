FROM alpine:3.22 AS ffmpeg-builder
RUN apk add --no-cache ffmpeg curl imagemagick libheif

# Pinned to match the Pi (Staging) at migration time. Upgrade deliberately: Staging first, then here.
FROM n8nio/n8n:2.15.1
USER root
COPY --from=ffmpeg-builder /usr/bin/ffmpeg /usr/bin/ffmpeg
COPY --from=ffmpeg-builder /usr/bin/curl /usr/bin/curl
COPY --from=ffmpeg-builder /usr/bin/convert /usr/bin/convert
# IM7's real binary; the workflows move from the deprecated `convert` to `magick` before cutover
COPY --from=ffmpeg-builder /usr/bin/magick /usr/bin/magick
COPY --from=ffmpeg-builder /usr/lib /usr/lib
COPY --from=ffmpeg-builder /lib /lib
USER node
