import React, { useState } from 'react';
import { usePhotoSession } from './hooks/usePhotoSession';
import { DropZone } from './components/DropZone';
import { PhotoGrid } from './components/PhotoGrid';
import { TitleInput } from './components/TitleInput';
import { PhotoEditor } from './components/PhotoEditor';
import type { Photo } from './types';

function App() {
  const {
    session,
    loading,
    error,
    addPhotosToSet,
    removePhoto,
    updatePhotoState,
    updateSetTitle,
    resetSession,
    clearError,
    getSessionStats
  } = usePhotoSession();

  const [selectedPhoto, setSelectedPhoto] = useState<{
    photo: Photo;
    setKey: 'set1' | 'set2';
    label: string;
  } | null>(null);

  const stats = getSessionStats();

  const handlePhotoClick = (photo: Photo, setKey: 'set1' | 'set2') => {
    const setPhotos = session.sets[setKey].photos;
    const photoIndex = setPhotos.findIndex(p => p.id === photo.id);
    const label = String.fromCharCode(65 + photoIndex); // A, B, C, etc.
    
    setSelectedPhoto({ photo, setKey, label });
  };

  const handlePhotoUpdate = (setKey: 'set1' | 'set2', photoId: string, canvasState: any) => {
    updatePhotoState(setKey, photoId, canvasState);
    
    // Update selected photo if it's the one being edited
    if (selectedPhoto?.photo.id === photoId) {
      const updatedPhoto = session.sets[setKey].photos.find(p => p.id === photoId);
      if (updatedPhoto) {
        setSelectedPhoto({
          ...selectedPhoto,
          photo: updatedPhoto
        });
      }
    }
  };

  const handlePhotoRemove = (setKey: 'set1' | 'set2', photoId: string) => {
    removePhoto(setKey, photoId);
    
    // Close detailed editor if this photo was selected
    if (selectedPhoto?.photo.id === photoId) {
      setSelectedPhoto(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Navigation Flight Photo Organizer
          </h1>
          <p className="text-gray-600">
            Organize your navigation flight photos into standardized PDF layouts
          </p>
          
          {/* Session Stats */}
          <div className="mt-4 inline-flex items-center gap-6 text-sm text-gray-600 bg-white px-4 py-2 rounded-lg shadow">
            <span>Total Photos: {stats.totalPhotos}/18</span>
            <span>Set 1: {stats.set1Photos}/9</span>
            <span>Set 2: {stats.set2Photos}/9</span>
            {stats.isComplete && (
              <span className="text-green-600 font-medium">✓ Complete</span>
            )}
          </div>
        </header>

        {/* Global Error Display */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <p className="text-red-700">{error}</p>
              <button
                onClick={clearError}
                className="text-red-500 hover:text-red-700 ml-4"
              >
                ×
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Upload and Management */}
          <div className="space-y-8">
            {/* Set 1 Upload */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <TitleInput
                value={session.sets.set1.title}
                onChange={(title) => updateSetTitle('set1', title)}
                setName="Set 1"
                placeholder="Enter title for Set 1..."
              />
              
              <DropZone
                onFilesDropped={(files) => addPhotosToSet(files, 'set1')}
                setName="Set 1"
                currentPhotoCount={stats.set1Photos}
                maxPhotos={9}
                loading={loading}
                error={error}
              />
            </div>

            {/* Divider */}
            <div className="border-t-2 border-gray-300 my-8"></div>

            {/* Set 2 Upload */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <TitleInput
                value={session.sets.set2.title}
                onChange={(title) => updateSetTitle('set2', title)}
                setName="Set 2"
                placeholder="Enter title for Set 2..."
              />
              
              <DropZone
                onFilesDropped={(files) => addPhotosToSet(files, 'set2')}
                setName="Set 2"
                currentPhotoCount={stats.set2Photos}
                maxPhotos={9}
                loading={loading}
                error={error}
              />
            </div>

            {/* Action Buttons */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex gap-4">
                <button
                  onClick={resetSession}
                  className="flex-1 bg-red-500 text-white py-2 px-4 rounded hover:bg-red-600 transition-colors"
                >
                  Reset All
                </button>
                <button
                  disabled={!stats.isComplete}
                  className={`flex-1 py-2 px-4 rounded transition-colors ${
                    stats.isComplete
                      ? 'bg-green-500 text-white hover:bg-green-600'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  Export PDF
                </button>
              </div>
            </div>
          </div>

          {/* Right Column - Preview and Editing */}
          <div className="space-y-8">
            {/* Photo Grids */}
            {(stats.set1Photos > 0 || stats.set2Photos > 0) && (
              <>
                {stats.set1Photos > 0 && (
                  <div className="bg-white rounded-lg shadow-md p-6">
                    <PhotoGrid
                      photoSet={session.sets.set1}
                      setKey="set1"
                      onPhotoUpdate={(photoId, canvasState) => 
                        handlePhotoUpdate('set1', photoId, canvasState)
                      }
                      onPhotoRemove={(photoId) => handlePhotoRemove('set1', photoId)}
                    />
                  </div>
                )}

                {stats.set2Photos > 0 && (
                  <div className="bg-white rounded-lg shadow-md p-6">
                    <PhotoGrid
                      photoSet={session.sets.set2}
                      setKey="set2"
                      onPhotoUpdate={(photoId, canvasState) => 
                        handlePhotoUpdate('set2', photoId, canvasState)
                      }
                      onPhotoRemove={(photoId) => handlePhotoRemove('set2', photoId)}
                    />
                  </div>
                )}
              </>
            )}

            {/* Detailed Photo Editor */}
            {selectedPhoto && (
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">
                    Edit Photo {selectedPhoto.label}
                  </h3>
                  <button
                    onClick={() => setSelectedPhoto(null)}
                    className="text-gray-500 hover:text-gray-700 text-xl"
                  >
                    ×
                  </button>
                </div>
                
                <PhotoEditor
                  photo={selectedPhoto.photo}
                  label={selectedPhoto.label}
                  onUpdate={(canvasState) => 
                    handlePhotoUpdate(selectedPhoto.setKey, selectedPhoto.photo.id, canvasState)
                  }
                  onRemove={() => handlePhotoRemove(selectedPhoto.setKey, selectedPhoto.photo.id)}
                  size="large"
                />
              </div>
            )}

            {/* Instructions */}
            {stats.totalPhotos === 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-blue-800 mb-3">
                  Getting Started
                </h3>
                <ul className="space-y-2 text-blue-700">
                  <li>• Upload up to 9 photos for each set</li>
                  <li>• Photos will be automatically cropped to 4:3 aspect ratio</li>
                  <li>• Drag photos to reposition within the crop area</li>
                  <li>• Use zoom and brightness controls for adjustments</li>
                  <li>• Labels A-I will be added automatically</li>
                  <li>• Export to PDF when both sets are complete</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;