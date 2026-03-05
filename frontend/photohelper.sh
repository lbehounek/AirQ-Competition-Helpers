#!/bin/bash

# Development startup script for AirQ Photo Organizer
echo "🚀 Starting AirQ Photo Organizer..."

# Ensure we run from the repo root regardless of invocation location
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Cleanup function
cleanup() {
    echo "🛑 Shutting down servers..."
    jobs -p | xargs -r kill
    exit
}
trap cleanup SIGINT SIGTERM

# Install dependencies if needed
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  pnpm install -q
fi

# Start frontend
echo "⚛️ Starting photo-helper frontend..."
pnpm --filter @airq/photo-helper dev &
echo "✅ Frontend: http://localhost:5173"

echo ""
echo "🎯 Both servers running! Press Ctrl+C to stop."
wait
