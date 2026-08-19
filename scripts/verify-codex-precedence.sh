#!/usr/bin/env bash
#
# Does `-c` still beat `-p`?
#
# `ask.ts` passes `-c project_doc_fallback_filenames=[]` on every lookup. That
# is what keeps `guardWorkspace` meaningful: the guard can only refuse instruction
# files whose names it KNOWS, and this empties the list of extra names Codex would
# otherwise load. Since 2026-08-19 it also passes `-p <profile>`, layering a file
# the user edits.
#
# So the whole safety of handing somebody that file rests on one question: can a
# profile put `project_doc_fallback_filenames` back? Measured on 2026-08-19
# against codex-cli 0.148.0: no. `-c` REPLACES a profile's value rather than
# merging with it.
#
# That is a BEHAVIOUR of the CLI, not a documented contract, which is why this
# script exists rather than a paragraph. This project has already lost a round to
# exactly that kind of drift: `agents.override.md` was blocklist rot that arrived
# immediately rather than in some future release.
#
# Run it after upgrading Codex. Non-zero exit means the guard is no longer safe
# against a user-editable profile and `-p` must be withdrawn until it is.
#
#   pnpm verify:codex
#
# Nothing here talks to a model. Every probe fails at config load or at auth,
# both of which happen before any request, and it runs against a throwaway
# CODEX_HOME so your own Codex configuration is never read or written.

set -euo pipefail

if ! command -v codex >/dev/null 2>&1; then
  echo "SKIP: no codex on PATH — nothing to measure."
  echo "      This gate only means something where the CLI is installed."
  exit 0
fi

VERSION="$(codex --version 2>&1 | head -1)"
HOME_DIR="$(mktemp -d)"
trap 'rm -rf "$HOME_DIR"' EXIT

echo "Measuring -p vs -c against: $VERSION"
echo

printf 'model = "base-model"\n' > "$HOME_DIR/config.toml"

# Runs one probe and prints whatever it says about the model or the config.
probe() {
  CODEX_HOME="$HOME_DIR" codex exec \
    -s read-only -C "$HOME_DIR" --skip-git-repo-check --ephemeral \
    "$@" "hi" < /dev/null 2>&1 | grep -E "^model:|invalid type" | head -1 || true
}

fail=0
check() {
  local label="$1" expected="$2" got="$3"
  if [[ "$got" == *"$expected"* ]]; then
    echo "  ok    $label"
  else
    echo "  FAIL  $label"
    echo "        expected to contain: $expected"
    echo "        got:                 ${got:-<nothing>}"
    fail=1
  fi
}

# 1. A profile is layered at all. Without this the rest proves nothing: every
#    later probe would pass just as well if `-p` were being ignored outright.
printf 'model = "profile-model"\n' > "$HOME_DIR/probe.config.toml"
check "a profile is layered over the base config" \
  "profile-model" "$(probe -p probe)"

# 2. `-c` beats `-p` on a scalar.
check "-c beats -p on a scalar key" \
  "cli-model" "$(probe -p probe -c model='"cli-model"')"

# 3. The profile's value for the guard key really is read and validated — so a
#    clean result in probe 4 means it was REPLACED, not that it was never there.
printf 'model = "profile-model"\nproject_doc_fallback_filenames = 42\n' \
  > "$HOME_DIR/probe.config.toml"
check "a profile's guard-key value is read and validated" \
  "invalid type" "$(probe -p probe)"

# 4. THE ONE THAT MATTERS. Same wrong-typed profile value, plus our override.
#    A clean load means the override replaced it and the profile's value never
#    materialised. An "invalid type" here means a profile can reach the guard key.
check "our -c override REPLACES the profile's guard-key value" \
  "model:" "$(probe -p probe -c project_doc_fallback_filenames='[]')"

# 5. Rules out "the override is quietly ignored for arrays" as the reason
#    probe 4 came back clean.
printf 'model = "profile-model"\nproject_doc_fallback_filenames = ["FROM_PROFILE.md"]\n' \
  > "$HOME_DIR/probe.config.toml"
check "our -c override is genuinely applied to an array key" \
  "invalid type" "$(probe -p probe -c project_doc_fallback_filenames=42)"

echo
if [[ "$fail" -ne 0 ]]; then
  echo "FAILED against $VERSION."
  echo
  echo "A user-editable Codex profile may now be able to restore"
  echo "project_doc_fallback_filenames, which is what lets guardWorkspace refuse a"
  echo "workspace holding files that instruct Codex rather than being read by it."
  echo
  echo "Withdraw -p from argsFor in src/capabilities/ask-workspace/ask.ts until this"
  echo "passes again."
  exit 1
fi

echo "PASSED against $VERSION. -c beats -p; the workspace guard holds."
