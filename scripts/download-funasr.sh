#!/bin/sh
# Download the FunASR SenseVoiceSmall weights. They are not stored in git.
set -eu
dest="${1:-models/SenseVoiceSmall/model.pt}"
mkdir -p "$(dirname "$dest")"
curl -fL --retry 3 -o "$dest.partial" \
  "https://modelscope.cn/models/iic/SenseVoiceSmall/resolve/master/model.pt"
mv "$dest.partial" "$dest"
echo "wrote $dest"
