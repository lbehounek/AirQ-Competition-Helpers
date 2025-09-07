# AirQ Competition Helpers

This repository contains multiple tools and helpers for AirQ competitions.

## Project Structure

```
├── backend/
│   └── photo-helper/          # Photo organization backend (FastAPI)
├── frontend/
│   └── photo-helper/          # Photo organization frontend (React + TypeScript)
├── deploy.dev.sh              # Development deployment script
├── deploy.prod.sh             # Production deployment script
├── dev.sh                     # Local development startup script
└── README.md                  # This file
```

## Available Tools

### 📸 Photo Helper
A web application for organizing and editing competition photos with PDF export.

**Features:**
- Photo upload and organization in 3x3 grids
- Real-time photo editing (brightness, contrast, sharpness, white balance)
- Two modes: Track photos and Turning Point photos
- Competition metadata and labeling
- PDF export with Czech character support
- Internationalization (English/Czech)

**Tech Stack:**
- **Backend**: FastAPI (Python)
- **Frontend**: React + TypeScript + Material-UI
- **PDF Generation**: pdfMake with Czech character support

## Quick Start

### Development
```bash
# Start both backend and frontend
./dev.sh
```

This will start:
- Backend: http://localhost:8000
- Frontend: http://localhost:5173

### Individual Services

#### Photo Helper Backend
```bash
cd backend/photo-helper
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python run.py
```

#### Photo Helper Frontend
```bash
cd frontend/photo-helper
npm install
npm run dev
```

## Deployment

### Development Server
```bash
./deploy.dev.sh
```

### Production Server
```bash
./deploy.prod.sh
```

Make sure to configure `deploy.conf` based on `deploy.conf.example`.

## Adding New Tools

When adding new competition helpers:

1. Create new directories:
   ```
   backend/your-tool-name/
   frontend/your-tool-name/
   ```

2. Update `dev.sh` to include your new services

3. Update this README with documentation

## UI change: Welcome instructions banner (AutoBanner)

- The welcome instructions banner at the bottom of the Photo Helper is now hidden by default to reduce visual clutter.
- It is not removed; it remains in the DOM with display: none so it can be re-enabled anytime.
- Location: `frontend/photo-helper/src/AppApi.tsx`
- How to re-enable:

```ts
// AppApi.tsx
const SHOW_WELCOME_INSTRUCTIONS = true; // set to true to show the banner again
```

Current default value is `false`.

## License

Private repository for AirQ competition tools.