#!/bin/bash
# Download and install the published Apple Silicon app; never runs with sudo.
set -euo pipefail

repository='kvianAR/BlazeSync'
install_prefix="${HOME}/Applications"

usage() {
  cat <<'HELP'
Usage: bash install-macos.sh [--prefix DIRECTORY]

Installs the latest BlazeSync Apple Silicon release into DIRECTORY/BlazeSync.app.
Default directory: ~/Applications. Quit BlazeSync before installing or updating.
The archive checksum and local code signature are checked before installation.
HELP
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --prefix)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then echo 'Missing --prefix directory.' >&2; exit 1; fi
      install_prefix="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [ "$(uname -s)" != 'Darwin' ] || [ "$(uname -m)" != 'arm64' ]; then
  echo 'This release requires an Apple Silicon Mac. Intel, Windows and Linux binaries are not available.' >&2
  exit 1
fi
for command_name in curl ditto shasum codesign rsync ps awk mktemp; do
  if ! command -v "$command_name" >/dev/null 2>&1; then echo "Required command is missing: $command_name" >&2; exit 1; fi
done
if ps -axo comm= | awk '/BlazeSync[.]app\/Contents\/MacOS\/BlazeSync$/ { found=1 } END { exit !found }'; then
  echo 'Quit BlazeSync from its menu-bar panel before installing or updating.' >&2
  exit 1
fi
if [ -L "${install_prefix}/BlazeSync.app" ]; then
  echo 'The destination app is a symbolic link. Choose its actual parent directory using --prefix.' >&2
  exit 1
fi

stage="$(mktemp -d "${TMPDIR:-/tmp}/blazesync-install.XXXXXX")"
trap 'rm -rf "$stage"' EXIT HUP INT TERM
archive='BlazeSync-macos-arm64.zip'
release="https://github.com/${repository}/releases/latest/download"
curl --proto '=https' --tlsv1.2 --fail --location --retry 3 "${release}/${archive}" -o "${stage}/${archive}"
curl --proto '=https' --tlsv1.2 --fail --location --retry 3 "${release}/SHA256SUMS.txt" -o "${stage}/SHA256SUMS.txt"
expected="$(awk -v file="$archive" '$2 == file { value=$1; count++ } END { if(count != 1) exit 1; print value }' "${stage}/SHA256SUMS.txt")"
if ! [[ "$expected" =~ ^[[:xdigit:]]{64}$ ]]; then echo 'Invalid release checksum.' >&2; exit 1; fi
actual="$(shasum -a 256 "${stage}/${archive}" | awk '{print $1}')"
if [ "$actual" != "$expected" ]; then echo 'Checksum mismatch. Nothing was installed.' >&2; exit 1; fi

ditto -x -k "${stage}/${archive}" "${stage}/unpacked"
source_app="${stage}/unpacked/BlazeSync.app"
if [ ! -x "${source_app}/Contents/MacOS/BlazeSync" ]; then echo 'The release does not contain the expected app.' >&2; exit 1; fi
codesign --verify --deep --strict "$source_app"
mkdir -p "$install_prefix"
rsync -a --delete "${source_app}/" "${install_prefix}/BlazeSync.app/"
codesign --verify --deep --strict "${install_prefix}/BlazeSync.app"
printf 'Installed BlazeSync at: %s/BlazeSync.app\n' "$install_prefix"
printf 'Open it, then click the cloud icon in the macOS menu bar. Saved app settings and keys are kept separately.\n'
