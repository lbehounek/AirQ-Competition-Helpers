import React from 'react';
import { useDropzone } from 'react-dropzone';
import { isValidImageFile } from '../utils/imageProcessing';

interface DropZoneProps {
  onFilesDropped: (files: File[]) => void;
  setName: string;
  currentPhotoCount: number;
  maxPhotos: number;
  loading?: boolean;
  error?: string | null;
}

export const DropZone: React.FC<DropZoneProps> = ({
  onFilesDropped,
  setName,
  currentPhotoCount,
  maxPhotos,
  loading = false,
  error = null
}) => {
  const availableSlots = maxPhotos - currentPhotoCount;
  const isDisabled = loading || availableSlots === 0;

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
    isDragReject
  } = useDropzone({
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png']
    },
    maxFiles: availableSlots,
    maxSize: 20 * 1024 * 1024, // 20MB
    disabled: isDisabled,
    onDrop: (acceptedFiles, rejectedFiles) => {
      // Filter valid files
      const validFiles = acceptedFiles.filter(isValidImageFile);
      
      if (validFiles.length > 0) {
        onFilesDropped(validFiles);
      }

      // Log rejected files for debugging
      if (rejectedFiles.length > 0) {
        rejectedFiles.forEach(({ file, errors }) => {
          console.warn(`Rejected file ${file.name}:`, errors);
        });
      }
    }
  });

  // Determine styling based on state
  const getDropZoneStyles = () => {
    let baseStyles = 'border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200 cursor-pointer min-h-[200px] flex flex-col justify-center items-center';
    
    if (isDisabled) {
      return `${baseStyles} border-gray-300 bg-gray-50 cursor-not-allowed opacity-50`;
    }
    
    if (isDragReject) {
      return `${baseStyles} border-red-400 bg-red-50`;
    }
    
    if (isDragAccept) {
      return `${baseStyles} border-green-400 bg-green-50`;
    }
    
    if (isDragActive) {
      return `${baseStyles} border-blue-400 bg-blue-50`;
    }
    
    return `${baseStyles} border-gray-400 bg-gray-50 hover:border-blue-400 hover:bg-blue-50`;
  };

  const getStatusText = () => {
    if (loading) {
      return 'Processing photos...';
    }
    
    if (availableSlots === 0) {
      return `${setName} is full (${currentPhotoCount}/${maxPhotos} photos)`;
    }
    
    if (isDragReject) {
      return 'Invalid file type. Please use JPEG or PNG files only.';
    }
    
    if (isDragAccept) {
      return `Drop ${availableSlots > 1 ? 'photos' : 'photo'} here`;
    }
    
    if (isDragActive) {
      return 'Release to upload...';
    }
    
    return `Drop photos here or click to browse`;
  };

  const getSubText = () => {
    if (loading || availableSlots === 0 || isDragActive) {
      return null;
    }
    
    return (
      <p className="text-sm text-gray-500 mt-2">
        {availableSlots} slot{availableSlots !== 1 ? 's' : ''} available • 
        JPEG/PNG only • Max 20MB per file
      </p>
    );
  };

  return (
    <div className="w-full">
      {/* Set Title */}
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-700">
          {setName} ({currentPhotoCount}/{maxPhotos})
        </h3>
        {error && (
          <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}
      </div>

      {/* Drop Zone */}
      <div {...getRootProps()} className={getDropZoneStyles()}>
        <input {...getInputProps()} />
        
        {/* Upload Icon */}
        <div className="mb-4">
          {loading ? (
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          ) : (
            <svg 
              className={`h-12 w-12 ${isDragReject ? 'text-red-400' : isDragAccept ? 'text-green-400' : 'text-gray-400'}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={1.5} 
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" 
              />
            </svg>
          )}
        </div>

        {/* Status Text */}
        <p className={`text-base font-medium ${
          isDragReject ? 'text-red-600' : 
          isDragAccept ? 'text-green-600' : 
          'text-gray-600'
        }`}>
          {getStatusText()}
        </p>

        {/* Subtext */}
        {getSubText()}
      </div>

      {/* Current Photos Preview */}
      {currentPhotoCount > 0 && (
        <div className="mt-4">
          <p className="text-sm text-gray-600 mb-2">
            Current photos in {setName}:
          </p>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: currentPhotoCount }, (_, i) => (
              <div 
                key={i} 
                className="w-12 h-12 bg-blue-100 rounded border-2 border-blue-300 flex items-center justify-center text-blue-700 font-semibold text-xs"
              >
                {String.fromCharCode(65 + i)} {/* A, B, C, etc. */}
              </div>
            ))}
            {Array.from({ length: availableSlots }, (_, i) => (
              <div 
                key={`empty-${i}`} 
                className="w-12 h-12 bg-gray-100 rounded border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-xs"
              >
                ?
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
