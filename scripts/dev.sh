#!/bin/sh
set -eu
# Keep the user's shell configuration untouched.
if [ -d /opt/homebrew/opt/node@24/bin ]; then
  PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:$PATH"
  export PATH
fi
cd "$(dirname "$0")/.."
exec pnpm dev
