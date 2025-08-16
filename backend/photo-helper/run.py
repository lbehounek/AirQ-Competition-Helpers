#!/usr/bin/env python3
"""
Development server runner for AirQ Photo Organizer Backend
"""
import uvicorn
import os

if __name__ == "__main__":
    # Load environment variables
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8000))
    debug = os.getenv("DEBUG", "True").lower() == "true"
    
    print(f"🚀 Starting AirQ Photo Organizer Backend")
    print(f"📍 Server: http://{host}:{port}")
    print(f"🔧 Debug mode: {debug}")
    print(f"📁 Storage: ./storage/")
    print(f"🌐 Frontend CORS: http://localhost:5173")
    
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=debug,
        log_level="info" if debug else "warning"
    )
