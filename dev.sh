#!/bin/bash

# Development startup script for AirQ Photo Organizer
echo "🚀 Starting AirQ Photo Organizer..."

# Cleanup function
cleanup() {
    echo "🛑 Shutting down servers..."
    jobs -p | xargs -r kill
    exit
}
trap cleanup SIGINT SIGTERM EXIT

# Start backend
echo "🐍 Starting backend..."
cd backend

# Setup Python environment
[ ! -d "venv" ] && python3 -m venv venv
source venv/bin/activate
pip install -q -r requirements.txt

# Start backend server
python run.py &
echo "✅ Backend: http://localhost:8000"

# Start frontend
echo "⚛️ Starting frontend..."
cd ../frontend
[ ! -d "node_modules" ] && npm install -q
npm run dev &
echo "✅ Frontend: http://localhost:5173"

echo ""
echo "🎯 Both servers running! Press Ctrl+C to stop."
wait
