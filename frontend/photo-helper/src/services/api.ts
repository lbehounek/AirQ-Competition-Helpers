/**
 * API Client for AirQ Photo Organizer Backend
 */

import type { PhotoSession, Photo } from '../types';

const API_BASE_URL = import.meta?.env?.VITE_API_BASE_URL || '';

class ApiError extends Error {
  constructor(message: string, public status?: number, public response?: Response) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    
    try {
      const errorData = JSON.parse(errorText);
      errorMessage = errorData.detail || errorMessage;
    } catch {
      // Use default error message if JSON parsing fails
    }
    
    throw new ApiError(errorMessage, response.status, response);
  }
  
  return response.json();
}

export class PhotoOrganizerApi {
  private baseUrl: string;
  
  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }
  
  /**
   * Create a new photo session
   */
  async createSession(): Promise<{ sessionId: string; session: PhotoSession }> {
    const response = await fetch(`${this.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    
    return handleResponse(response);
  }
  
  /**
   * Get session data
   */
  async getSession(sessionId: string): Promise<{ session: PhotoSession }> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}`);
    return handleResponse(response);
  }
  
  /**
   * Upload photos to a session
   */
  async uploadPhotos(
    sessionId: string,
    setKey: 'set1' | 'set2',
    files: File[]
  ): Promise<{
    message: string;
    photos: Photo[];
    session: PhotoSession;
  }> {
    const formData = new FormData();
    formData.append('set_key', setKey);
    
    files.forEach((file) => {
      formData.append('files', file);
    });
    
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/upload`, {
      method: 'POST',
      body: formData,
    });
    
    return handleResponse(response);
  }
  
  /**
   * Get photo URL for display
   */
  getPhotoUrl(sessionId: string, photoId: string): string {
    return `${this.baseUrl}/api/photos/${sessionId}/${photoId}`;
  }
  
  /**
   * Update photo canvas state
   */
  async updatePhotoCanvasState(
    sessionId: string,
    photoId: string,
    canvasState: Partial<Photo['canvasState']>
  ): Promise<{ message: string; session: PhotoSession }> {
    const response = await fetch(
      `${this.baseUrl}/api/sessions/${sessionId}/photos/${photoId}/canvas-state`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(canvasState),
      }
    );
    
    return handleResponse(response);
  }
  
  /**
   * Delete a photo
   */
  async deletePhoto(
    sessionId: string,
    photoId: string
  ): Promise<{ message: string; session: PhotoSession }> {
    const response = await fetch(
      `${this.baseUrl}/api/sessions/${sessionId}/photos/${photoId}`,
      {
        method: 'DELETE',
      }
    );
    
    return handleResponse(response);
  }
  
  /**
   * Update set title
   */
  async updateSetTitle(
    sessionId: string,
    setKey: 'set1' | 'set2',
    title: string
  ): Promise<{ message: string; session: PhotoSession }> {
    const response = await fetch(
      `${this.baseUrl}/api/sessions/${sessionId}/sets/${setKey}/title`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }
    );
    
    return handleResponse(response);
  }
  
  /**
   * Reorder photos in a set using metadata only (no photo files changed)
   */
  async reorderPhotos(
    sessionId: string,
    setKey: 'set1' | 'set2', 
    fromIndex: number,
    toIndex: number
  ): Promise<{ message: string; session: PhotoSession; operation: any }> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/reorder`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        set_key: setKey,
        from_index: fromIndex,
        to_index: toIndex
      }),
    });

    return handleResponse(response);
  }

  /**
   * Update session mode
   */
  async updateSessionMode(
    sessionId: string,
    mode: 'track' | 'turningpoint'
  ): Promise<{ message: string; session: PhotoSession }> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/mode`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode }),
    });

    return handleResponse(response);
  }

  /**
   * Update layout mode
   */
  async updateLayoutMode(
    sessionId: string,
    layoutMode: 'landscape' | 'portrait'
  ): Promise<{ message: string; session: PhotoSession }> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/layout-mode`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ layout_mode: layoutMode }),
    });

    return handleResponse(response);
  }

  /**
   * Update competition name
   */
  async updateCompetitionName(
    sessionId: string,
    competitionName: string
  ): Promise<{ message: string; session: PhotoSession }> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/competition`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ competition_name: competitionName }),
    });

    return handleResponse(response);
  }

  /**
   * Check if backend is available
   */
  async healthCheck(): Promise<{ message: string; status: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`);
      return handleResponse(response);
    } catch (error) {
      throw new ApiError('Backend not available. Make sure the backend server is running.');
    }
  }
}

// Export singleton instance
export const api = new PhotoOrganizerApi();
export { ApiError };
