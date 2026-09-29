#!/usr/bin/env node
// Generates all official CoinPulse logo and icon assets.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// --- CRC32 Table for PNG encoding ---
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgbaData) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0 (None)
    rgbaData.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Geometry & Signed Distance Field Helpers ---
function clamp(x, min, max) {
  return x < min ? min : x > max ? max : x;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0.0, 1.0);
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  return Math.hypot(dx, dy);
}

function sdRoundedBox(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const outDist = Math.hypot(Math.max(qx, 0.0), Math.max(qy, 0.0));
  const inDist = Math.min(Math.max(qx, qy), 0.0);
  return outDist + inDist - r;
}

// Pulse polyline points in 1024x1024 coordinate space
const PULSE_PTS = [
  [235, 483],
  [344, 483],
  [383, 441],
  [424, 543],
  [524, 311],
  [578, 595],
  [635, 483],
  [842, 483],
];

/**
 * Computes signed distance to the CoinPulse Gold Emblem (Ring + Integrated Pulse + Right Gap)
 * Negative inside the gold emblem, positive outside.
 */
function sdGoldEmblem(x, y) {
  const cx = 512;
  const cy = 512;
  const r = Math.hypot(x - cx, y - cy);

  // 1. Coin Ring Annulus: midline radius = 292.5, half-thickness = 35.5 (inner=257, outer=328)
  let dRing = Math.abs(r - 292.5) - 35.5;

  // Carve the crisp horizontal slot on the right side of the ring just above the right pulse bar
  // Slot center: x=798, y=440.5, halfW=65, halfH=9.0
  const dSlot = sdRoundedBox(x, y, 798, 440.5, 65.0, 9.0, 2.5);
  dRing = Math.max(dRing, -dSlot);

  // 2. Pulse Wave Polyline: half-thickness = 31.5
  let minSegDist = 1e9;
  for (let i = 0; i < PULSE_PTS.length - 1; i++) {
    const [ax, ay] = PULSE_PTS[i];
    const [bx, by] = PULSE_PTS[i + 1];
    const d = sdSegment(x, y, ax, ay, bx, by);
    if (d < minSegDist) minSegDist = d;
  }
  let dPulse = minSegDist - 31.5;

  // Clip the pulse wave cleanly inside the outer coin boundary (r <= 328)
  const dOuterCircle = r - 328.0;
  dPulse = Math.max(dPulse, dOuterCircle);

  // Smooth union of the Coin Ring and the Pulse Wave
  const k = 6.0;
  const h = clamp(0.5 + (0.5 * (dPulse - dRing)) / k, 0.0, 1.0);
  return lerp(dPulse, dRing, h) - k * h * (1.0 - h);
}

/**
 * Renders a 1024x1024 RGBA Buffer of the CoinPulse icon.
 * mode:
 * - 'squircle': Rounded-square icon with dark navy background (matching the user's image)
 * - 'round': Circular icon with dark navy background (for Android ic_launcher_round)
 * - 'adaptive_fg': Transparent background with emblem scaled to fit Android 108dp adaptive safe zone
 * - 'full_bg': Full-bleed dark navy background + emblem (for maskable / adaptive previews)
 */
