from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import os
import uuid
import json
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from pathlib import Path
from pydantic import BaseModel
import shutil
from PIL import Image
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AirQ Photo Organizer Backend",
    description="Backend API for organizing navigation flight photos",
    version="1.0.0"
)

# CORS configuration for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Storage configuration
STORAGE_ROOT = Path(__file__).parent / "storage"
PHOTOS_DIR = STORAGE_ROOT / "photos"
SESSIONS_DIR = STORAGE_ROOT / "sessions"

# Ensure storage directories exist
PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

# Constants
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
SESSION_EXPIRY_DAYS = 7
MAX_PHOTOS_PER_SET = 9

class ReorderRequest(BaseModel):
    set_key: str      # 'set1' or 'set2'
    from_index: int   # Source position (0-8)  
    to_index: int     # Target position (0-8)

class PhotoMetadata:
    def __init__(self, photo_id: str, filename: str, set_key: str, session_id: str):
        self.id = photo_id
        self.filename = filename
        self.set_key = set_key
        self.session_id = session_id
        self.uploaded_at = datetime.now()
        self.file_path = PHOTOS_DIR / session_id / f"{photo_id}_{filename}"
        
        # Canvas state
        self.canvas_state = {
            "position": {"x": 0, "y": 0},
            "scale": 1.0,
            "brightness": 0,
            "contrast": 1.0,
            "labelPosition": "bottom-left"
        }
        
    def to_dict(self):
        return {
            "id": self.id,
            "filename": self.filename,
            "setKey": self.set_key,
            "sessionId": self.session_id,
            "uploadedAt": self.uploaded_at.isoformat(),
            "canvasState": self.canvas_state,
            "url": f"/api/photos/{self.session_id}/{self.id}"
        }

class PhotoSession:
    def __init__(self, session_id: str = None):
        self.id = session_id or str(uuid.uuid4())
        self.created_at = datetime.now()
        self.updated_at = datetime.now()
        self.version = 1
        self.sets = {
            "set1": {"title": "", "photos": []},
            "set2": {"title": "", "photos": []}
        }
        
    def to_dict(self):
        return {
            "id": self.id,
            "createdAt": self.created_at.isoformat(),
            "updatedAt": self.updated_at.isoformat(),
            "version": self.version,
            "sets": self.sets
        }
        
    def add_photo(self, photo: PhotoMetadata):
        set_photos = self.sets[photo.set_key]["photos"]
        if len(set_photos) >= MAX_PHOTOS_PER_SET:
            raise HTTPException(
                status_code=400, 
                detail=f"Set {photo.set_key} is full (max {MAX_PHOTOS_PER_SET} photos)"
            )
        
        set_photos.append(photo.to_dict())
        self.updated_at = datetime.now()
        self.version += 1
        
    def update_photo_canvas_state(self, photo_id: str, canvas_state: Dict[str, Any]):
        for set_key in ["set1", "set2"]:
            for photo in self.sets[set_key]["photos"]:
                if photo["id"] == photo_id:
                    photo["canvasState"].update(canvas_state)
                    self.updated_at = datetime.now()
                    self.version += 1
                    return True
        return False
        
    def remove_photo(self, photo_id: str):
        for set_key in ["set1", "set2"]:
            photos = self.sets[set_key]["photos"]
            for i, photo in enumerate(photos):
                if photo["id"] == photo_id:
                    del photos[i]
                    self.updated_at = datetime.now()
                    self.version += 1
                    return True
        return False

# In-memory session storage (would be database in production)
sessions: Dict[str, PhotoSession] = {}

def validate_image_file(file: UploadFile) -> bool:
    """Validate uploaded image file"""
    if file.size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413, 
            detail=f"File too large. Max size: {MAX_FILE_SIZE // (1024*1024)}MB"
        )
    
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )
    
    return True

