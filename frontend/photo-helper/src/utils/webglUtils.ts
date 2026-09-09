// WebGL-accelerated image processing utilities
// Fallback to CPU-based processing when WebGL is not available

export interface WebGLContext {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  textureCoordBuffer: WebGLBuffer;
  /**
   * `gl.MAX_TEXTURE_SIZE` read once at creation. Cached on the context rather
   * than queried per draw: `getParameter` is cheap but it is on the interactive
   * slider path, and the limit cannot change for the life of a context.
   */
  maxTextureSize: number;
  cleanup: () => void;
}

// Vertex shader - standard for all image processing
const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

// NOTE: the standalone sharpen-only fragment shader that used to live here was
// removed — `combinedFragmentShaderSource` below implements the same 5-tap
// unsharp kernel alongside brightness/contrast/white-balance, and nothing ever
// compiled the standalone one. Recover it from git history if a sharpen-only
// pass is ever needed again.

// Fragment shader for combined effects (brightness, contrast, white balance, sharpening)
const combinedFragmentShaderSource = `
  precision mediump float;
  uniform sampler2D u_image;
  uniform float u_brightness;
  uniform float u_contrast;
  uniform float u_temperature;
  uniform float u_tint;
  uniform float u_sharpness;
  uniform vec2 u_textureSize;
  varying vec2 v_texCoord;
  
  void main() {
    vec4 color = texture2D(u_image, v_texCoord);
    
    // White balance (temperature and tint)
    if (abs(u_temperature) > 0.01 || abs(u_tint) > 0.01) {
      float tempAdjust = u_temperature * 0.015;
      color.r += tempAdjust;
      color.b -= tempAdjust;
      float tintAdjust = u_tint * 0.01;
      color.r += tintAdjust;
      color.g -= tintAdjust * 0.5;
      color.b += tintAdjust;
    }
    
    // Contrast then brightness
    color.rgb = (color.rgb - 0.5) * u_contrast + 0.5;
    color.rgb += u_brightness * 0.01;
    
    // Optional sharpening in texture space
    if (u_sharpness > 0.0) {
      vec2 onePixel = vec2(1.0) / u_textureSize;
      vec4 north = texture2D(u_image, v_texCoord + vec2(0.0, -onePixel.y));
      vec4 south = texture2D(u_image, v_texCoord + vec2(0.0, onePixel.y));
      vec4 east = texture2D(u_image, v_texCoord + vec2(onePixel.x, 0.0));
      vec4 west = texture2D(u_image, v_texCoord + vec2(-onePixel.x, 0.0));
      float centerWeight = 1.0 + u_sharpness * 0.05;
      float edgeWeight = -u_sharpness * 0.0125;
      vec4 sharpened = color * centerWeight + (north + south + east + west) * edgeWeight;
      float mixAmount = u_sharpness * 0.01;
      color = mix(color, sharpened, mixAmount);
    }
    
    color.rgb = clamp(color.rgb, 0.0, 1.0);
    gl_FragColor = color;
  }
`;

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program linking error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  
  return program;
}

export function initWebGLContext(width: number, height: number, fragmentShaderSource: string): WebGLContext | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext;
    if (!gl) {
      console.warn('WebGL not supported');
      return null;
    }
    
    // Create shaders
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    
    if (!vertexShader || !fragmentShader) return null;
    
    // Create program
    const program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) return null;
    
    // Create buffers
    const positionBuffer = gl.createBuffer();
    const textureCoordBuffer = gl.createBuffer();
    
    if (!positionBuffer || !textureCoordBuffer) return null;
    
    // Set up position buffer (full screen quad)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]), gl.STATIC_DRAW);
    
    // Set up texture coordinate buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      0, 0,
      1, 1,
      1, 0,
    ]), gl.STATIC_DRAW);
    
    const cleanup = () => {
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(textureCoordBuffer);
    };
    
    // Read the driver's texture limit once — `applyWebGLEffects` compares the
    // source size against it before uploading, because `texImage2D` beyond the
    // limit fails *silently* into a black texture rather than throwing.
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    return {
      gl,
      canvas,
      program,
      positionBuffer,
      textureCoordBuffer,
      maxTextureSize,
      cleanup
    };
  } catch (error) {
    console.warn('Failed to initialize WebGL:', error);
    return null;
  }
}

export interface ImageAdjustments {
  brightness: number;
  contrast: number;
  sharpness: number;
  temperature: number;
  tint: number;
}