function renderCoinPulseMaster(size, mode) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = size / 1024.0;

  // Precompute SDF grid on 1024x1024 (or target size) for fast finite-difference normals
  const sdfGrid = new Float32Array(size * size);
  const emblemScale = mode === 'adaptive_fg' ? 0.66 : mode === 'round' ? 0.92 : 1.0;

  for (let py = 0; py < size; py++) {
    const y0 = (py + 0.5) / scale;
    const ey = 512.0 + (y0 - 512.0) / emblemScale;
    const rowOffset = py * size;
    for (let px = 0; px < size; px++) {
      const x0 = (px + 0.5) / scale;
      const ex = 512.0 + (x0 - 512.0) / emblemScale;
      sdfGrid[rowOffset + px] = sdGoldEmblem(ex, ey) * emblemScale;
    }
  }

  // Three glowing cyan-blue sphere nodes on the orbit (R_orbit = 376)
  const nodes = [
    { cx: 512 + 376 * Math.cos((-46 * Math.PI) / 180), cy: 512 + 376 * Math.sin((-46 * Math.PI) / 180), r: 27.0 }, // Top-right (~1:30)
    { cx: 512 + 376 * Math.cos((176 * Math.PI) / 180), cy: 512 + 376 * Math.sin((176 * Math.PI) / 180), r: 22.5 }, // Middle-left (~9:00)
    { cx: 512 + 376 * Math.cos((44 * Math.PI) / 180), cy: 512 + 376 * Math.sin((44 * Math.PI) / 180), r: 24.0 },   // Bottom-right (~4:30)
  ];

  for (let py = 0; py < size; py++) {
    const yCanvas = (py + 0.5) / scale;
    const ey = 512.0 + (yCanvas - 512.0) / emblemScale;

    for (let px = 0; px < size; px++) {
      const xCanvas = (px + 0.5) / scale;
      const ex = 512.0 + (xCanvas - 512.0) / emblemScale;
      const idx = (py * size + px) * 4;

      // 1. Determine outer mask alpha (squircle, circle, full, or transparent)
      let bgMaskAlpha = 1.0;
      let rimHighlight = 0.0;
      if (mode === 'squircle') {
        const dBox = sdRoundedBox(xCanvas, yCanvas, 512, 512, 486, 486, 224);
        bgMaskAlpha = 1.0 - smoothstep(-1.2, 1.2, dBox);
        if (bgMaskAlpha <= 0.0) {
          buf[idx] = 0;
          buf[idx + 1] = 0;
          buf[idx + 2] = 0;
          buf[idx + 3] = 0;
          continue;
        }
        // Subtle 3D navy rim highlight near squircle border (stronger at top-left)
        const borderFactor = Math.exp(-Math.abs(dBox + 3.5) * 0.45);
        const tlWeight = clamp((1024 - xCanvas + (1024 - yCanvas)) / 1600.0, 0.15, 1.0);
        rimHighlight = borderFactor * tlWeight * 0.45;
      } else if (mode === 'round') {
        const dCirc = Math.hypot(xCanvas - 512, yCanvas - 512) - 486;
        bgMaskAlpha = 1.0 - smoothstep(-1.2, 1.2, dCirc);
        if (bgMaskAlpha <= 0.0) {
          buf[idx] = 0;
          buf[idx + 1] = 0;
          buf[idx + 2] = 0;
          buf[idx + 3] = 0;
          continue;
        }
        const borderFactor = Math.exp(-Math.abs(dCirc + 3.5) * 0.45);
        const tlWeight = clamp((1024 - xCanvas + (1024 - yCanvas)) / 1600.0, 0.15, 1.0);
        rimHighlight = borderFactor * tlWeight * 0.45;
      } else if (mode === 'adaptive_fg') {
        bgMaskAlpha = 0.0;
      }

      // 2. Base Dark Navy Background Color
      const distCenter = Math.hypot(ex - 490, ey - 465);
      const radialGlow = Math.exp(-(distCenter * distCenter) / (340.0 * 340.0));
      const innerCoinWell = Math.hypot(ex - 512, ey - 512) < 265 ? 1.0 : 0.0;
      const wellGlow = innerCoinWell * Math.exp(-Math.pow(Math.hypot(ex - 475, ey - 445) / 230.0, 2.0));

      // Top-left subtle navy ambient light
      const tlSheen = clamp(1.0 - (xCanvas * 0.65 + yCanvas * 0.75) / 1150.0, 0.0, 1.0);

      let rCol = 2 + radialGlow * 16 + wellGlow * 14 + tlSheen * 12 + rimHighlight * 45;
      let gCol = 6 + radialGlow * 42 + wellGlow * 34 + tlSheen * 28 + rimHighlight * 95;
      let bCol = 22 + radialGlow * 102 + wellGlow * 75 + tlSheen * 68 + rimHighlight * 195;
      let outAlpha = bgMaskAlpha;

      // 3. Electric Blue Orbit Ring (R_orbit = 376)
      const dxC = ex - 512.0;
      const dyC = ey - 512.0;
      const rCenter = Math.hypot(dxC, dyC);
      const dOrbit = Math.abs(rCenter - 376.0);

      // Angle in degrees [-180, 180] where 0 is 3 o'clock, -90 is 12 o'clock, +90 is 6 o'clock
      const deg = (Math.atan2(dyC, dxC) * 180.0) / Math.PI;

      // Modulate orbit intensity around the circle to match the reference logo's dynamic arcs
      let arcIntensity = 0.88;
      // Slight taper at top-left (-125 deg) and bottom-left (+108 deg) and right gap (+23 deg)
      const dip1 = Math.exp(-Math.pow((deg - -122) / 18.0, 2.0)) * 0.72;
      const dip2 = Math.exp(-Math.pow((deg - 106) / 16.0, 2.0)) * 0.72;
      const dip3 = Math.exp(-Math.pow((deg - 23) / 9.0, 2.0)) * 0.55;
      arcIntensity = clamp(1.0 - dip1 - dip2 - dip3, 0.14, 1.0);

      if (dOrbit < 48.0) {
        // Soft electric blue neon outer bloom + bright cyan-blue core line
        const outerGlow = Math.exp(-dOrbit / 11.5) * 0.58 * arcIntensity;
        const coreLine = (1.0 - smoothstep(3.2, 6.2, dOrbit)) * 0.95 * arcIntensity;
        const innerHot = (1.0 - smoothstep(0.0, 2.8, dOrbit)) * 0.65 * arcIntensity;

        const orbitR = outerGlow * 0 + coreLine * 18 + innerHot * 110;
        const orbitG = outerGlow * 105 + coreLine * 195 + innerHot * 245;
        const orbitB = outerGlow * 255 + coreLine * 255 + innerHot * 255;
        const orbitAlpha = clamp(outerGlow + coreLine, 0.0, 1.0);

        if (mode === 'adaptive_fg') {
          rCol += orbitR;
          gCol += orbitG;
          bCol += orbitB;
          outAlpha = clamp(outAlpha + orbitAlpha * (1.0 - outAlpha), 0.0, 1.0);
        } else {
          rCol += orbitR;
          gCol += orbitG;
          bCol += orbitB;
        }
      }

      // 4. Three Glowing 3D Cyan-Blue Sphere Nodes on the Orbit
      for (let n = 0; n < nodes.length; n++) {
        const node = nodes[n];
        const ndx = ex - node.cx;
        const ndy = ey - node.cy;
        const nd = Math.hypot(ndx, ndy);

        if (nd < node.r * 2.8) {
          // Neon cyan-blue halo around sphere
          const halo = Math.exp(-Math.max(0, nd - node.r * 0.65) / 11.0) * 0.55;
          rCol += halo * 10;
          gCol += halo * 165;
          bCol += halo * 255;
          if (mode === 'adaptive_fg') {
            outAlpha = clamp(outAlpha + halo * 0.85 * (1.0 - outAlpha), 0.0, 1.0);
          }

          // 3D Sphere Body
          const sphereCov = 1.0 - smoothstep(node.r - 1.2, node.r + 1.2, nd);
          if (sphereCov > 0.0) {
            const snx = (ndx / node.r) * 0.85;
            const sny = (ndy / node.r) * 0.85;
            const snz = Math.sqrt(Math.max(0.0, 1.0 - snx * snx - sny * sny));
            // Light from top-left (-0.45, -0.55, 0.70)
            const diff = clamp(-0.45 * snx - 0.55 * sny + 0.7 * snz, 0.0, 1.0);
            const spec = Math.pow(clamp(-0.35 * snx - 0.45 * sny + 0.82 * snz, 0.0, 1.0), 10.0);

            const sr = lerp(0, 48, diff) + spec * 155;
            const sg = lerp(115, 232, diff) + spec * 50;
            const sb = lerp(225, 255, diff) + spec * 30;

            rCol = lerp(rCol, sr, sphereCov);
            gCol = lerp(gCol, sg, sphereCov);
            bCol = lerp(bCol, sb, sphereCov);
            if (mode === 'adaptive_fg') {
              outAlpha = clamp(outAlpha + sphereCov * (1.0 - outAlpha), 0.0, 1.0);
            }
          }
        }
      }

      // 5. Deep Drop Shadow Beneath the 3D Gold Coin & Pulse Symbol
      const shPx = clamp(Math.round(px - 7 * scale), 0, size - 1);
      const shPy = clamp(Math.round(py - 14 * scale), 0, size - 1);
      const dShadow = sdfGrid[shPy * size + shPx];
      if (dShadow < 28.0 && mode !== 'adaptive_fg') {
        const shStrength = (1.0 - smoothstep(-6.0, 24.0, dShadow)) * 0.74;
        rCol *= 1.0 - shStrength;
        gCol *= 1.0 - shStrength;
        bCol *= 1.0 - shStrength * 0.88;
      }

      // 6. 3D Extruded Lower/Right Bevel Wall of Gold Coin & Pulse Symbol
      const extPx = clamp(Math.round(px - 3.5 * scale), 0, size - 1);
      const extPy = clamp(Math.round(py - 7.5 * scale), 0, size - 1);
      const dExtrude = sdfGrid[extPy * size + extPx];
      if (dExtrude < 1.2) {
        const extCov = 1.0 - smoothstep(-1.2, 1.2, dExtrude);
        const extGrad = clamp((ey - 180.0) / 660.0, 0.0, 1.0);
        const er = lerp(215, 135, extGrad);
        const eg = lerp(120, 58, extGrad);
        const eb = lerp(10, 4, extGrad);

        rCol = lerp(rCol, er, extCov);
        gCol = lerp(gCol, eg, extCov);
        bCol = lerp(bCol, eb, extCov);
        if (mode === 'adaptive_fg') {
          outAlpha = clamp(outAlpha + extCov * (1.0 - outAlpha), 0.0, 1.0);
        }
      }

      // 7. Main 3D Metallic Gold Coin Ring & Pulse Wave
      const dGold = sdfGrid[py * size + px];
      if (dGold < 1.25) {
        const goldCov = 1.0 - smoothstep(-1.25, 1.25, dGold);

        // Compute SDF gradient (outward normal in 2D) via finite differences
        const pxL = Math.max(0, px - 1);
        const pxR = Math.min(size - 1, px + 1);
        const pyU = Math.max(0, py - 1);
        const pyD = Math.min(size - 1, py + 1);
        const gx = (sdfGrid[py * size + pxR] - sdfGrid[py * size + pxL]) * 0.5 * scale;
        const gy = (sdfGrid[pyD * size + px] - sdfGrid[pyU * size + px]) * 0.5 * scale;
        const gLen = Math.hypot(gx, gy) + 1e-6;
        const nx2d = gx / gLen;
        const ny2d = gy / gLen;

        // Depth inside gold shape (0 at boundary -> ~35 at center ridge)
        const depth = Math.max(0.0, -dGold);

        // 3D Chamfer Bevel profile: steep bevel on outer 11.5px, smooth flat/domed top inside
        const bevelZone = 1.0 - smoothstep(3.0, 12.5, depth);
        const slopeXY = lerp(0.16, 0.78, bevelZone);
        const nx = nx2d * slopeXY;
        const ny = ny2d * slopeXY;
        const nz = Math.sqrt(Math.max(0.05, 1.0 - nx * nx - ny * ny));

        // Primary Key Light from top-left (-0.52, -0.64, 0.56)
        const keyDot = clamp(-0.52 * nx - 0.64 * ny + 0.56 * nz, 0.0, 1.0);
        // Secondary Warm Fill Light from bottom-left (-0.18, 0.68, 0.71)
        const fillDot = clamp(-0.18 * nx + 0.68 * ny + 0.71 * nz, 0.0, 1.0);
        // Rim / Back Light from top-right (0.55, -0.45, 0.70)
        const rimDot = clamp(0.55 * nx - 0.45 * ny + 0.7 * nz, 0.0, 1.0);

        // Metallic Gold Base Color Gradient across the coin
        const diagT = clamp(((ex - 180.0) * 0.45 + (ey - 180.0) * 0.55) / 660.0, 0.0, 1.0);

        // Combine studio lighting for rich 24K metallic gold
        const lightLevel = clamp(
          0.22 + keyDot * 0.68 + fillDot * 0.28 + rimDot * 0.16 - diagT * 0.1,
          0.0,
          1.25
        );

        // Specular highlights on bevels and top face
        const specKey = Math.pow(clamp(-0.38 * nx - 0.48 * ny + 0.79 * nz, 0.0, 1.0), 14.0);
        const specBottom = Math.pow(clamp(0.0 * nx + 0.48 * ny + 0.87 * nz, 0.0, 1.0), 18.0);

        // Two signature rim hotspots matching the reference image:
        // 1) Top-left rim gleam around (335, 255)
        // 2) Bottom rim gleam around (512, 825)
        const hot1 = Math.exp(-(Math.pow(ex - 335, 2) + Math.pow(ey - 255, 2)) / (105.0 * 105.0));
        const hot2 = Math.exp(-(Math.pow(ex - 512, 2) + Math.pow(ey - 825, 2)) / (95.0 * 95.0));
        // 3) Central pulse peak gleam around (515, 345)
        const hotPeak = Math.exp(-(Math.pow(ex - 515, 2) + Math.pow(ey - 350, 2)) / (110.0 * 110.0));

        const totalSpec =
          specKey * 0.52 +
          specBottom * 0.24 +
          hot1 * 0.55 +
          hot2 * 0.48 +
          hotPeak * 0.32;

        // Gold color ramp from deep burnished amber -> rich gold -> bright champagne gold
        let gr = clamp(lerp(175, 255, clamp(lightLevel, 0.0, 1.0)) + totalSpec * 80, 0, 255);
        let gg = clamp(lerp(82, 206, clamp(lightLevel, 0.0, 1.0)) + totalSpec * 95, 0, 255);
        let gb = clamp(lerp(4, 34, clamp(lightLevel, 0.0, 1.0)) + totalSpec * 175, 0, 255);

        // Darken bottom-right bevel walls slightly for crisp 3D depth
        const shadowBevel = clamp(0.48 * nx2d + 0.62 * ny2d, 0.0, 1.0) * bevelZone;
        gr *= 1.0 - shadowBevel * 0.28;
        gg *= 1.0 - shadowBevel * 0.42;
        gb *= 1.0 - shadowBevel * 0.55;

        if (mode === 'adaptive_fg' && outAlpha < 0.01) {
          rCol = gr;
          gCol = gg;
          bCol = gb;
        } else {
          rCol = lerp(rCol, gr, goldCov);
          gCol = lerp(gCol, gg, goldCov);
          bCol = lerp(bCol, gb, goldCov);
        }
        if (mode === 'adaptive_fg') {
          outAlpha = clamp(outAlpha + goldCov * (1.0 - outAlpha), 0.0, 1.0);
        }
      }

      buf[idx] = clamp(Math.round(rCol), 0, 255);
      buf[idx + 1] = clamp(Math.round(gCol), 0, 255);
      buf[idx + 2] = clamp(Math.round(bCol), 0, 255);
      buf[idx + 3] = clamp(Math.round(outAlpha * 255), 0, 255);
    }
  }

  return encodePNG(size, size, buf);
}

