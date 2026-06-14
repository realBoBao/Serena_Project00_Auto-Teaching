#!/bin/bash
# Build Docker sandbox image
# Usage: bash scripts/build_sandbox.sh

set -e

echo "🔨 Building ai-sandbox Docker image..."

cd "$(dirname "$0")/.."

# Build image
docker build -f Dockerfile.sandbox -t ai-sandbox:latest .

echo "✅ Docker image built: ai-sandbox:latest"

# Test run
echo "🧪 Testing sandbox..."
docker run --rm \
  --network none \
  --memory 256m \
  --cpus 0.5 \
  --read-only \
  --tmpfs /tmp:rw,noexec,size=50m \
  --user 1000:1000 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  ai-sandbox:latest \
  node -e "console.log('Sandbox OK')"

echo "✅ Sandbox test passed!"
