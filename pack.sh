    #!/usr/bin/env bash
    PACK_SCRIPT="${BASH_SOURCE[0]}"

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

    pwd

    set -euo pipefail

    MANIFEST="manifest.json"
    SCRIPT="scripts/index.js"
    PACK_NAME="ServerPicker"
    VERSION=$(jq -r '.header.version | map(tostring) | join(".")' "$MANIFEST")
    OUTPUT="${PACK_NAME}-v${VERSION}.mcpack"

    # Convert arbitrary input into a deterministic RFC4122 version 4 UUID.
    hash_to_uuid() {
        local input="$1"

        local hex
        hex=$(printf "%s" "$input" | sha256sum | awk '{print $1}')

        # Set UUID version (4)
        hex="${hex:0:12}4${hex:13}"

        # Set UUID variant (RFC4122)
        local variant
        variant=$(printf "%x" $(( (0x${hex:16:1} & 0x3) | 0x8 )))
        hex="${hex:0:16}${variant}${hex:17}"

        printf "%s-%s-%s-%s-%s\n" \
            "${hex:0:8}" \
            "${hex:8:4}" \
            "${hex:12:4}" \
            "${hex:16:4}" \
            "${hex:20:12}"
    }

    require() {
        command -v "$1" >/dev/null 2>&1 || {
            echo "Error: '$1' is required."
            exit 1
        }
    }

    require jq
    require sha256sum
    require zip

    echo "Clearing UUIDs..."

    clear_uuids() {
        local TMP=$(mktemp)

        jq '
        .header.uuid = "" |
        .modules |= map(
            if .type == "script" or .type == "data" then
                .uuid = ""
            else
                .
            end
        )
        ' "$MANIFEST" > "$TMP"

        mv "$TMP" "$MANIFEST"
    }

    clear_uuids

    echo "Generating script UUID..."

    SCRIPT_HASH=$(sha256sum "$SCRIPT" | awk '{print $1}')
    SCRIPT_UUID=$(hash_to_uuid "$SCRIPT_HASH")

    echo "Generating data UUID..."

    DATA_UUID=$(hash_to_uuid "${SCRIPT_UUID}-data")

    echo "Updating module UUIDs..."

    TMP=$(mktemp)

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
    ' "$MANIFEST" > "$TMP"

    mv "$TMP" "$MANIFEST"

    echo "Generating header UUID..."

    MANIFEST_HASH=$(sha256sum "$MANIFEST" | awk '{print $1}')
    HEADER_UUID=$(hash_to_uuid "$MANIFEST_HASH")

    TMP=$(mktemp)

    jq \
        --arg header "$HEADER_UUID" \
        '.header.uuid = $header' \
        "$MANIFEST" > "$TMP"

    mv "$TMP" "$MANIFEST"

    echo "Creating $OUTPUT..."

    rm -f "$OUTPUT"

    zip -rq "$OUTPUT" . \
        -x ".git/*" \
        -x ".github/*" \
        -x ".gitignore" \
        -x "README.md" \
        -x "readme.md" \
        -x "pack.sh"

    echo
    echo "Build complete."
    echo
    echo "Header UUID : $HEADER_UUID"
    echo "Data UUID   : $DATA_UUID"
    echo "Script UUID : $SCRIPT_UUID"
    echo "Output      : $OUTPUT"

    clear_uuids