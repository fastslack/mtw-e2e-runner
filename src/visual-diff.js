/**
 * Visual Diff Engine — zero-dependency pixel comparison for PNG screenshots.
 *
 * Uses Node's built-in zlib for PNG inflate/deflate. No external image libs.
 *
 * Comparison algorithm:
 *   1. Decode both PNGs to raw RGBA buffers
 *   2. For each pixel, compute YIQ perceptual color distance
 *   3. Pixels exceeding the threshold are marked as different
 *   4. Anti-aliasing pixels (edge pixels) can be optionally ignored
 *   5. Masked regions are skipped entirely
 *   6. Output: diff stats + optional diff PNG (red overlay on changed pixels)
 */

import fs from 'fs';
import zlib from 'zlib';

// ── PNG Decoder ───────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readChunks(buf) {
  const chunks = [];
  let offset = 8; // skip signature
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length; // 4 length + 4 type + data + 4 crc
  }
  return chunks;
}

function decodePNG(filePath) {
  const buf = fs.readFileSync(filePath);

  if (buf.compare(PNG_SIGNATURE, 0, 8, 0, 8) !== 0) {
    throw new Error(`Not a valid PNG file: ${filePath}`);
  }

  const chunks = readChunks(buf);
  const ihdr = chunks.find(c => c.type === 'IHDR');
  if (!ihdr) throw new Error('Missing IHDR chunk');

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];

  if (bitDepth !== 8) throw new Error(`Unsupported bit depth: ${bitDepth} (only 8-bit supported)`);
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`Unsupported color type: ${colorType} (only RGB=2 and RGBA=6 supported)`);
  }

  const hasAlpha = colorType === 6;
  const bpp = hasAlpha ? 4 : 3; // bytes per pixel in the raw data

  // Concatenate all IDAT chunks and decompress
  const idatData = Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data));
  const inflated = zlib.inflateSync(idatData);

  // Reverse scanline filters → raw RGBA
  const stride = width * bpp + 1; // +1 for filter byte
  const rgba = Buffer.alloc(width * height * 4);

  // Previous row for filter operations (starts as zeros)
  const prevRow = Buffer.alloc(width * bpp);

  for (let y = 0; y < height; y++) {
    const filterType = inflated[y * stride];
    const rowStart = y * stride + 1;
    const row = Buffer.alloc(width * bpp);

    for (let x = 0; x < width * bpp; x++) {
      const raw = inflated[rowStart + x];
      const a = x >= bpp ? row[x - bpp] : 0;          // left
      const b = prevRow[x];                              // above
      const c = x >= bpp ? prevRow[x - bpp] : 0;        // upper-left

      switch (filterType) {
        case 0: row[x] = raw; break;                                     // None
        case 1: row[x] = (raw + a) & 0xff; break;                        // Sub
        case 2: row[x] = (raw + b) & 0xff; break;                        // Up
        case 3: row[x] = (raw + ((a + b) >> 1)) & 0xff; break;           // Average
        case 4: row[x] = (raw + paethPredictor(a, b, c)) & 0xff; break;  // Paeth
        default: throw new Error(`Unknown PNG filter type: ${filterType}`);
      }
    }

    // Copy to RGBA output
    for (let x = 0; x < width; x++) {
      const srcIdx = x * bpp;
      const dstIdx = (y * width + x) * 4;
      rgba[dstIdx] = row[srcIdx];       // R
      rgba[dstIdx + 1] = row[srcIdx + 1]; // G
      rgba[dstIdx + 2] = row[srcIdx + 2]; // B
      rgba[dstIdx + 3] = hasAlpha ? row[srcIdx + 3] : 255; // A
    }

    row.copy(prevRow);
  }

  return { width, height, data: rgba };
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// ── PNG Encoder (minimal, for diff images) ────────────────────────────────────

