#!/usr/bin/env bash
#
# Whether Gatekeeper will actually let somebody else open this.
#
# Separate from the build, and run against the ARTIFACT rather than the config,
# because a configured pipeline is not evidence that it ran. Every check here
# has a way to fail; a verification that cannot fail is not a verification, and
# `spctl ... || true` printing a success line is the single most common way a
# release ships broken.
#
# Usage:  scripts/verify-signing.sh [path-to-.app-or-.dmg ...]
#         scripts/verify-signing.sh          # finds them under release/
#
# Exit code is the result. Nothing here writes, uploads, or changes anything.

set -uo pipefail

fail=0

note() { printf '\n\033[1m%s\033[0m\n' "$*"; }
bad() {
  printf '  \033[31mFAIL\033[0m  %s\n' "$*"
  fail=1
}
good() { printf '  \033[32mok\033[0m    %s\n' "$*"; }

check() {
  local artifact="$1"
  note "$artifact"

  if [ ! -e "$artifact" ]; then
    bad "not there"
    return
  fi

  # ---- identity, hardened runtime, timestamp -------------------------------
  local details
  details=$(codesign -dvvv "$artifact" 2>&1)

  if grep -q "Authority=Developer ID Application" <<<"$details"; then
    good "signed by $(grep -m1 'Authority=Developer ID Application' <<<"$details" | cut -d= -f2-)"
  elif grep -qE "Signature=adhoc|flags=0x2\(adhoc\)" <<<"$details"; then
    bad "ad-hoc signature — this is a debug build, not a distributable one"
  else
    bad "no Developer ID authority"
  fi

  # A secure timestamp is what keeps the signature valid after the certificate
  # expires. Without it every build silently acquires an expiry date.
  grep -q "Timestamp=" <<<"$details" && good "secure timestamp" || bad "no secure timestamp"

  case "$artifact" in
    *.app)
      # `runtime` is the hardened-runtime flag. Apple refuses to notarize
      # without it, so its absence is a failure now rather than a surprise
      # during submission.
      grep -q "flags=.*runtime" <<<"$details" &&
        good "hardened runtime" || bad "hardened runtime NOT enabled"

      # A release build that is still debuggable is one anybody can attach to,
      # and Apple will not notarize it either.
      if codesign -d --entitlements :- "$artifact" 2>/dev/null | grep -q "get-task-allow"; then
        bad "get-task-allow present — this build is debuggable"
      else
        good "no get-task-allow"
      fi
      ;;
  esac

  # ---- integrity -----------------------------------------------------------
  if codesign --verify --deep --strict --verbose=2 "$artifact" >/dev/null 2>&1; then
    good "signature intact"
  else
    bad "signature does not verify"
  fi

  # ---- the ticket ----------------------------------------------------------
  #
  # Checked SEPARATELY from the verdict below, because the two can disagree:
  # `spctl` will fall back to an online lookup, so an unstapled build passes
  # here on a connected machine and fails on a plane.
  if xcrun stapler validate "$artifact" >/dev/null 2>&1; then
    good "notarization ticket stapled"
  else
    bad "NO stapled ticket — works online, fails offline"
  fi

  # ---- Gatekeeper's actual answer ------------------------------------------
  local verdict
  case "$artifact" in
    *.dmg) verdict=$(spctl -a -vvv -t open --context context:primary-signature "$artifact" 2>&1) ;;
    *) verdict=$(spctl -a -vvv -t exec "$artifact" 2>&1) ;;
  esac

  if grep -q "source=Notarized Developer ID" <<<"$verdict"; then
    good "Gatekeeper: accepted, notarized"
  elif grep -q "source=Unnotarized Developer ID" <<<"$verdict"; then
    bad "Gatekeeper: signed but NEVER NOTARIZED — blocked on other people's Macs"
  elif grep -q "no usable signature" <<<"$verdict"; then
    bad "Gatekeeper: no usable signature"
  else
    bad "Gatekeeper: $(head -2 <<<"$verdict" | tr '\n' ' ')"
  fi
}

if [ "$#" -gt 0 ]; then
  for artifact in "$@"; do check "$artifact"; done
else
  found=0
  while IFS= read -r artifact; do
    found=1
    check "$artifact"
  done < <(find release -maxdepth 2 \( -name '*.app' -o -name '*.dmg' \) 2>/dev/null)
  if [ "$found" -eq 0 ]; then
    note 'nothing to check'
    echo '  no .app or .dmg under release/ — run `pnpm dist` first'
    exit 1
  fi
fi

echo
if [ "$fail" -eq 0 ]; then
  echo 'All checks passed. This is shippable.'
else
  echo 'NOT shippable — see the failures above.'
fi
exit "$fail"
