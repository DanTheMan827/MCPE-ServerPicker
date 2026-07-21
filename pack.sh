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

MANIFEST="manifest.json"
SCRIPT="scripts/index.js"
PACK_NAME="Server Picker"
DEFAULT_VERSION="1.0.0"

require() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "Error: '$1' is required."
        exit 1
    }
}

require jq
require sha256sum
require zip

set_manifest_version() {
    local version="$1"
    local major minor patch extra
    local tmp

    IFS='.' read -r major minor patch extra <<< "$version"

    if [[ -n "${extra:-}" ]] ||
       [[ ! "$major" =~ ^[0-9]+$ ]] ||
       [[ ! "$minor" =~ ^[0-9]+$ ]] ||
       [[ ! "$patch" =~ ^[0-9]+$ ]]; then
        echo "Error: Version must use the format major.minor.patch, such as 1.2.3."
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

if [[ -n "${1:-}" ]]; then
    VERSION="$1"

    echo "Setting manifest version to $VERSION..."
    set_manifest_version "$VERSION"
else
    VERSION="$(
        jq -r '.header.version | map(tostring) | join(".")' "$MANIFEST"
    )"
fi

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
echo "Header UUID : $HEADER_UUID"
echo "Data UUID   : $DATA_UUID"
echo "Script UUID : $SCRIPT_UUID"
echo "Output      : $PACK_NAME.mcpack"
