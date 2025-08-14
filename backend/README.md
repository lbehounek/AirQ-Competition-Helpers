# AirQ Photo Organizer Backend

FastAPI backend for organizing navigation flight photos with local filesystem storage.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Run Development Server

```bash
python run.py
```

The server will start at `http://localhost:8000`

## 📁 Project Structure

```
backend/
├── main.py              # FastAPI application
├── run.py               # Development server runner
├── requirements.txt     # Python dependencies
├── .env.example        # Environment variables template
├── storage/            # Local file storage (auto-created)
│   ├── photos/         # Uploaded photos by session
│   └── sessions/       # Session data (JSON files)
└── README.md
```

## 🔧 Configuration

Copy `.env.example` to `.env` and modify as needed:

```bash
cp .env.example .env
```

## 📡 API Endpoints

### Sessions
- `POST /api/sessions` - Create new session
- `GET /api/sessions/{session_id}` - Get session data

### Photos
- `POST /api/sessions/{session_id}/upload` - Upload photos
- `GET /api/photos/{session_id}/{photo_id}` - Serve photo files
- `PUT /api/sessions/{session_id}/photos/{photo_id}/canvas-state` - Update photo settings
- `DELETE /api/sessions/{session_id}/photos/{photo_id}` - Delete photo

### Sets
- `PUT /api/sessions/{session_id}/sets/{set_key}/title` - Update set title

## 🎯 Features

- ✅ **File Upload** - Multi-file upload with validation
- ✅ **Image Processing** - PIL-based validation and processing
- ✅ **Session Management** - JSON-based session persistence
- ✅ **Local Storage** - Filesystem-based photo storage
- ✅ **CORS Support** - Ready for frontend integration
- ✅ **Error Handling** - Comprehensive error responses
- ✅ **File Validation** - Size and format checking

## 🔒 File Validation

- **Max size**: 20MB per file
- **Formats**: JPEG, PNG only
- **Image validation**: PIL verification
- **Automatic cleanup** on validation failure

## 💾 Storage

Photos are stored in:
```
storage/photos/{session_id}/{photo_id}_{filename}
```

Session data is stored in:
```
storage/sessions/{session_id}.json
```

## 🔄 Development

The server runs with auto-reload enabled for development. Changes to Python files will automatically restart the server.

## 🎨 Frontend Integration

The backend is configured to work with the Vite dev server at `http://localhost:5173`. CORS is pre-configured for seamless integration.

## 📊 Session Data Format

```json
{
  "id": "session-uuid",
  "createdAt": "2024-01-01T00:00:00",
  "updatedAt": "2024-01-01T00:00:00", 
  "version": 1,
  "sets": {
    "set1": {
      "title": "Navigation Set 1",
      "photos": [...]
    },
    "set2": {
      "title": "Navigation Set 2", 
      "photos": [...]
    }
  }
}
```

## 🧪 Testing

Visit `http://localhost:8000/docs` for interactive API documentation and testing.
