#!/bin/bash

APP_NAME="cinesync"
VERSION="3.0.0"

PLATFORMS=(
    "darwin amd64"
    "darwin arm64"
    "linux amd64"
    "linux arm64"
    "windows amd64"
)

for PLATFORM in "${PLATFORMS[@]}"; do
    OS=$(echo "$PLATFORM" | awk '{print $1}')
    ARCH=$(echo "$PLATFORM" | awk '{print $2}')

    OUTPUT_NAME="cinesync"

    if [ "$OS" == "windows" ]; then
        OUTPUT_NAME="${OUTPUT_NAME}.exe"
    fi

    echo "Building for $OS/$ARCH..."

    # Set environment variables for cross-compilation
    env GOOS=$OS GOARCH=$ARCH go build -o $OUTPUT_NAME

    # Zip the binary
    ZIP_NAME="${APP_NAME}-v${VERSION}-${OS}-${ARCH}.zip"
    zip "$ZIP_NAME" "$OUTPUT_NAME"

    # Cleanup
    rm "$OUTPUT_NAME"

    echo "Built and zipped: $ZIP_NAME"
done

echo "✅ All builds completed!"
