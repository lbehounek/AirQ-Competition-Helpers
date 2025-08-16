# Photo Helper Frontend

React + TypeScript frontend for the photo organization tool.

## Features

- **Photo Upload**: Drag & drop interface for easy photo uploads
- **Real-time Editing**: Brightness, contrast, sharpness, white balance adjustments
- **Two Modes**: 
  - Track photos (randomizable, A-I/1-9 labels)
  - Turning Point photos (sequential, SP/TP1-TPx/FP labels)
- **PDF Export**: High-quality PDF generation with Czech character support
- **Internationalization**: English and Czech language support
- **Responsive Design**: Works on desktop and mobile devices
- **Competition Metadata**: Add competition names and set titles

## Tech Stack

- **React 19** with TypeScript
- **Material-UI (MUI)** for components and theming
- **Vite** for fast development and building
- **pdfMake** for PDF generation with UTF-8 support
- **React Dropzone** for file uploads
- **Custom WebGL** photo processing for real-time effects

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Key Components

- `AppApi.tsx` - Main application component
- `PhotoEditorApi.tsx` - Photo editing with WebGL effects
- `PhotoGridApi.tsx` - 3x3 photo grid with drag & drop
- `ModeSelector.tsx` - Switch between track/turning point modes
- `EditableHeading.tsx` - Inline editable text components
- `TurningPointLayout.tsx` - Specialized layout for turning point mode

## PDF Generation

The app generates high-quality PDFs with:
- Large photos (3.6 x 2.7 inches each)
- Competition name and set titles in headers
- Proper print margins (15mm all around)
- Perfect Czech character support
- Professional layout optimized for A4 landscape

## Internationalization

Supports English and Czech with:
- Dynamic language switching
- Parameterized translations
- localStorage persistence
- Context-based i18n system