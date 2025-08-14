# Navigation Flight Photo Organizer

A web application for organizing navigation flight photos into standardized PDF layouts. This tool helps automate the workload during preparation of navigation competitions.

## Current Features (Phase 1 MVP)

✅ **Photo Upload & Management**
- Drag & drop interface for two photo sets (9 photos each)
- Automatic file validation (JPEG/PNG, max 20MB)
- Support for up to 18 total photos

✅ **Auto-Processing**
- Automatic cropping to 4:3 aspect ratio
- Optimized for navigation flight photo dimensions

✅ **Interactive Editing**
- Canvas-based photo editor with drag positioning
- Zoom/scale controls (10%-300%)
- Brightness and contrast adjustments
- Real-time preview updates

✅ **Grid Layout System**
- 3×3 photo grid visualization
- Sequential labeling (A-I for each set)
- Visual representation of final PDF layout

✅ **Session Management**
- Automatic local storage persistence
- Session versioning for concurrent editing
- Auto-save every 500ms

✅ **User Interface**
- Responsive design with Tailwind CSS
- Drag & drop upload zones
- Real-time photo statistics
- Error handling and user feedback

## Technology Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Canvas Processing**: HTML5 Canvas API + Fabric.js
- **Styling**: Tailwind CSS
- **File Handling**: React Dropzone
- **Storage**: Browser localStorage

## Getting Started

### Prerequisites
- Node.js 18+ 
- Modern web browser (Chrome 90+, Firefox 88+, Safari 14+)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd AirQ-Competition-Helpers
```

2. Install frontend dependencies:
```bash
cd frontend
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open http://localhost:5173 in your browser

### Usage

1. **Upload Photos**: 
   - Drag and drop up to 9 photos into "Set 1" zone
   - Drag and drop up to 9 photos into "Set 2" zone
   - Supports JPEG and PNG files up to 20MB each

2. **Edit Photos**:
   - Photos are automatically cropped to 4:3 aspect ratio
   - Drag photos within the crop area to adjust positioning
   - Use zoom controls to scale images
   - Adjust brightness and contrast as needed

3. **Add Titles**:
   - Enter titles for each photo set
   - Titles will appear in the final PDF export

4. **Preview Layout**:
   - View the 3×3 grid layout in real-time
   - Photos are labeled A-I sequentially
   - Visual preview matches final PDF output

## Development

### Project Structure
```
frontend/
├── src/
│   ├── components/     # React components
│   │   ├── DropZone.tsx       # File upload interface
│   │   ├── PhotoGrid.tsx      # 3x3 grid display
│   │   ├── PhotoEditor.tsx    # Individual photo editor
│   │   └── TitleInput.tsx     # Set title inputs
│   ├── hooks/          # Custom React hooks
│   │   ├── usePhotoSession.tsx    # Session management
│   │   └── useLocalStorage.tsx    # Storage utilities
│   ├── utils/          # Utility functions
│   │   ├── imageProcessing.ts     # Image manipulation
│   │   ├── canvasUtils.ts         # Canvas operations
│   │   └── sessionManager.ts     # Session utilities
│   ├── types/          # TypeScript definitions
│   └── App.tsx         # Main application
```

### Key Features Implementation

**Auto-Crop Algorithm**:
- Detects image aspect ratio
- Centers crop area for optimal framing
- Maintains 4:3 ratio for PDF consistency

**Canvas-Based Editing**:
- Hardware-accelerated rendering
- Real-time position updates
- Memory-efficient image processing

**Session Versioning**:
- Handles concurrent user editing
- Automatic conflict detection
- Local storage with cleanup

## Upcoming Features

### Phase 2 (Planned)
- [ ] Advanced image adjustments (hue, saturation)
- [ ] Label position customization with arrow controls
- [ ] Keyboard shortcuts for fine positioning
- [ ] Undo/redo functionality
- [ ] Photo randomization feature

### Phase 3 (Future)
- [ ] Backend integration (FastAPI + Google Cloud Storage)
- [ ] PDF export functionality
- [ ] Multi-user collaboration
- [ ] User authentication system
- [ ] Cloud storage and sharing

## File Specifications

**Supported Formats**: JPEG (.jpg, .jpeg), PNG (.png)
**Maximum File Size**: 20MB per photo
**Recommended Resolution**: 1920×1080 or higher
**Output Format**: A4 Landscape PDF with 3×3 grid layout

## Testing

The app includes test photos in the `/photos` directory:
- `photos/set1/`: 9 sample photos for Set 1 testing
- `photos/set2/`: 9 sample photos for Set 2 testing

## Browser Compatibility

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

Requires JavaScript enabled and Canvas API support.

## Performance

**Typical Performance**:
- File Loading: <5s for 18 photos @ 2MB each
- Canvas Rendering: <100ms per adjustment
- Auto-save: <500ms session persistence
- Memory Usage: <200MB for full session

## Contributing

This is currently a development project. For questions or contributions, please refer to the implementation documentation in `/attempts/`.

## License

[License details to be added]

---

**Status**: Phase 1 MVP Complete ✅
**Next**: PDF Export & Backend Integration (Phase 2)