function resizePng(srcPath, destPath, width, height) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  execFileSync('convert', [
    srcPath,
    '-filter',
    'Lanczos',
    '-resize',
    `${width}x${height}!`,
    `PNG32:${destPath}`,
  ]);
}

function generateSplashPng(logoSrcPath, splashDestPath, width, height) {
  fs.mkdirSync(path.dirname(splashDestPath), { recursive: true });
  const iconSize = Math.round(Math.min(width, height) * 0.34);
  execFileSync('convert', [
    '-size',
    `${width}x${height}`,
    'radial-gradient:#0D2356-#020614',
    '(',
    logoSrcPath,
    '-filter',
    'Lanczos',
    '-resize',
    `${iconSize}x${iconSize}`,
    ')',
    '-gravity',
    'center',
    '-composite',
    `PNG32:${splashDestPath}`,
  ]);
}

function main() {
  const publicDir = path.join(ROOT_DIR, 'public');
  fs.mkdirSync(publicDir, { recursive: true });

  console.log('Rendering 1024x1024 master CoinPulse icons...');
  const masterSquirclePng = renderCoinPulseMaster(1024, 'squircle');
  const masterRoundPng = renderCoinPulseMaster(1024, 'round');
  const masterAdaptiveFgPng = renderCoinPulseMaster(1024, 'adaptive_fg');

  const tmpSquircle = '/tmp/coinpulse_master_squircle.png';
  const tmpRound = '/tmp/coinpulse_master_round.png';
  const tmpFg = '/tmp/coinpulse_master_fg.png';

  fs.writeFileSync(tmpSquircle, masterSquirclePng);
  fs.writeFileSync(tmpRound, masterRoundPng);
  fs.writeFileSync(tmpFg, masterAdaptiveFgPng);

  // 1. Web / PWA / Favicon PNGs
  const webTargets = [
    ['logo.png', 512],
    ['icon-512.png', 512],
    ['icon-192.png', 192],
    ['apple-touch-icon.png', 180],
    ['favicon.png', 64],
  ];
  for (const [name, sz] of webTargets) {
    resizePng(tmpSquircle, path.join(publicDir, name), sz, sz);
  }

  // 2. Android mipmap-* Launcher Icons (Legacy Square/Squircle, Round, and Adaptive Foreground)
  const androidResDir = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res');
  const mipmapConfigs = [
    ['mipmap-mdpi', 48, 108],
    ['mipmap-hdpi', 72, 162],
    ['mipmap-xhdpi', 96, 216],
    ['mipmap-xxhdpi', 144, 324],
    ['mipmap-xxxhdpi', 192, 432],
  ];

  for (const [folder, launcherSize, fgSize] of mipmapConfigs) {
    const dir = path.join(androidResDir, folder);
    resizePng(tmpSquircle, path.join(dir, 'ic_launcher.png'), launcherSize, launcherSize);
    resizePng(tmpRound, path.join(dir, 'ic_launcher_round.png'), launcherSize, launcherSize);
    resizePng(tmpFg, path.join(dir, 'ic_launcher_foreground.png'), fgSize, fgSize);
  }

  // 3. Android Splash Screens
  const splashConfigs = [
    ['drawable', 480, 320],
    ['drawable-land-mdpi', 480, 320],
    ['drawable-land-hdpi', 800, 480],
    ['drawable-land-xhdpi', 1280, 720],
    ['drawable-land-xxhdpi', 1600, 960],
    ['drawable-land-xxxhdpi', 1920, 1280],
    ['drawable-port-mdpi', 320, 480],
    ['drawable-port-hdpi', 480, 800],
    ['drawable-port-xhdpi', 720, 1280],
    ['drawable-port-xxhdpi', 960, 1600],
    ['drawable-port-xxxhdpi', 1280, 1920],
  ];
  for (const [folder, w, h] of splashConfigs) {
    const dir = path.join(androidResDir, folder);
    if (fs.existsSync(dir)) {
      generateSplashPng(tmpSquircle, path.join(dir, 'splash.png'), w, h);
    }
  }

  console.log('All CoinPulse PNG icon and splash assets generated successfully.');
}

main();
