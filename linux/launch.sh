#!/usr/bin/env sh
app_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
exec "$app_directory/BrainBroccoli.bin" --no-sandbox "$@"
