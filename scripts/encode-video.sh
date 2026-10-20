#!/usr/bin/env bash
# =====================================================================
# تجهيز فيديو جانبي خفيف على معالج التلفزيون (يتطلب ffmpeg)
# الاستخدام:
#   ./scripts/encode-video.sh input.mp4 output.mp4 [نسبة_القسم=25]
# مثال لقسم 20%:
#   ./scripts/encode-video.sh promo.mp4 promo-side.mp4 20
# الناتج: MP4 / H.264 / 30fps / بدون صوت / بمقاس القسم بالضبط / faststart
# =====================================================================
set -euo pipefail
IN="${1:?ملف الإدخال مطلوب}"
OUT="${2:?ملف الإخراج مطلوب}"
PCT="${3:-25}"

# عرض القسم على شاشة 1920 بكسل (رقم زوجي إلزامي لـ H.264)
W=$(( (1920 * PCT / 100) / 2 * 2 ))
H=1080

ffmpeg -y -i "$IN" \
  -vf "scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30" \
  -c:v libx264 -profile:v high -level 4.0 -pix_fmt yuv420p \
  -preset slow -crf 23 -maxrate 3M -bufsize 6M \
  -movflags +faststart -an \
  "$OUT"

echo "تم: $OUT (${W}x${H})"
ls -lh "$OUT"
