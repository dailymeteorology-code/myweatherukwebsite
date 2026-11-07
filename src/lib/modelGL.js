/* Model Data layers drawn on the graphics card, from their VALUES, at the resolution of the screen.

   A frame is one value per grid cell. Colouring the cells and stretching that small picture over the
   map is what made layers soft: the browser blends neighbouring COLOURS, so a sharp step in the
   colour scale smears into a band of colours that are not on the key, and an 8 km global model at UK
   zoom turns to mush (or to blocks, without the blending).

   Here every pixel of the canvas works out its own value and only then takes its colour, so a colour
   step is an exact line at any zoom, and a 4K export is as sharp as the screen:

     magnified   the value from the 4 x 4 cells around the pixel (Catmull-Rom, held inside the range of
                 the nearest four so peaks do not ring), or with `nearest` the cell itself, a true
                 square at its true edges, for "Pixels". With `soft`, for smooth fields, a cubic
                 B-spline instead: one byte a cell leaves a gentle gradient in little terraces, which
                 a colour step would trace as a staircase, and the spline irons them flat
     shrunk      several cells to a pixel: all of them are looked at and their colours averaged, so
                 nothing fine drops out of the map at the UK view
     band edges  the colour is read just either side of the value, so a step in the scale is
                 antialiased rather than a staircase

   No data stays no data: a pixel needs at least half its nearest cells' weight to have a value.
   The canvas here is never shown: lib/modelViewer copies from it onto the graphic straight after each
   draw, so it composes with everything else. Without WebGL 2 the page uses its old picture path. */

const LUT_SIZE = 2048;                                      // colours along the 0..254 byte range: far finer than any scale's steps
const MAX_CELLS = 24, MAX_LUTS = 40;                        // frames and colour tables kept on the card

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uCells;   // the frame's bytes: 0..254 values, 255 no data
uniform sampler2D uLut;     // ${LUT_SIZE} x 1 colours along those bytes
uniform ivec2 uSize;        // the frame's cells
uniform vec3 uTarget;       // where this region starts on the graphic, and this canvas's height
uniform vec3 uView;         // the graphic's point for uCentre, and canvas px per display cell
uniform vec2 uCentre;       // the display cell at that point
uniform float uK;           // display cells per frame cell
uniform int uNearest;       // 1: cells as they are
uniform int uSoft;          // 1: a smooth field: cubic B-spline
out vec4 outColour;
const float NONE = 254.5;