function encodePNG(width, height, rgba) {
  // Build unfiltered scanlines (filter byte 0 = None for each row)
  const rawLines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawLines[y * (1 + width * 4)] = 0; // filter: None
    rgba.copy(rawLines, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(rawLines);

  // Build PNG file
  const chunks = [];

  // Signature
  chunks.push(PNG_SIGNATURE);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  chunks.push(makeChunk('IHDR', ihdr));

  // IDAT
  chunks.push(makeChunk('IDAT', compressed));

  // IEND
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function makeChunk(type, data) {
  const buf = Buffer.alloc(12 + data.length);
  buf.writeUInt32BE(data.length, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  buf.writeUInt32BE(crc32(buf.subarray(4, 8 + data.length)), 8 + data.length);
  return buf;
}

// CRC-32 (PNG uses CRC-32/ISO-HDLC)
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Pixel Comparison ──────────────────────────────────────────────────────────

/**
 * Computes perceptual color distance using YIQ color space.
 * YIQ weights human perception: luminance matters most, chrominance less.
 */
function colorDelta(img1, img2, idx1, idx2) {
  const r1 = img1[idx1], g1 = img1[idx1 + 1], b1 = img1[idx1 + 2], a1 = img1[idx1 + 3];
  const r2 = img2[idx2], g2 = img2[idx2 + 1], b2 = img2[idx2 + 2], a2 = img2[idx2 + 3];

  // Blend alpha to white background for fair comparison
  const rb1 = blend(r1, a1), gb1 = blend(g1, a1), bb1 = blend(b1, a1);
  const rb2 = blend(r2, a2), gb2 = blend(g2, a2), bb2 = blend(b2, a2);

  const y = rgb2y(rb1, gb1, bb1) - rgb2y(rb2, gb2, bb2);
  const i = rgb2i(rb1, gb1, bb1) - rgb2i(rb2, gb2, bb2);
  const q = rgb2q(rb1, gb1, bb1) - rgb2q(rb2, gb2, bb2);

  // Weight: Y (luminance) is most important, I and Q (chrominance) less
  return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
}

function blend(c, a) {
  return 255 + (c - 255) * (a / 255);
}
function rgb2y(r, g, b) { return r * 0.29889531 + g * 0.58662247 + b * 0.11448223; }
function rgb2i(r, g, b) { return r * 0.59597799 - g * 0.27417610 - b * 0.32180189; }
function rgb2q(r, g, b) { return r * 0.21147017 - g * 0.52261711 + b * 0.31114694; }

/**
 * Checks if a pixel is likely an anti-aliased edge pixel.
 * Looks at immediate neighbors — if few are similar and many differ, it's an edge.
 */
function isAntiAliased(img, x, y, width, height, otherImg) {
  const idx = (y * width + x) * 4;
  let similar = 0;
  let different = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = (ny * width + nx) * 4;
      const delta = colorDelta(img, img, idx, nIdx);
      if (delta < 15) similar++;
      else different++;
    }
  }

  // Anti-aliased: pixel differs from most neighbors (it's on an edge)
  // AND the corresponding pixel in the other image is also on an edge
  if (different < 3) return false;

  const otherIdx = idx;
  let otherSimilar = 0;
  let otherDifferent = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = (ny * width + nx) * 4;
      const delta = colorDelta(otherImg, otherImg, otherIdx, nIdx);
      if (delta < 15) otherSimilar++;
      else otherDifferent++;
    }
  }

  return otherDifferent >= 3;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compares two PNG images and returns diff statistics + optional diff image.
 *
 * @param {string} baselinePath  — Path to the "golden" reference PNG
 * @param {string} currentPath   — Path to the current/new screenshot PNG
 * @param {object} [options]     — Comparison options
 * @param {number} [options.threshold=0.1]   — Color distance threshold (0-1). Lower = stricter.
 * @param {boolean} [options.includeAntiAlias=false] — Count anti-aliased pixels as different
 * @param {Array}  [options.maskRegions=[]]  — Regions to ignore: [{ x, y, width, height }]
 * @param {string} [options.diffOutputPath]  — If set, writes a diff PNG highlighting changes
 * @param {object} [options.diffColor]       — Diff highlight color: { r, g, b } (default: red)
 * @returns {{ totalPixels, differentPixels, diffPercentage, matchPercentage, dimensions, passed, diffImagePath? }}
 */
