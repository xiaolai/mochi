#!/usr/bin/env bash
#
# The six secrets `release.yml` needs, set on the repository, once.
#
# Usage:  scripts/release-secrets.sh [path-to-DeveloperID.p12]
#         scripts/release-secrets.sh --show     what is set, names only
#
# ## Why a script rather than six lines in the README
#
# Because five of the six are credentials, and the failure this prevents is
# somebody pasting one into a terminal that keeps history, a chat window, or a
# screen share. Everything here is read with `read -s`, held in a shell variable
# for the length of one `gh secret set`, and never printed — not even masked.
#
# It also gets the seventh thing right for free: the team id is not typed at
# all, it is read out of the signing identity already in the keychain, which is
# where `electron-builder.yml` says to look for it.
#
# ## What this does NOT do
#
# It does not create the Homebrew tap token. GitHub has no API for minting a
# personal access token, so that one is a browser trip; the script tells you
# exactly which boxes to tick and then takes the value.
#
# It does not export your certificate either. `security export` pulls EVERY
# identity out of a keychain, which is more than a release needs and possibly
# more than you meant. Export the one identity from Keychain Access and hand the
# file here.

set -uo pipefail

REPO="xiaolai/mochi"

note() { printf '\n\033[1m%s\033[0m\n' "$*"; }
good() { printf '  \033[32mok\033[0m    %s\n' "$*"; }
bad() {
  printf '  \033[31mFAIL\033[0m  %s\n' "$*"
  exit 1
}

# ---- what is already there --------------------------------------------------

WANTED=(
  APPLE_CERTIFICATE
  APPLE_CERTIFICATE_PASSWORD
  APPLE_ID
  APPLE_PASSWORD
  APPLE_TEAM_ID
  HOMEBREW_TAP_TOKEN
)

show() {
  note "Secrets on $REPO"
  local have
  have=$(gh api "repos/$REPO/actions/secrets" --jq '.secrets[].name' 2>/dev/null || true)
  local missing=0
  for name in "${WANTED[@]}"; do
    if grep -qx "$name" <<<"$have"; then
      good "$name"
    else
      printf '  \033[33m--\033[0m    %s  (not set)\n' "$name"
      missing=1
    fi
  done
  return "$missing"
}

if [ "${1:-}" = "--show" ]; then
  show
  exit $?
fi

command -v gh >/dev/null || bad "the GitHub CLI is not installed"
gh auth status >/dev/null 2>&1 || bad "not signed in — run \`gh auth login\`"

# ---- the one value that is not typed ---------------------------------------

note "The team id, read from the signing identity rather than typed"
TEAM=$(security find-identity -v -p codesigning 2>/dev/null |
  grep -oE '\([A-Z0-9]{10}\)' | head -1 | tr -d '()')
[ -n "$TEAM" ] || bad "no Developer ID Application identity in the keychain"
printf '%s' "$TEAM" | gh secret set APPLE_TEAM_ID --repo "$REPO" || bad "could not set APPLE_TEAM_ID"
good "APPLE_TEAM_ID  (from $(security find-identity -v -p codesigning | sed -n 's/.*"\(.*\)".*/\1/p' | head -1))"

# ---- the certificate --------------------------------------------------------

P12="${1:-}"
if [ -z "$P12" ]; then
  note "The certificate"
  cat <<'HOW'
  Keychain Access -> Login -> My Certificates -> your "Developer ID Application"
  Right-click it, Export, save as a .p12, and give it a password when asked.
  Then run this again with the path:

      scripts/release-secrets.sh ~/Desktop/DeveloperID.p12

  Exporting from here instead would pull every identity out of the keychain,
  which is more than a release needs.
HOW
else
  [ -f "$P12" ] || bad "no file at $P12"
  note "The certificate, from $P12"
  # Held in a variable, never written anywhere. `base64` on macOS wraps by
  # default; -i keeps it on one line the way the workflow's `base64 --decode`
  # expects.
  CERT=$(base64 -i "$P12") || bad "could not read $P12"
  printf '%s' "$CERT" | gh secret set APPLE_CERTIFICATE --repo "$REPO" ||
    bad "could not set APPLE_CERTIFICATE"
  unset CERT
  good "APPLE_CERTIFICATE"

  printf '  the password you gave that .p12 (not shown): '
  read -rs PASS
  echo
  [ -n "$PASS" ] || bad "an empty certificate password will fail the import in CI"
  printf '%s' "$PASS" | gh secret set APPLE_CERTIFICATE_PASSWORD --repo "$REPO" ||
    bad "could not set APPLE_CERTIFICATE_PASSWORD"
  unset PASS
  good "APPLE_CERTIFICATE_PASSWORD"
fi

# ---- the notarization login -------------------------------------------------

note "The Apple ID that notarizes"
printf '  Apple ID (an email address): '
read -r APPLE_ID
if [ -n "$APPLE_ID" ]; then
  printf '%s' "$APPLE_ID" | gh secret set APPLE_ID --repo "$REPO" || bad "could not set APPLE_ID"
  good "APPLE_ID"

  # NOT the account password. An app-specific one, from appleid.apple.com ->
  # Sign-In and Security -> App-Specific Passwords. `notarytool` will not take
  # the account password at all.
  printf '  app-specific password from appleid.apple.com (not shown): '
  read -rs APPLE_PASSWORD
  echo
  if [ -n "$APPLE_PASSWORD" ]; then
    printf '%s' "$APPLE_PASSWORD" | gh secret set APPLE_PASSWORD --repo "$REPO" ||
      bad "could not set APPLE_PASSWORD"
    unset APPLE_PASSWORD
    good "APPLE_PASSWORD"
  else
    printf '  skipped\n'
  fi
else
  printf '  skipped\n'
fi

# ---- the tap ----------------------------------------------------------------

note "The Homebrew tap token"
cat <<'HOW'
  The built-in GITHUB_TOKEN stops at this repository, and the tap is a
  different one, so this step needs a token of its own. Make a FINE-GRAINED
  one, scoped to the tap alone:

      github.com/settings/personal-access-tokens/new
        Resource owner      xiaolai
        Repository access   Only select repositories -> xiaolai/homebrew-tap
        Permissions         Repository -> Contents -> Read and write
        Expiration          whatever you will remember to rotate

  Nothing else needs ticking. A classic token with full `repo` would also
  work and would also let this workflow write to every repository you own.
HOW
printf '  paste it here (not shown), or press return to skip: '
read -rs TAP
echo
if [ -n "$TAP" ]; then
  printf '%s' "$TAP" | gh secret set HOMEBREW_TAP_TOKEN --repo "$REPO" ||
    bad "could not set HOMEBREW_TAP_TOKEN"
  unset TAP
  good "HOMEBREW_TAP_TOKEN"
else
  printf '  skipped\n'
fi

# ---- where that leaves it ---------------------------------------------------

if show; then
  note "All six are set. The release is one push:"
  printf '\n    git push origin main\n    git push origin v%s\n\n' \
    "$(node -p "require('./package.json').version")"
else
  note "Run this again for the ones still missing."
fi