export function applyWebGLEffects(
  sourceCanvas: HTMLCanvasElement,
  adjustments: ImageAdjustments,
  webglContext?: WebGLContext
): HTMLCanvasElement | null {
  if (!webglContext) return null;

  const { gl, canvas, program, positionBuffer, textureCoordBuffer, maxTextureSize } = webglContext;

  // Refuse sources the driver cannot hold in a texture. The PDF export feeds
  // this up to 4800x3600 (PDF_PHOTO_TARGET_WIDTH 1600 × the editor's max zoom
  // of 3.0), while old Intel/ANGLE devices report a 4096 limit — and
  // `texImage2D` past the limit does not throw, it produces a black texture
  // that would be printed onto the answer sheet. Checked BEFORE the resize
  // below so an oversize source never grows a pooled context's drawing buffer
  // for a draw we are about to abandon. Returning null hands the caller back
  // to its CPU fallback.
  if (sourceCanvas.width > maxTextureSize || sourceCanvas.height > maxTextureSize) {
    return null;
  }

  try {
    // Use the program
    gl.useProgram(program);

    // Ensure context size matches source to avoid scaling artifacts
    if (canvas.width !== sourceCanvas.width || canvas.height !== sourceCanvas.height) {
      canvas.width = sourceCanvas.width;
      canvas.height = sourceCanvas.height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Verify the drawing buffer actually became the size we asked for.
    // Chromium silently allocates a SMALLER buffer when the request exceeds
    // MAX_VIEWPORT_DIMS / MAX_RENDERBUFFER_SIZE or available GPU memory, and a
    // context that was lost between draws turns every subsequent gl call into
    // a no-op. Either way the caller's `drawImage(processedCanvas, …)` would
    // paint a stretched or black cell. Both reads are client-side state — no
    // GPU sync, unlike `gl.getError()`, which is deliberately never called
    // here because it would stall the interactive slider path.
    if (
      gl.isContextLost() ||
      gl.drawingBufferWidth !== canvas.width ||
      gl.drawingBufferHeight !== canvas.height
    ) {
      return null;
    }

    // Create texture from source canvas
    const texture = gl.createTexture();
    if (!texture) return null;
    
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    // Set up attributes
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
    
    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    
    gl.enableVertexAttribArray(texCoordLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
    
    // Set uniforms
    const imageLocation = gl.getUniformLocation(program, 'u_image');
    const brightnessLocation = gl.getUniformLocation(program, 'u_brightness');
    const contrastLocation = gl.getUniformLocation(program, 'u_contrast');
    const temperatureLocation = gl.getUniformLocation(program, 'u_temperature');
    const tintLocation = gl.getUniformLocation(program, 'u_tint');
    const sharpnessLocation = gl.getUniformLocation(program, 'u_sharpness');
    const textureSizeLocation = gl.getUniformLocation(program, 'u_textureSize');
    
    if (imageLocation) gl.uniform1i(imageLocation, 0);
    if (brightnessLocation) gl.uniform1f(brightnessLocation, adjustments.brightness);
    if (contrastLocation) gl.uniform1f(contrastLocation, adjustments.contrast);
    if (temperatureLocation) gl.uniform1f(temperatureLocation, adjustments.temperature);
    if (tintLocation) gl.uniform1f(tintLocation, adjustments.tint);
    if (sharpnessLocation) gl.uniform1f(sharpnessLocation, adjustments.sharpness);
    if (textureSizeLocation) gl.uniform2f(textureSizeLocation, sourceCanvas.width, sourceCanvas.height);
    
    // Draw
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    // Clean up texture
    gl.deleteTexture(texture);

    // A context lost *during* the draw leaves the canvas blank while every gl
    // call above returns without error, so this last check is what stops a
    // black cell reaching the PDF.
    if (gl.isContextLost()) return null;

    return canvas;

  } catch (error) {
    console.warn('WebGL processing failed:', error);
    return null;
  }
}

/**
 * Release a context's GL resources AND the underlying drawing buffer.
 *
 * Returns nothing. Safe to call on an already-lost context (no-op) and safe to
 * call twice, so callers can dispose eagerly and still keep a `finally` net.
 *
 * WHY this exists next to `cleanup()`: `cleanup()` only deletes the program,
 * shaders and buffers — the context itself (and its drawing buffer, up to
 * ~69 MB for a 4800x3600 export) stays alive until the GC gets around to it.
 * Chromium caps live WebGL contexts per page (~16) and evicts the OLDEST when
 * the cap is passed, so leaking export contexts would eventually kill the
 * editor's pooled ones. `WEBGL_lose_context` frees both immediately.
 */
export function loseWebGLContext(context: WebGLContext): void {
  if (context.gl.isContextLost()) return;
  context.cleanup();
  context.gl.getExtension('WEBGL_lose_context')?.loseContext();
}

// Check if WebGL is supported (cached result to avoid creating contexts)
let webglSupported: boolean | null = null;

export function isWebGLSupported(): boolean {
  if (webglSupported !== null) {
    return webglSupported;
  }

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    webglSupported = !!gl;
    
    // Clean up the test context immediately.
    // `getContext` is typed as returning the whole `RenderingContext` union
    // (2D included), so narrow on the WebGL-only method rather than casting.
    if (gl && 'getExtension' in gl) {
      const loseContext = gl.getExtension('WEBGL_lose_context');
      if (loseContext) {
        loseContext.loseContext();
      }
    }
    
    return webglSupported;
  } catch {
    webglSupported = false;
    return false;
  }
}

// Factory function to create appropriate shader based on effects needed
export function getFragmentShaderForEffects(_includeSharpness: boolean = false): string {
  // Use the combined shader that supports all effects (including sharpening).
  // The flag is retained for call-site readability only — there is a single
  // shader now, so there is nothing to select between.
  return combinedFragmentShaderSource;
}
