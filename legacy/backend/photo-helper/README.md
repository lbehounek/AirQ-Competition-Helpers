# Photo Helper Backend

FastAPI backend for the photo organization tool.

## Features

- Photo upload and storage management
- Session-based photo organization
- Real-time photo editing state management
- PDF metadata and competition information
- Support for Track and Turning Point modes
- RESTful API with automatic documentation

## API Endpoints

- `GET /` - Health check
- `POST /api/sessions` - Create new session
- `GET /api/sessions/{session_id}` - Get session details
- `POST /api/sessions/{session_id}/photos` - Upload photos
- `PUT /api/sessions/{session_id}/photos/{photo_id}` - Update photo state
- `DELETE /api/sessions/{session_id}/photos/{photo_id}` - Delete photo
- `PUT /api/sessions/{session_id}/reorder` - Reorder photos
- `PUT /api/sessions/{session_id}/mode` - Switch between track/turning point modes
- `PUT /api/sessions/{session_id}/competition` - Update competition name

## Development

```bash
# Setup virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run development server
python run.py
```

The server will start on http://localhost:8000 with automatic reload enabled.

## API Documentation

Visit http://localhost:8000/docs for interactive API documentation (Swagger UI).

## Storage

- Photos are stored in `storage/photos/{session_id}/`
- Session metadata is stored in `storage/sessions/{session_id}.json`