def save_session(session: PhotoSession):
    """Save session to disk"""
    session_file = SESSIONS_DIR / f"{session.id}.json"
    with open(session_file, 'w') as f:
        json.dump(session.to_dict(), f, indent=2)
    sessions[session.id] = session

def load_session(session_id: str) -> Optional[PhotoSession]:
    """Load session from disk"""
    if session_id in sessions:
        return sessions[session_id]
        
    session_file = SESSIONS_DIR / f"{session_id}.json"
    if session_file.exists():
        try:
            with open(session_file, 'r') as f:
                data = json.load(f)
            session = PhotoSession(session_id)
            session.created_at = datetime.fromisoformat(data["createdAt"])
            session.updated_at = datetime.fromisoformat(data["updatedAt"])
            session.version = data["version"]
            session.sets = data["sets"]
            sessions[session_id] = session
            return session
        except Exception as e:
            logger.error(f"Failed to load session {session_id}: {e}")
    
    return None

@app.get("/")
async def root():
    return {"message": "AirQ Photo Organizer Backend", "status": "running"}

@app.post("/api/sessions")
async def create_session():
    """Create a new photo session"""
    session = PhotoSession()
    save_session(session)
    logger.info(f"Created new session: {session.id}")
    return {"sessionId": session.id, "session": session.to_dict()}

@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    """Get session data"""
    session = load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {"session": session.to_dict()}

@app.post("/api/sessions/{session_id}/upload")
async def upload_photos(
    session_id: str,
    set_key: str = Form(...),  # 'set1' or 'set2'
    files: List[UploadFile] = File(...)
):
    """Upload photos to a session"""
    session = load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if set_key not in ["set1", "set2"]:
        raise HTTPException(status_code=400, detail="Invalid set_key. Must be 'set1' or 'set2'")
    
    # Create session photo directory
    session_photo_dir = PHOTOS_DIR / session_id
    session_photo_dir.mkdir(exist_ok=True)
    
    uploaded_photos = []
    
    for file in files:
        try:
            validate_image_file(file)
            
            # Generate unique photo ID
            photo_id = str(uuid.uuid4())
            photo = PhotoMetadata(photo_id, file.filename, set_key, session_id)
            
            # Save file to disk
            with open(photo.file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            # Validate it's a real image by opening with PIL
            try:
                with Image.open(photo.file_path) as img:
                    img.verify()
            except Exception:
                # Delete invalid file
                photo.file_path.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail=f"Invalid image file: {file.filename}")
            
            # Add to session
            session.add_photo(photo)
            uploaded_photos.append(photo.to_dict())
            
            logger.info(f"Uploaded photo {photo_id} to session {session_id}, set {set_key}")
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to upload {file.filename}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to upload {file.filename}")
    
    save_session(session)
    
    return {
        "message": f"Uploaded {len(uploaded_photos)} photos",
        "photos": uploaded_photos,
        "session": session.to_dict()
    }

@app.get("/api/photos/{session_id}/{photo_id}")
async def get_photo(session_id: str, photo_id: str):
    """Serve photo file"""
    session = load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Find photo in session
    photo_data = None
    for set_key in ["set1", "set2"]:
        for photo in session.sets[set_key]["photos"]:
            if photo["id"] == photo_id:
                photo_data = photo
                break
        if photo_data:
            break
    
    if not photo_data:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    # Build file path
    photo_path = PHOTOS_DIR / session_id / f"{photo_id}_{photo_data['filename']}"
    
    if not photo_path.exists():
        raise HTTPException(status_code=404, detail="Photo file not found")
    
    return FileResponse(photo_path)

@app.put("/api/sessions/{session_id}/photos/{photo_id}/canvas-state")
async def update_photo_canvas_state(session_id: str, photo_id: str, canvas_state: Dict[str, Any]):
    """Update photo canvas state"""
    session = load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if not session.update_photo_canvas_state(photo_id, canvas_state):
        raise HTTPException(status_code=404, detail="Photo not found")
    
    save_session(session)
    return {"message": "Canvas state updated", "session": session.to_dict()}