export function compareImages(baselinePath, currentPath, options = {}) {
  const {
    threshold = 0.1,
    includeAntiAlias = false,
    maskRegions = [],
    diffOutputPath = null,
    diffColor = { r: 255, g: 0, b: 60 },
  } = options;

  const baseline = decodePNG(baselinePath);
  const current = decodePNG(currentPath);

  // Images must have the same dimensions for pixel comparison
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      totalPixels: baseline.width * baseline.height,
      differentPixels: baseline.width * baseline.height,
      diffPercentage: 1,
      matchPercentage: 0,
      dimensions: {
        baseline: { width: baseline.width, height: baseline.height },
        current: { width: current.width, height: current.height },
      },
      dimensionMismatch: true,
      passed: false,
      diffImagePath: null,
    };
  }

  const { width, height } = baseline;
  const totalPixels = width * height;
  const maxDelta = 35215 * threshold * threshold; // max YIQ distance scaled by threshold
  let differentPixels = 0;

  // Build mask lookup for O(1) checks
  const isMasked = buildMaskLookup(maskRegions, width, height);

  // Diff image buffer (semi-transparent overlay of original with red diff pixels)
  const diffData = diffOutputPath ? Buffer.alloc(width * height * 4) : null;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Skip masked regions
      if (isMasked(x, y)) {
        if (diffData) {
          // Show masked areas as semi-transparent gray
          diffData[idx] = 128;
          diffData[idx + 1] = 128;
          diffData[idx + 2] = 128;
          diffData[idx + 3] = 80;
        }
        continue;
      }

      const delta = colorDelta(baseline.data, current.data, idx, idx);

      if (delta > maxDelta) {
        // Check anti-aliasing
        if (!includeAntiAlias &&
            (isAntiAliased(baseline.data, x, y, width, height, current.data) ||
             isAntiAliased(current.data, x, y, width, height, baseline.data))) {
          // Anti-aliased pixel — show as faded yellow in diff
          if (diffData) {
            diffData[idx] = 255;
            diffData[idx + 1] = 255;
            diffData[idx + 2] = 0;
            diffData[idx + 3] = 40;
          }
          continue;
        }

        differentPixels++;
        if (diffData) {
          // Highlight difference in diff color
          diffData[idx] = diffColor.r;
          diffData[idx + 1] = diffColor.g;
          diffData[idx + 2] = diffColor.b;
          diffData[idx + 3] = 220;
        }
      } else if (diffData) {
        // Matching pixel — show dimmed version of current image
        diffData[idx] = current.data[idx];
        diffData[idx + 1] = current.data[idx + 1];
        diffData[idx + 2] = current.data[idx + 2];
        diffData[idx + 3] = 60; // very transparent
      }
    }
  }

  const diffPercentage = totalPixels > 0 ? differentPixels / totalPixels : 0;
  let diffImagePath = null;

  if (diffData && diffOutputPath) {
    const pngBuf = encodePNG(width, height, diffData);
    fs.writeFileSync(diffOutputPath, pngBuf);
    diffImagePath = diffOutputPath;
  }

  return {
    totalPixels,
    differentPixels,
    diffPercentage,
    matchPercentage: 1 - diffPercentage,
    dimensions: { width, height },
    passed: diffPercentage === 0,
    diffImagePath,
  };
}

/**
 * Compares two images with a pass/fail threshold.
 *
 * @param {string} baselinePath  — Path to golden reference
 * @param {string} currentPath   — Path to current screenshot
 * @param {number} [maxDiffPercent=0.02] — Max allowed diff percentage (0.02 = 2%)
 * @param {object} [options]     — Same options as compareImages()
 * @returns {{ passed, diffPercentage, differentPixels, totalPixels, diffImagePath?, error? }}
 */
