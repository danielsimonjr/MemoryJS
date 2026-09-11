#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# The web container ships an older Bun that cannot parse this repo's
# `bun.lock` (lockfileVersion 2 needs Bun >= 1.4.2, per package.json
# `packageManager`), so `bun install` fails and neither lint nor tests can
# run. This hook provisions the pinned Bun through npm (the bun.sh installer
# is blocked by the sandbox proxy) and installs dependencies from the
# lockfile. Idempotent: re-runs are no-ops once the container is cached.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Pinned Bun version from package.json "packageManager": "bun@x.y.z".
BUN_VERSION="$(node -p 'String((require("./package.json").packageManager || "bun@1.4.2").split("@")[1])')"

bun_ok() {
  command -v bun >/dev/null 2>&1 && [ "$(bun --version 2>/dev/null)" = "$BUN_VERSION" ]
}

if ! bun_ok; then
  echo "session-start: installing bun@${BUN_VERSION} via npm"
  npm install -g "bun@${BUN_VERSION}"
  hash -r
fi

if ! bun_ok; then
  echo "session-start: bun ${BUN_VERSION} is not on PATH after install" >&2
  exit 1
fi

# Make the pinned bun win over any older one earlier on PATH for the session.
BUN_BIN_DIR="$(dirname "$(command -v bun)")"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"${BUN_BIN_DIR}:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

echo "session-start: bun $(bun --version); installing dependencies"
bun install --frozen-lockfile

echo "session-start: done"
