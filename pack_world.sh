#!/usr/bin/env bash

set -euo pipefail

PACK_SCRIPT="${BASH_SOURCE[0]:-}"

if [[ -z "$PACK_SCRIPT" ]]; then
    echo "Error: This script must be run in a bash shell."
    exit 1
fi

PACK_SCRIPT="$(realpath "$PACK_SCRIPT")"
SCRIPT_DIR="$(dirname "$PACK_SCRIPT")"

cd "$SCRIPT_DIR" || {
    echo "Error: Failed to change directory to '$SCRIPT_DIR'."
    exit 1
}

require() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "Error: '$1' is required."
        exit 1
    }
}

require find
require jq
require unzip
require zip

PACK_FILE="./Server Picker.mcpack"
WORLD_DIR="./world"
BEHAVIOR_PACKS_DIR="$WORLD_DIR/behavior_packs"
INSTALLED_PACK_DIR="$BEHAVIOR_PACKS_DIR/ServerPicker"
WORLD_PACKS="$WORLD_DIR/world_behavior_packs.json"
WORLD_RESOURCE_PACKS="$WORLD_DIR/world_resource_packs.json"
WORLD_OUTPUT="./Server Picker.mcworld"

if [[ ! -f "$PACK_FILE" ]]; then
    echo "Error: Pack file '$PACK_FILE' does not exist."
    exit 1
fi

if [[ ! -d "$WORLD_DIR" ]]; then
    echo "Error: World directory '$WORLD_DIR' does not exist."
    exit 1
fi

mkdir -p -- "$BEHAVIOR_PACKS_DIR"

echo "Removing existing Server Picker behavior pack..."
rm -rf -- "$INSTALLED_PACK_DIR"

echo "Creating behavior pack directory..."
mkdir -p -- "$INSTALLED_PACK_DIR"

echo "Extracting '$PACK_FILE'..."
unzip -q "$PACK_FILE" -d "$INSTALLED_PACK_DIR"

echo "Scanning behavior packs..."

TMP="$(mktemp)"

cleanup() {
    rm -f -- "$TMP"
    rm -rf -- "$INSTALLED_PACK_DIR"
    rm -f -- "$WORLD_PACKS"
    rm -f -- "$WORLD_RESOURCE_PACKS"
}
trap cleanup EXIT

printf '[]\n' > "$TMP"
printf '[]\n' > "$WORLD_RESOURCE_PACKS"

FOUND_PACKS=0

while IFS= read -r -d '' manifest; do
    pack_dir="$(dirname "$manifest")"

    pack_id="$(
        jq -er '
            .header.uuid
            | select(type == "string" and length > 0)
        ' "$manifest"
    )" || {
        echo "Error: '$manifest' does not contain a valid header.uuid."
        exit 1
    }

    pack_version="$(
        jq -ec '
            .header.version
            | select(
                type == "array"
                and length == 3
                and all(.[]; type == "number")
            )
        ' "$manifest"
    )" || {
        echo "Error: '$manifest' does not contain a valid header.version."
        exit 1
    }

    updated_json="$(
        jq \
            --arg pack_id "$pack_id" \
            --argjson version "$pack_version" \
            '. + [{
                pack_id: $pack_id,
                version: $version
            }]' \
            "$TMP"
    )"

    printf '%s\n' "$updated_json" > "$TMP"

    FOUND_PACKS=$((FOUND_PACKS + 1))

    echo "Found behavior pack:"
    echo "  Directory : $pack_dir"
    echo "  Pack ID   : $pack_id"
    echo "  Version   : $pack_version"
done < <(
    find "$BEHAVIOR_PACKS_DIR" \
        -mindepth 2 \
        -maxdepth 2 \
        -type f \
        -name manifest.json \
        -print0 |
        sort -z
)

if (( FOUND_PACKS == 0 )); then
    echo "Error: No behavior pack manifests were found in '$BEHAVIOR_PACKS_DIR'."
    exit 1
fi

echo "Writing '$WORLD_PACKS'..."
jq '.' "$TMP" > "$WORLD_PACKS"

echo "Creating '$WORLD_OUTPUT'..."
rm -f -- "$WORLD_OUTPUT"

(
    cd "$WORLD_DIR"
    zip -rq "../$(basename "$WORLD_OUTPUT")" .
)

echo
echo "Deployment complete."
echo "Behavior packs: $FOUND_PACKS"
echo "Installed at : $INSTALLED_PACK_DIR"
echo "World config : $WORLD_PACKS"
echo "World output : $WORLD_OUTPUT"
