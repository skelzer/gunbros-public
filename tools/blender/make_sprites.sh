#!/usr/bin/env bash
# Thin wrapper; the real script is make_sprites.py so Windows works without bash.
# uv is needed for post-processing anyway, so it also supplies the Python here.
set -e
cd "$(dirname "$0")"
exec uv run --python 3.12 --no-project make_sprites.py "$@"
