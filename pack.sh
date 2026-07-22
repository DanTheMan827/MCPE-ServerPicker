#!/usr/bin/env bash

set -euo pipefail

PACK_SCRIPT="${BASH_SOURCE[0]:-}"

if [[ -z "$PACK_SCRIPT" ]]; then
    echo "Error: This script must be run in a bash shell."
    exit 1
fi

PACK_SCRIPT="$(realpath "$PACK_SCRIPT")"
PACK_DIR="$(dirname "$PACK_SCRIPT")"

cd "$PACK_DIR" || {
    echo "Error: Failed to change directory to '$PACK_DIR'."
    exit 1
}

require() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "Error: '$1' is required."
        exit 1
    }
}

require git
require jq
require sha256sum
require zip

MANIFEST="manifest.json"
SCRIPT="scripts/index.js"
DEFAULT_VERSION="1.0.0"

MANIFEST_NAME="$(
    jq -er '
        .header.name
        | select(type == "string" and length > 0)
    ' "$MANIFEST"
)" || {
    echo "Error: '$MANIFEST' does not contain a valid header.name."
    exit 1
}

PACK_NAME="$MANIFEST_NAME"

# Remove a trailing version from the manifest name, if present.
#
# Examples:
#   Pack Name v1.2.3
#   Pack Name v1.2.3-test
#   Pack Name v1.2.3+metadata
#   Pack Name v1.2.3-test+metadata
if [[ "$PACK_NAME" =~ ^(.*[^[:space:]])[[:space:]]+v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[^[:space:]]+)?$ ]]; then
    PACK_NAME="${BASH_REMATCH[1]}"
fi

set_manifest_version() {
    local version="$1"
    local major minor patch
    local tmp

    # Extract only the numeric major, minor, and patch components.
    if [[ "$version" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
        major="${BASH_REMATCH[1]}"
        minor="${BASH_REMATCH[2]}"
        patch="${BASH_REMATCH[3]}"
    else
        echo "Error: Version '$version' does not begin with a valid X.Y.Z version."
        return 1
    fi

    tmp="$(mktemp)"

    jq \
        --argjson major "$major" \
        --argjson minor "$minor" \
        --argjson patch "$patch" \
        '
        .header.version = [$major, $minor, $patch] |
        .modules |= map(.version = [$major, $minor, $patch])
        ' \
        "$MANIFEST" > "$tmp"

    mv "$tmp" "$MANIFEST"
}

set_name() {
    local name="$1"
    local tmp

    tmp="$(mktemp)"

    jq \
        --arg name "$name" \
        '.header.name = $name' \
        "$MANIFEST" > "$tmp"

    mv "$tmp" "$MANIFEST"
}

clear_uuids() {
    local tmp

    tmp="$(mktemp)"

    jq '
        .header.uuid = "" |
        .modules |= map(
            if .type == "script" or .type == "data" then
                .uuid = ""
            else
                .
            end
        )
        ' \
        "$MANIFEST" > "$tmp"

    mv "$tmp" "$MANIFEST"
}

cleanup() {
    local exit_code=$?

    trap - EXIT

    echo
    echo "Resetting manifest..."

    set_name "$PACK_NAME" || true
    clear_uuids || true
    set_manifest_version "$DEFAULT_VERSION" || true

    exit "$exit_code"
}

trap cleanup EXIT

# Convert arbitrary input into a deterministic RFC4122 version 4 UUID.
hash_to_uuid() {
    local input="$1"
    local hex
    local variant

    hex="$(printf '%s' "$input" | sha256sum | awk '{print $1}')"

    # Set UUID version to 4.
    hex="${hex:0:12}4${hex:13}"

    # Set UUID variant to RFC4122.
    variant="$(printf '%x' $(((0x${hex:16:1} & 0x3) | 0x8)))"
    hex="${hex:0:16}${variant}${hex:17}"

    printf '%s-%s-%s-%s-%s\n' \
        "${hex:0:8}" \
        "${hex:8:4}" \
        "${hex:12:4}" \
        "${hex:16:4}" \
        "${hex:20:12}"
}

get_git_version() {
    local tag
    local version
    local short_hash

    # Use the latest tag reachable from HEAD.
    tag="$(git describe --tags --abbrev=0 2>/dev/null || true)"

    if [[ -z "$tag" ]]; then
        version="$DEFAULT_VERSION"
    elif [[ "$tag" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+)([-+].*)?$ ]]; then
        version="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}${BASH_REMATCH[4]:-}"
    else
        echo "Warning: Latest Git tag '$tag' is not a supported version tag." >&2
        echo "Warning: Using default version $DEFAULT_VERSION." >&2
        version="$DEFAULT_VERSION"
    fi

    # Append the short commit hash when HEAD is not exactly on the tag.
    if ! git describe --tags --exact-match >/dev/null 2>&1; then
        short_hash="$(git rev-parse --short HEAD)"
        version="${version}-${short_hash}"
    fi

    # Append "-dirty" when tracked or untracked files have changes.
    if [[ -n "$(git status --porcelain)" ]]; then
        version="${version}-dirty"
    fi

    printf '%s\n' "$version"
}

VERSION="$(get_git_version)"

echo "Build version: $VERSION"
echo "Setting manifest numeric version..."
set_manifest_version "$VERSION"

OUTPUT="${PACK_NAME} v${VERSION}"

echo "Clearing UUIDs..."
clear_uuids

echo "Setting manifest name..."
set_name "$OUTPUT"

echo "Generating script UUID..."

SCRIPT_HASH="$(sha256sum "$SCRIPT" | awk '{print $1}')"
SCRIPT_UUID="$(hash_to_uuid "$SCRIPT_HASH")"

echo "Generating data UUID..."

DATA_UUID="$(hash_to_uuid "${SCRIPT_UUID}-data")"

echo "Updating module UUIDs..."

TMP="$(mktemp)"

jq \
    --arg script "$SCRIPT_UUID" \
    --arg data "$DATA_UUID" \
    '
    .modules |= map(
        if .type == "script" then
            .uuid = $script
        elif .type == "data" then
            .uuid = $data
        else
            .
        end
    )
    ' \
    "$MANIFEST" > "$TMP"

mv "$TMP" "$MANIFEST"

echo "Generating header UUID..."

MANIFEST_HASH="$(sha256sum "$MANIFEST" | awk '{print $1}')"
HEADER_UUID="$(hash_to_uuid "$MANIFEST_HASH")"

TMP="$(mktemp)"

jq \
    --arg header "$HEADER_UUID" \
    '.header.uuid = $header' \
    "$MANIFEST" > "$TMP"

mv "$TMP" "$MANIFEST"

echo "Creating $PACK_NAME.mcpack..."

rm -f "$PACK_NAME.mcpack"

zip -rq "$PACK_NAME.mcpack" . \
    -x ".git/*" \
    -x ".github/*" \
    -x ".gitignore" \
    -x "README.md" \
    -x "readme.md" \
    -x "pack.sh" \
    -x "*.mcpack"

echo
echo "Build complete."
echo
echo "Version     : $VERSION"
echo "Header UUID : $HEADER_UUID"
echo "Data UUID   : $DATA_UUID"
echo "Script UUID : $SCRIPT_UUID"
echo "Output      : $PACK_NAME.mcpack"
