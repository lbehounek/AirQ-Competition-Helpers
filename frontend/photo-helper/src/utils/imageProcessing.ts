/**
 * Photo-domain pure helpers.
 *
 * WHY this file is short: it used to also carry `autoCropTo43`,
 * `loadImageFromFile`, `applyImageAdjustments` and `generatePhotoLabels`, none
 * of which had a single importer anywhere in `src` (tests included).
 * `applyImageAdjustments` was actively harmful to keep — a THIRD divergent
 * brightness/contrast implementation (brightness before contrast, no 2.55
 * scale) next to the WebGL shader and the CPU fallback in PhotoEditorApi, i.e.
 * exactly the wrong reference for whoever aligns those two. Recover any of
 * them from git history if a real caller ever appears.
 */

/**
 * Generate turning point labels: SP, TP1, TP2, ..., FP
 * Labels are generated dynamically based on actual photo counts:
 * - First photo: SP (Start Point)
 * - Middle photos: TP1, TP2, etc.
 * - Last photo: FP (Final Point)
 */
export const generateTurningPointLabels = (
  set1Count: number,
  set2Count: number,
  _layoutMode: 'landscape' | 'portrait' = 'landscape'
): { set1: string[], set2: string[] } => {
  const totalPhotos = set1Count + set2Count;

  // No photos - return empty arrays
  if (totalPhotos === 0) {
    return { set1: [], set2: [] };
  }

  // Generate labels based on actual photo count
  const allLabels: string[] = [];
  for (let i = 0; i < totalPhotos; i++) {
    if (i === 0) {
      allLabels.push('SP'); // First photo is Start Point
    } else if (i === totalPhotos - 1) {
      allLabels.push('FP'); // Last photo is Final Point
    } else {
      allLabels.push(`TP${i}`); // Middle photos are Turning Points
    }
  }

  // Distribute labels to match photo positions in each set
  return {
    set1: allLabels.slice(0, set1Count),
    set2: allLabels.slice(set1Count)
  };
};

/**
 * Validate if file is a supported image format
 */
export const isValidImageFile = (file: File): boolean => {
  // Accept various JPEG MIME types and PNG
  const validTypes = [
    'image/jpeg',
    'image/jpg', 
    'image/pjpeg', // Progressive JPEG
    'image/png'
  ];
  
  // `.test()` rather than `.match()`: match returns an array-or-null, which
  // made the whole expression `boolean | null` and not assignable to the
  // declared `boolean` return.
  const hasValidType = validTypes.includes(file.type) ||
    /\.(jpe?g|png)$/.test(file.name.toLowerCase()); // Fallback to file extension
  
  const hasValidSize = file.size <= 20 * 1024 * 1024; // 20MB limit
  
  return hasValidType && hasValidSize;
};