@app.delete("/api/sessions/{session_id}/photos/{photo_id}")
async def delete_photo(session_id: str, photo_id: str):
    """Delete a photo"""
    session = load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Find and get photo filename before removing
    photo_filename = None
    for set_key in ["set1", "set2"]:
        for photo in session.sets[set_key]["photos"]:
            if photo["id"] == photo_id:
                photo_filename = photo["filename"]
                break
        if photo_filename:
            break
    
    if not session.remove_photo(photo_id):
        raise HTTPException(status_code=404, detail="Photo not found")
    
    # Delete file from disk
    if photo_filename:
        photo_path = PHOTOS_DIR / session_id / f"{photo_id}_{photo_filename}"
        photo_path.unlink(missing_ok=True)
    
    save_session(session)
    return {"message": "Photo deleted", "session": session.to_dict()}

@app.put("/api/sessions/{session_id}/sets/{set_key}/title")
async def update_set_title(session_id: str, set_key: str, title: Dict[str, str]):
    """Update set title"""
    session = load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if set_key not in ["set1", "set2"]:
        raise HTTPException(status_code=400, detail="Invalid set_key")
    
    session.sets[set_key]["title"] = title.get("title", "")
    session.updated_at = datetime.now()
    session.version += 1
    
    save_session(session)
    return {"message": "Title updated", "session": session.to_dict()}

@app.put("/api/sessions/{session_id}/reorder")
async def reorder_photos(session_id: str, reorder_data: ReorderRequest):
    """
    Reorder photos in a set using metadata only - no photo files touched!
    
    Supports:
    - Photo swapping (photo A ↔ photo B)
    - Moving to empty slots (photo A → empty position)
    """
    session = load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    set_key = reorder_data.set_key
    from_index = reorder_data.from_index
    to_index = reorder_data.to_index
    
    # Validate set key
    if set_key not in ["set1", "set2"]:
        raise HTTPException(status_code=400, detail="Invalid set_key. Must be 'set1' or 'set2'")
    
    # Validate indices
    if from_index < 0 or from_index > 8 or to_index < 0 or to_index > 8:
        raise HTTPException(status_code=400, detail="Invalid indices. Must be 0-8")
    
    if from_index == to_index:
        return {"message": "No change needed", "session": session.to_dict()}
    
    # Get current photos array and extend to 9 slots
    photos = session.sets[set_key].get("photos", [])
    photo_slots = [None] * 9  # Create 9-slot array
    
    # Fill known positions
    for i, photo in enumerate(photos):
        if i < 9:
            photo_slots[i] = photo
    
    # Get source and target photos
    source_photo = photo_slots[from_index]
    target_photo = photo_slots[to_index]
    
    # Can't move from empty slot
    if source_photo is None:
        raise HTTPException(status_code=400, detail="Cannot move from empty position")
    
    # Perform the reorder operation
    if target_photo is not None:
        # Swap photos: A ↔ B
        photo_slots[from_index] = target_photo
        photo_slots[to_index] = source_photo
        logger.info(f"Swapped photos: {from_index} ↔ {to_index}")
    else:
        # Move to empty: A → empty
        photo_slots[from_index] = None
        photo_slots[to_index] = source_photo
        logger.info(f"Moved photo: {from_index} → {to_index}")
    
    # Update session with new order (filter out None values)
    session.sets[set_key]["photos"] = [photo for photo in photo_slots if photo is not None]
    session.updated_at = datetime.now()
    session.version += 1
    
    # Save metadata (photos unchanged!)
    save_session(session)
    
    logger.info(f"Photo reorder completed for session {session_id}, set {set_key}")
    return {
        "message": "Photos reordered successfully",
        "session": session.to_dict(),
        "operation": {
            "set_key": set_key,
            "from_index": from_index,
            "to_index": to_index,
            "type": "swap" if target_photo else "move"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