float cell(ivec2 c) { return texelFetch(uCells, clamp(c, ivec2(0), uSize - 1), 0).r * 255.0; }
vec4 colour(float b) {
  vec4 c = texelFetch(uLut, ivec2(int(clamp(b, 0.0, 254.0) * (${(LUT_SIZE - 1).toFixed(1)} / 254.0) + 0.5), 0), 0);
  return vec4(c.rgb * c.a, c.a);
}
vec4 catmull(float t) {
  return vec4(t * (-0.5 + t * (1.0 - 0.5 * t)), 1.0 + t * t * (-2.5 + 1.5 * t), t * (0.5 + t * (2.0 - 1.5 * t)), t * t * (-0.5 + 0.5 * t));
}
vec4 bspline(float t) {
  float u = 1.0 - t, t2 = t * t, t3 = t2 * t;
  return vec4(u * u * u, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
}
/* the value at a point in frame cells (cell i spans i..i+1), or -1 for no data */
float value(vec2 c) {
  vec2 f = c - 0.5, fl = floor(f), t = f - fl;
  ivec2 b = ivec2(fl);
  float p = cell(b), q = cell(b + ivec2(1, 0)), r = cell(b + ivec2(0, 1)), s = cell(b + ivec2(1, 1));
  if (p > NONE || q > NONE || r > NONE || s > NONE) {
    float wp = (1.0 - t.x) * (1.0 - t.y), wq = t.x * (1.0 - t.y), wr = (1.0 - t.x) * t.y, ws = t.x * t.y, sum = 0.0, n = 0.0;
    if (p < NONE) { sum += p * wp; n += wp; }
    if (q < NONE) { sum += q * wq; n += wq; }
    if (r < NONE) { sum += r * wr; n += wr; }
    if (s < NONE) { sum += s * ws; n += ws; }
    return n >= 0.5 ? sum / n : -1.0;
  }
  float lo = min(min(p, q), min(r, s)), hi = max(max(p, q), max(r, s));
  float mid = (lo + hi) * 0.5;
  vec4 wx = uSoft == 1 ? bspline(t.x) : catmull(t.x), wy = uSoft == 1 ? bspline(t.y) : catmull(t.y);
  float v = 0.0;
  for (int j = 0; j < 4; j++) {
    float row = 0.0;
    for (int i = 0; i < 4; i++) {
      float x = cell(b + ivec2(i - 1, j - 1));
      row += wx[i] * (x > NONE ? mid : x);
    }
    v += wy[j] * row;
  }
  return uSoft == 1 ? v : clamp(v, lo, hi);
}
void main() {
  vec2 px = uTarget.xy + vec2(gl_FragCoord.x, uTarget.z - gl_FragCoord.y);
  vec2 c = ((px - uView.xy) / uView.z + uCentre) / uK;
  float perCell = uView.z * uK;                 // canvas px per frame cell
  vec2 size = vec2(uSize);
  if (perCell < 0.95) {
    /* several cells to a pixel: all of them count */
    int n = clamp(int(ceil(1.0 / perCell)), 2, 4);
    float gap = 1.0 / (perCell * float(n));
    vec2 first = c - 0.5 / perCell + 0.5 * gap;
    vec4 sum = vec4(0.0);
    for (int j = 0; j < 4; j++) {
      if (j >= n) break;
      for (int i = 0; i < 4; i++) {
        if (i >= n) break;
        vec2 p = first + vec2(float(i), float(j)) * gap;
        if (p.x < 0.0 || p.y < 0.0 || p.x >= size.x || p.y >= size.y) continue;
        float b = cell(ivec2(floor(p)));
        if (b < NONE) sum += colour(b);
      }
    }
    outColour = sum / float(n * n);
    return;
  }
  bool out_ = c.x < 0.0 || c.y < 0.0 || c.x >= size.x || c.y >= size.y;
  if (uNearest == 1) {
    float b = out_ ? 255.0 : cell(ivec2(floor(c)));
    outColour = b < NONE ? colour(b) : vec4(0.0);
    return;
  }
  float v = out_ ? -1.0 : value(c);
  float d = min(fwidth(v) * 0.5, 8.0);
  outColour = v < 0.0 ? vec4(0.0) : (colour(v - d) + colour(v) * 2.0 + colour(v + d)) * 0.25;
}`;

let G = null, dead = typeof document === 'undefined';

function shader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
  return s;
}
function setup() {
  if (G || dead) return G;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 1024;
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('no WebGL 2');
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); G = null; dead = true; });
    canvas.addEventListener('webglcontextrestored', () => { dead = false; });
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'program');
    gl.useProgram(program);
    const at = (n) => gl.getUniformLocation(program, n);
    const u = { cells: at('uCells'), lut: at('uLut'), size: at('uSize'), target: at('uTarget'), view: at('uView'), centre: at('uCentre'), k: at('uK'), nearest: at('uNearest'), soft: at('uSoft') };
    gl.uniform1i(u.cells, 0);
    gl.uniform1i(u.lut, 1);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    G = { gl, canvas, u, cells: new Map(), luts: new Map() };
  } catch (e) {
    console.warn('[modelGL] drawing layers the old way:', e.message);
    dead = true;
    G = null;
  }
  return G;
}

/* a texture kept by key, least recently used out first */
function cached(map, key, limit, make) {
  let t = map.get(key);
  if (t) { map.delete(key); map.set(key, t); return t; }
  if (map.size >= limit) {
    const [oldKey, old] = map.entries().next().value;
    map.delete(oldKey);
    G.gl.deleteTexture(old);
  }
  t = make();
  map.set(key, t);
  return t;
}
function texture(unit) {
  const { gl } = G;
  const t = gl.createTexture();
  gl.activeTexture(unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** Can layers be drawn this way here? */
export const canDrawCells = () => !!setup();
export const lutSize = LUT_SIZE;

/** Draws a frame's region. a = { frame, q, W, H, K, lutKey, lut () => Uint8Array RGBA x LUT_SIZE,
    x, y, w, h (whole canvas px on the graphic), ox, oy (the graphic's point for cx, cy), s (canvas px
    per display cell), cx, cy, nearest, soft }. Returns the canvas holding it at its top left, or null. */
export function drawCells(a) {
  if (!setup()) return null;
  const { gl, canvas, u } = G;
  if (a.w > canvas.width || a.h > canvas.height) {
    canvas.width = Math.max(canvas.width, Math.ceil(a.w / 256) * 256);
    canvas.height = Math.max(canvas.height, Math.ceil(a.h / 256) * 256);
  }
  const cells = cached(G.cells, a.frame, MAX_CELLS, () => {
    const t = texture(gl.TEXTURE0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, a.W, a.H, 0, gl.RED, gl.UNSIGNED_BYTE, a.q);
    return t;
  });
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, cells);
  const lut = cached(G.luts, a.lutKey, MAX_LUTS, () => {
    const t = texture(gl.TEXTURE1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, a.lut());
    return t;
  });
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, lut);
  gl.viewport(0, canvas.height - a.h, a.w, a.h);
  gl.uniform2i(u.size, a.W, a.H);
  gl.uniform3f(u.target, a.x, a.y, canvas.height);
  gl.uniform3f(u.view, a.ox, a.oy, a.s);
  gl.uniform2f(u.centre, a.cx, a.cy);
  gl.uniform1f(u.k, a.K);
  gl.uniform1i(u.nearest, a.nearest ? 1 : 0);
  gl.uniform1i(u.soft, a.soft ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return canvas;
}