export function assertVisualMatch(baselinePath, currentPath, maxDiffPercent = 0.02, options = {}) {
  if (!fs.existsSync(baselinePath)) {
    return { passed: false, error: `Baseline not found: ${baselinePath}`, diffPercentage: 1 };
  }
  if (!fs.existsSync(currentPath)) {
    return { passed: false, error: `Current screenshot not found: ${currentPath}`, diffPercentage: 1 };
  }

  const result = compareImages(baselinePath, currentPath, options);
  result.passed = result.diffPercentage <= maxDiffPercent;
  result.maxDiffPercent = maxDiffPercent;
  return result;
}

/**
 * Builds a fast mask lookup function from region definitions.
 * @param {Array<{x,y,width,height}>} regions
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @returns {(x: number, y: number) => boolean}
 */
function buildMaskLookup(regions, imgWidth, imgHeight) {
  if (!regions || regions.length === 0) return () => false;

  // For small numbers of regions, direct check is fast enough
  if (regions.length <= 4) {
    return (x, y) => {
      for (const r of regions) {
        if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return true;
      }
      return false;
    };
  }

  // For many regions, build a bitfield
  const mask = new Uint8Array(Math.ceil(imgWidth * imgHeight / 8));
  for (const r of regions) {
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(imgWidth, r.x + r.width);
    const y1 = Math.min(imgHeight, r.y + r.height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const bit = y * imgWidth + x;
        mask[bit >> 3] |= (1 << (bit & 7));
      }
    }
  }
  return (x, y) => {
    const bit = y * imgWidth + x;
    return (mask[bit >> 3] & (1 << (bit & 7))) !== 0;
  };
}

// ── Blank screenshot detection ─────────────────────────────────────────────
/**
 * Detects whether a PNG screenshot is "completely blank" — i.e. a single
 * uniform fill color (a white/empty page, a solid error frame, etc.).
 *
 * Strategy: decode to RGBA, sample pixels evenly (capped for speed), compute
 * the mean color, then count how many sampled pixels deviate from that mean by
 * more than `tolerance` on any channel. An image is blank when the fraction of
 * deviating pixels stays at/under `maxOutlierFraction` — this tolerates a few
 * stray pixels (a cursor, a 1px border) while still requiring a near-uniform
 * frame. Non-PNG or undecodable files are reported as not-blank so they are
 * never deleted by mistake.
 *
 * @param {string} filePath
 * @param {{tolerance?:number, maxOutlierFraction?:number, maxSamples?:number}} [opts]
 * @returns {{blank:boolean, color?:{r:number,g:number,b:number}, brightness?:number,
 *            width?:number, height?:number, outlierFraction?:number, error?:string}}
 */
export function isBlankImage(filePath, opts = {}) {
  const tolerance = opts.tolerance ?? 10;
  const maxOutlierFraction = opts.maxOutlierFraction ?? 0.005; // ≤0.5% off-color pixels
  const maxSamples = opts.maxSamples ?? 120000;

  let img;
  try {
    img = decodePNG(filePath);
  } catch (error) {
    return { blank: false, error: error.message };
  }

  const { width, height, data } = img;
  const totalPixels = width * height;
  if (totalPixels === 0) return { blank: false, width, height };

  // Even sampling stride so huge captures stay fast without missing regions.
  const step = Math.max(1, Math.floor(totalPixels / maxSamples));

  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  for (let p = 0; p < totalPixels; p += step) {
    const i = p * 4;
    sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2];
    n++;
  }
  const meanR = sumR / n, meanG = sumG / n, meanB = sumB / n;

  let outliers = 0;
  for (let p = 0; p < totalPixels; p += step) {
    const i = p * 4;
    if (Math.abs(data[i] - meanR) > tolerance ||
        Math.abs(data[i + 1] - meanG) > tolerance ||
        Math.abs(data[i + 2] - meanB) > tolerance) {
      outliers++;
    }
  }

  const outlierFraction = outliers / n;
  const color = { r: Math.round(meanR), g: Math.round(meanG), b: Math.round(meanB) };
  const brightness = Math.round((meanR + meanG + meanB) / 3);

  return {
    blank: outlierFraction <= maxOutlierFraction,
    color,
    brightness,
    width,
    height,
    outlierFraction: Math.round(outlierFraction * 1e4) / 1e4,
  };
}
