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
#
# "Fails at auth" is not the same as "exits at auth", and 0.150.1 is where that
# distinction started to matter: it answers the 401 by retrying the connection
# five times with backoff. Nothing is billed and nothing is read, exactly as
# above -- but the process does not leave, so each probe is bounded here rather
# than waited on. See `probe`.

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

# How long one probe may take to say the only thing it is asked. Both answers --
# the resolved `model:` header and a config-load `invalid type` -- are printed
# before any network work, within about a second. Ten is generous by an order of
# magnitude, and it is a LIVENESS bound rather than a performance assertion: a
# probe that has said neither by now is not slow, it is not going to answer.
PROBE_SECONDS=10

# Runs one probe and prints whatever it says about the model or the config.
#
# ## Why it does not simply wait for the process
#
# It used to, and on codex-cli 0.150.1 that stopped terminating in any useful
# time. The probes still fail where this file has always said they do -- the
# throwaway CODEX_HOME holds no credentials, so nothing here reaches a model and
# nothing is billed -- but 0.150.1 answers a 401 on its websocket endpoint by
# RETRYING it, five times with backoff, instead of exiting. So every probe with a
# loadable config sat for tens of seconds emitting reconnect errors, and the gate
# as a whole read as hung.
#
# Waiting for the line rather than for the exit is the fix, and it is better than
# a plain timeout would be: it returns the moment the answer exists, so the gate
# is fast on a healthy CLI and BOUNDED on a sick one. `verify.yml` states the
# rule this follows -- a workflow that cannot fail is not a check -- and a gate
# that hangs cannot fail either.
probe() {
  local out; out="$(mktemp)"
  CODEX_HOME="$HOME_DIR" codex exec \
    -s read-only -C "$HOME_DIR" --skip-git-repo-check --ephemeral \
    "$@" "hi" < /dev/null > "$out" 2>&1 &
  local pid=$!

  local answer="" waited=0
  while [ "$waited" -lt "$PROBE_SECONDS" ]; do
    answer="$(grep -E "^model:|invalid type" "$out" | head -1 || true)"
    [ -n "$answer" ] && break
    # The process finishing without either line is an answer too: stop waiting
    # for something that is no longer coming.
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
    waited=$((waited + 1))
  done

  # KILLED once the answer is in hand, rather than left to retry in the
  # background. Five of these outliving the script is five processes nobody
  # started and nothing reaps.
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  # Re-read: the line may have landed between the last grep and the kill.
  grep -E "^model:|invalid type" "$out" | head -1 || true
  rm -f "$out"
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
