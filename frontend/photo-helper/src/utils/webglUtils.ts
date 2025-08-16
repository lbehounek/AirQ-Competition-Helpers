// WebGL-accelerated image processing utilities
// Fallback to CPU-based processing when WebGL is not available

export interface WebGLContext {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  textureCoordBuffer: WebGLBuffer;
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

// Fragment shader for sharpening effect
const sharpenFragmentShaderSource = `
  precision mediump float;
  uniform sampler2D u_image;
  uniform float u_sharpness;
  uniform vec2 u_textureSize;
  varying vec2 v_texCoord;
  
  void main() {
    vec2 onePixel = vec2(1.0) / u_textureSize;
    
    // Sample the center and surrounding pixels
    vec4 color = texture2D(u_image, v_texCoord);
    vec4 north = texture2D(u_image, v_texCoord + vec2(0.0, -onePixel.y));
    vec4 south = texture2D(u_image, v_texCoord + vec2(0.0, onePixel.y));
    vec4 east = texture2D(u_image, v_texCoord + vec2(onePixel.x, 0.0));
    vec4 west = texture2D(u_image, v_texCoord + vec2(-onePixel.x, 0.0));
    
    // Apply sharpening kernel
    // Center weight = 5 + sharpness, surrounding = -1 * sharpness/4
    float centerWeight = 1.0 + u_sharpness * 0.05;
    float edgeWeight = -u_sharpness * 0.0125;
    
    vec4 sharpened = color * centerWeight + 
                     (north + south + east + west) * edgeWeight;
    
    // Mix original and sharpened based on sharpness amount
    float mixAmount = u_sharpness * 0.01;
    gl_FragColor = mix(color, sharpened, mixAmount);
  }
`;

// Fragment shader for combined effects (brightness, contrast, etc.)
const combinedFragmentShaderSource = `
  precision mediump float;
  uniform sampler2D u_image;
  uniform float u_brightness;
  uniform float u_contrast;
  uniform float u_temperature;
  uniform float u_tint;
  varying vec2 v_texCoord;
  
  void main() {
    vec4 color = texture2D(u_image, v_texCoord);
    
    // Apply white balance (temperature and tint)
    if (abs(u_temperature) > 0.01 || abs(u_tint) > 0.01) {
      // Temperature: negative = blue, positive = yellow
      float tempAdjust = u_temperature * 0.015;
      color.r += tempAdjust;
      color.b -= tempAdjust;
      
      // Tint: negative = green, positive = magenta
      float tintAdjust = u_tint * 0.01;
      color.r += tintAdjust;
      color.g -= tintAdjust * 0.5;
      color.b += tintAdjust;
    }
    
    // Apply contrast first, then brightness
    color.rgb = (color.rgb - 0.5) * u_contrast + 0.5;
    color.rgb += u_brightness * 0.01;
    
    // Clamp values
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
    
    return {
      gl,
      canvas,
      program,
      positionBuffer,
      textureCoordBuffer,
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
  
  const { gl, canvas, program, positionBuffer, textureCoordBuffer } = webglContext;
  
  try {
    // Use the program
    gl.useProgram(program);
    
    // Set viewport
    gl.viewport(0, 0, canvas.width, canvas.height);
    
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
    
    gl.uniform1i(imageLocation, 0);
    gl.uniform1f(brightnessLocation, adjustments.brightness);
    gl.uniform1f(contrastLocation, adjustments.contrast);
    gl.uniform1f(temperatureLocation, adjustments.temperature);
    gl.uniform1f(tintLocation, adjustments.tint);
    gl.uniform1f(sharpnessLocation, adjustments.sharpness);
    gl.uniform2f(textureSizeLocation, canvas.width, canvas.height);
    
    // Draw
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    // Clean up texture
    gl.deleteTexture(texture);
    
    return canvas;
    
  } catch (error) {
    console.warn('WebGL processing failed:', error);
    return null;
  }
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
    
    // Clean up the test context immediately
    if (gl) {
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
export function getFragmentShaderForEffects(includeSharpness: boolean = false): string {
  if (includeSharpness) {
    // If sharpness is needed, we need a separate pass or more complex shader
    return sharpenFragmentShaderSource;
  }
  return combinedFragmentShaderSource;
}
