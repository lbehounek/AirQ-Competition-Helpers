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

def get_max_photos_per_set(layout_mode: str = 'landscape') -> int:
    """Get maximum photos per set based on layout mode"""
    return 10 if layout_mode == 'portrait' else 9

def secure_filename(filename: str) -> str:
    """Return a secure version of a filename.

    - Strips directory components
    - Allows only letters, numbers, dash, underscore and dot
    - Collapses spaces to underscores
    - Ensures non-empty fallback
    """
    import re
    # Drop any path components
    filename = os.path.basename(filename or "")
    # Normalize whitespace to underscores
    filename = re.sub(r"\s+", "_", filename)
    # Keep only safe characters
    filename = re.sub(r"[^A-Za-z0-9._-]", "", filename)
    # Prevent hidden or empty names
    if not filename or set(filename) == {"."}:
        filename = "file"
    return filename

class ReorderRequest(BaseModel):
    set_key: str      # 'set1' or 'set2'
    from_index: int   # Source position (0-8)  
    to_index: int     # Target position (0-8)

class ModeUpdateRequest(BaseModel):
    mode: str         # 'track' or 'turningpoint'

class LayoutModeUpdateRequest(BaseModel):
    layout_mode: str  # 'landscape' or 'portrait'

class CompetitionUpdateRequest(BaseModel):
    competition_name: str

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
        self.mode = "track"  # "track" or "turningpoint"
        self.layout_mode = "landscape"  # "landscape" or "portrait"
        self.competition_name = ""  # Competition identification
        # Separate storage for track and turning point photos
        self.track_sets = {
            "set1": {"title": "SP - TPX", "photos": []},
            "set2": {"title": "TPX - FP", "photos": []}
        }
        self.turningpoint_sets = {
            "set1": {"title": "", "photos": []},
            "set2": {"title": "", "photos": []}
        }
    
    @property
    def sets(self):
        """Get the current sets based on mode"""
        if self.mode == "turningpoint":
            return self.turningpoint_sets
        else:
            return self.track_sets
        
    def to_dict(self):
        return {
            "id": self.id,
            "createdAt": self.created_at.isoformat(),
            "updatedAt": self.updated_at.isoformat(),
            "version": self.version,
            "mode": self.mode,
            "layoutMode": self.layout_mode,
            "competition_name": self.competition_name,
            "sets": self.sets,  # Current sets based on mode (for frontend compatibility)
            "track_sets": self.track_sets,  # Save both sets to file
            "turningpoint_sets": self.turningpoint_sets
        }
        
    def add_photo(self, photo: PhotoMetadata):
        set_photos = self.sets[photo.set_key]["photos"]
        max_photos = get_max_photos_per_set(self.layout_mode)
        if len(set_photos) >= max_photos:
            raise HTTPException(
                status_code=400, 
                detail=f"Set {photo.set_key} is full (max {max_photos} photos)"
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
    # Compute file size from underlying file object
    try:
        current_position = file.file.tell()
    except Exception:
        current_position = 0
    try:
        file.file.seek(0, os.SEEK_END)
        computed_size = file.file.tell()
    finally:
        # Reset pointer for downstream consumers
        try:
            file.file.seek(current_position)
        except Exception:
            pass

    if computed_size > MAX_FILE_SIZE:
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
            # Migration: add mode field if it doesn't exist (backward compatibility)
            session.mode = data.get("mode", "track")
            session.layout_mode = data.get("layoutMode", "landscape")
            session.competition_name = data.get("competition_name", "")
            
            # Migration: handle old session structure vs new separate sets structure
            if "track_sets" in data and "turningpoint_sets" in data:
                # New structure - load both sets
                session.track_sets = data["track_sets"]
                session.turningpoint_sets = data["turningpoint_sets"]
            else:
                # Old structure - migrate existing sets to track_sets with new defaults, initialize empty turningpoint_sets
                old_sets = data.get("sets", {"set1": {"title": "", "photos": []}, "set2": {"title": "", "photos": []}})
                session.track_sets = {
                    "set1": {"title": old_sets["set1"].get("title") or "SP - TPX", "photos": old_sets["set1"]["photos"]},
                    "set2": {"title": old_sets["set2"].get("title") or "TPX - FP", "photos": old_sets["set2"]["photos"]}
                }
                session.turningpoint_sets = {"set1": {"title": "", "photos": []}, "set2": {"title": "", "photos": []}}
            
            sessions[session_id] = session
            return session
        except Exception as e:
            logger.error(f"Failed to load session {session_id}: {e}")
    
    return None

@app.get("/")
async def root():
    return {"message": "AirQ Photo Organizer Backend", "status": "running"}

@app.get("/api/health")
async def health_check():
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
    
    # Preflight capacity check to avoid partial saves
    current_count = len(session.sets[set_key]["photos"])
    max_photos = get_max_photos_per_set(session.layout_mode)
    # Clamp remaining slots to avoid negative values when overflow exists (e.g., after portrait→landscape)
    remaining_slots = max(0, max_photos - current_count)
    if len(files) > remaining_slots:
        raise HTTPException(
            status_code=400,
            detail=f"Too many photos for set {set_key}. Remaining slots: {remaining_slots}"
        )

    uploaded_photos = []
    written_paths = []

    try:
        for file in files:
            validate_image_file(file)

            # Generate unique photo ID
            photo_id = str(uuid.uuid4())
            safe_name = secure_filename(file.filename)
            photo = PhotoMetadata(photo_id, safe_name, set_key, session_id)

            # Ensure target path stays within the session photos directory
            target_path = session_photo_dir / f"{photo_id}_{safe_name}"

            # Save file to disk
            with open(target_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            written_paths.append(target_path)

            # Validate it's a real image by opening with PIL
            try:
                with Image.open(target_path) as img:
                    img.verify()
            except Exception:
                # Delete invalid file and abort
                target_path.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail=f"Invalid image file: {file.filename}")

            # Add to session
            session.add_photo(photo)
            uploaded_photos.append(photo.to_dict())

            logger.info(f"Uploaded photo {photo_id} to session {session_id}, set {set_key}")
    except HTTPException:
        # Cleanup any files written in this batch
        for path in written_paths:
            try:
                Path(path).unlink(missing_ok=True)
            except Exception:
                pass
        raise
    except Exception as e:
        # Cleanup and return 500
        for path in written_paths:
            try:
                Path(path).unlink(missing_ok=True)
            except Exception:
                pass
        logger.error(f"Failed to upload batch: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload photos")
    
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
    Reorder photos with MOVE semantics (splice-like) using metadata only.

    Behavior:
    - Always MOVE the photo at from_index to to_index.
    - Items between indices shift accordingly.
    - Empty slots are preserved as gaps; the result is the same as
      removing the item at from_index and inserting it at to_index in a
      9-slot logical array, then compacting to remove gaps at the end.
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
    
    # Get max slots based on layout mode
    max_photos = get_max_photos_per_set(session.layout_mode)
    max_index = max_photos - 1
    
    # Validate indices
    if from_index < 0 or from_index > max_index or to_index < 0 or to_index > max_index:
        raise HTTPException(status_code=400, detail=f"Invalid indices. Must be 0-{max_index}")
    
    if from_index == to_index:
        return {"message": "No change needed", "session": session.to_dict()}
    
    # Build slot array representing visible grid positions; preserve overflow items
    current = session.sets[set_key].get("photos", [])
    slots = [None] * max_photos
    for i, photo in enumerate(current):
        if i < max_photos:
            slots[i] = photo

    # Validate there is a photo at from_index to move
    moving = slots[from_index]
    if moving is None:
        raise HTTPException(status_code=400, detail="Cannot move from empty position")

    # Remove the moving item, create a compact list of existing items in order
    compact: list = [p for i, p in enumerate(slots) if p is not None and i != from_index]

    # Compute insertion index in the compact list based on move direction
    # If moving forward (from_index < to_index), the compact list is shorter by one
    # so we insert at to_index - 1; else insert at to_index
    if from_index < to_index:
        insert_idx = max(0, min(len(compact), to_index - 1))
    else:
        insert_idx = max(0, min(len(compact), to_index))

    compact.insert(insert_idx, moving)

    # Persist back as a dense photos array for visible slots and append any overflow unchanged
    visible = compact[:max_photos]
    overflow = current[max_photos:]
    session.sets[set_key]["photos"] = visible + overflow
    session.updated_at = datetime.now()
    session.version += 1
    
    # Save metadata (photos unchanged!)
    save_session(session)
    
    logger.info(f"Photo reorder completed for session {session_id}, set {set_key}")
    return {
        "message": "Photos reordered successfully (move)",
        "session": session.to_dict(),
        "operation": {
            "set_key": set_key,
            "from_index": from_index,
            "to_index": to_index,
            "type": "move"
        }
    }

@app.put("/api/sessions/{session_id}/mode")
async def update_session_mode(session_id: str, mode_data: ModeUpdateRequest):
    """Update session mode between 'track' and 'turningpoint'"""
    session = load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Validate mode
    if mode_data.mode not in ["track", "turningpoint"]:
        raise HTTPException(status_code=400, detail="Invalid mode. Must be 'track' or 'turningpoint'")
    
    session.mode = mode_data.mode
    session.updated_at = datetime.now()
    session.version += 1
    save_session(session)
    
    return {
        "message": f"Session mode updated to {mode_data.mode}",
        "session": session.to_dict()
    }

@app.put("/api/sessions/{session_id}/layout-mode")
async def update_layout_mode(session_id: str, layout_data: LayoutModeUpdateRequest):
    """Update session layout mode between 'landscape' and 'portrait'"""
    session = load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Validate layout mode
    if layout_data.layout_mode not in ["landscape", "portrait"]:
        raise HTTPException(status_code=400, detail="Invalid layout mode. Must be 'landscape' or 'portrait'")
    
    session.layout_mode = layout_data.layout_mode
    session.updated_at = datetime.now()
    session.version += 1
    save_session(session)
    
    return {
        "message": f"Session layout mode updated to {layout_data.layout_mode}",
        "session": session.to_dict()
    }

@app.put("/api/sessions/{session_id}/competition")
async def update_competition_name(session_id: str, competition_data: CompetitionUpdateRequest):
    """Update competition name"""
    session = load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session.competition_name = competition_data.competition_name
    session.updated_at = datetime.now()
    session.version += 1
    save_session(session)
    
    return {
        "message": "Competition name updated",
        "session": session.to_dict()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
