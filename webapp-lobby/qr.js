/**
 * Minimal QR Code generator — SVG output, zero dependencies.
 * Based on the QR code specification (ISO 18004).
 * Supports alphanumeric data up to ~150 chars (version 1-6, ECC-L).
 *
 * Usage:
 *   const svg = QR.toSVG('https://example.com', { size: 200 });
 *   document.getElementById('qr').innerHTML = svg;
 */
window.QR = (() => {
  'use strict';

  // ── GF(256) math for Reed-Solomon ──
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }

  function rsEncode(data, ecLen) {
    const gen = new Uint8Array(ecLen + 1);
    gen[0] = 1;
    for (let i = 0; i < ecLen; i++) {
      for (let j = i + 1; j >= 1; j--) {
        gen[j] = gen[j] ^ gfMul(gen[j - 1], EXP[i]);
      }
    }
    const msg = new Uint8Array(data.length + ecLen);
    msg.set(data);
    for (let i = 0; i < data.length; i++) {
      const coef = msg[i];
      if (coef !== 0) {
        for (let j = 0; j <= ecLen; j++) {
          msg[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return msg.slice(data.length);
  }

  // ── QR version parameters (versions 1-10, ECC level L) ──
  const VERSIONS = [
    null, // 0 unused
    { size: 21, dataBytes: 19, ecBytesPerBlock: 7, blocks: 1 },
    { size: 25, dataBytes: 34, ecBytesPerBlock: 10, blocks: 1 },
    { size: 29, dataBytes: 55, ecBytesPerBlock: 15, blocks: 1 },
    { size: 33, dataBytes: 80, ecBytesPerBlock: 20, blocks: 1 },
    { size: 37, dataBytes: 108, ecBytesPerBlock: 26, blocks: 1 },
    { size: 41, dataBytes: 136, ecBytesPerBlock: 18, blocks: 2 },
    { size: 45, dataBytes: 156, ecBytesPerBlock: 20, blocks: 2 },
    { size: 49, dataBytes: 194, ecBytesPerBlock: 24, blocks: 2 },
    { size: 53, dataBytes: 232, ecBytesPerBlock: 30, blocks: 2 },
    { size: 57, dataBytes: 274, ecBytesPerBlock: 18, blocks: 4 },
  ];

  // Alignment pattern positions per version
  const ALIGN = [
    null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  ];

  function pickVersion(byteLen) {
    for (let v = 1; v <= 10; v++) {
      // Byte mode: 4 (mode) + 8 (count) + data*8 + 4 (terminator) bits
      const capacity = VERSIONS[v].dataBytes;
      if (byteLen + 3 <= capacity) return v; // +3 for mode/count/terminator overhead
    }
    throw new Error('Data too long for QR (max ~270 bytes)');
  }

  // ── Encode data as byte mode ──
  function encodeData(text, version) {
    const utf8 = new TextEncoder().encode(text);
    const v = VERSIONS[version];
    const bits = [];

    function pushBits(val, len) {
      for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    }

    // Mode indicator: byte mode = 0100
    pushBits(0b0100, 4);
    // Character count (8 bits for versions 1-9, 16 for 10+)
    const countBits = version <= 9 ? 8 : 16;
    pushBits(utf8.length, countBits);
    // Data
    for (const b of utf8) pushBits(b, 8);
    // Terminator (up to 4 bits)
    const totalDataBits = v.dataBytes * 8;
    const termLen = Math.min(4, totalDataBits - bits.length);
    pushBits(0, termLen);
    // Pad to byte boundary
    while (bits.length % 8 !== 0) bits.push(0);
    // Pad bytes
    const padBytes = [0xEC, 0x11];
    let padIdx = 0;
    while (bits.length < totalDataBits) {
      pushBits(padBytes[padIdx % 2], 8);
      padIdx++;
    }

    // Convert bits to bytes
    const dataBytes = new Uint8Array(v.dataBytes);
    for (let i = 0; i < v.dataBytes; i++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) byte = (byte << 1) | (bits[i * 8 + b] || 0);
      dataBytes[i] = byte;
    }

    return dataBytes;
  }

  // ── Build interleaved codewords (data + EC) ──
  function buildCodewords(dataBytes, version) {
    const v = VERSIONS[version];
    const blockSize = Math.floor(v.dataBytes / v.blocks);
    const extraBlocks = v.dataBytes - blockSize * v.blocks;
    const ecLen = v.ecBytesPerBlock;

    const dataBlocks = [];
    const ecBlocks = [];
    let offset = 0;

    for (let i = 0; i < v.blocks; i++) {
      const len = blockSize + (i >= v.blocks - extraBlocks ? 1 : 0);
      const block = dataBytes.slice(offset, offset + len);
      offset += len;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, ecLen));
    }

    // Interleave
    const result = [];
    const maxDataLen = Math.max(...dataBlocks.map(b => b.length));
    for (let i = 0; i < maxDataLen; i++) {
      for (const block of dataBlocks) {
        if (i < block.length) result.push(block[i]);
      }
    }
    for (let i = 0; i < ecLen; i++) {
      for (const block of ecBlocks) {
        result.push(block[i]);
      }
    }
    return result;
  }

  // ── Matrix operations ──
  function createMatrix(size) {
    return Array.from({ length: size }, () => new Int8Array(size)); // 0=free, 1=black, -1=white(reserved)
  }

  function setModule(matrix, row, col, black) {
    if (row >= 0 && row < matrix.length && col >= 0 && col < matrix.length) {
      matrix[row][col] = black ? 1 : -1;
    }
  }

  function placeFinderPattern(matrix, row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const black = inInner || (inOuter && onBorder);
        setModule(matrix, row + r, col + c, black);
      }
    }
  }

  function placeAlignmentPattern(matrix, row, col) {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const black = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
        setModule(matrix, row + r, col + c, black);
      }
    }
  }

  function reserveFormatBits(matrix) {
    const n = matrix.length;
    // Horizontal & vertical strips around finder patterns
    for (let i = 0; i < 8; i++) {
      setModule(matrix, 8, i, false);
      setModule(matrix, i, 8, false);
      setModule(matrix, 8, n - 1 - i, false);
      setModule(matrix, n - 1 - i, 8, false);
    }
    setModule(matrix, 8, 8, false);
    // Dark module
    setModule(matrix, n - 8, 8, true);
  }

  function placeTimingPatterns(matrix) {
    const n = matrix.length;
    for (let i = 8; i < n - 8; i++) {
      const black = i % 2 === 0;
      if (matrix[6][i] === 0) setModule(matrix, 6, i, black);
      if (matrix[i][6] === 0) setModule(matrix, i, 6, black);
    }
  }

  function placeData(matrix, codewords) {
    const n = matrix.length;
    let bitIdx = 0;
    const totalBits = codewords.length * 8;

    // Data is placed in 2-column strips, right to left, alternating up/down
    let x = n - 1;
    let upward = true;

    while (x >= 0) {
      if (x === 6) x--; // Skip timing column
      const startRow = upward ? n - 1 : 0;
      const endRow = upward ? -1 : n;
      const step = upward ? -1 : 1;

      for (let y = startRow; y !== endRow; y += step) {
        for (let dx = 0; dx <= 1; dx++) {
          const col = x - dx;
          if (col < 0) continue;
          if (matrix[y][col] !== 0) continue; // reserved
          const black = bitIdx < totalBits ? (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1 : 0;
          matrix[y][col] = black ? 1 : -1;
          bitIdx++;
        }
      }
      x -= 2;
      upward = !upward;
    }
  }

  // ── Masking ──
  const MASK_FNS = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ];

  function applyMask(matrix, reserved, maskIdx) {
    const n = matrix.length;
    const fn = MASK_FNS[maskIdx];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (reserved[r][c] !== 0) continue;
        if (fn(r, c)) {
          matrix[r][c] = matrix[r][c] === 1 ? -1 : 1;
        }
      }
    }
  }

  // Format info (ECC level L = 01, mask patterns 0-7)
  const FORMAT_BITS = [
    0x77C4, 0x72F3, 0x7DAA, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976,
  ];

  function placeFormatBits(matrix, maskIdx) {
    const n = matrix.length;
    const bits = FORMAT_BITS[maskIdx];
    // Place around top-left finder
    const positions = [
      [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
      [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
    ];
    for (let i = 0; i < 15; i++) {
      const black = (bits >> (14 - i)) & 1;
      const [r, c] = positions[i];
      matrix[r][c] = black ? 1 : -1;
    }
    // Place along bottom-left and top-right
    for (let i = 0; i < 8; i++) {
      const black = (bits >> (14 - i)) & 1;
      matrix[n - 1 - i][8] = black ? 1 : -1;
    }
    for (let i = 8; i < 15; i++) {
      const black = (bits >> (14 - i)) & 1;
      matrix[8][n - 15 + i] = black ? 1 : -1;
    }
  }

  // ── Penalty score (simplified — pick mask with lowest penalty) ──
  function penaltyScore(matrix) {
    const n = matrix.length;
    let score = 0;
    // Rule 1: runs of same color in rows and columns
    for (let r = 0; r < n; r++) {
      let run = 1;
      for (let c = 1; c < n; c++) {
        if ((matrix[r][c] > 0) === (matrix[r][c - 1] > 0)) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score++;
        } else run = 1;
      }
    }
    for (let c = 0; c < n; c++) {
      let run = 1;
      for (let r = 1; r < n; r++) {
        if ((matrix[r][c] > 0) === (matrix[r - 1][c] > 0)) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score++;
        } else run = 1;
      }
    }
    return score;
  }

  // ── Main: generate QR matrix ──
  function generate(text) {
    const version = pickVersion(new TextEncoder().encode(text).length);
    const v = VERSIONS[version];
    const n = v.size;

    // Encode & build codewords
    const dataBytes = encodeData(text, version);
    const codewords = buildCodewords(dataBytes, version);

    // Create reserved matrix (to track which cells are fixed)
    const reserved = createMatrix(n);

    // Place finder patterns
    placeFinderPattern(reserved, 0, 0);
    placeFinderPattern(reserved, 0, n - 7);
    placeFinderPattern(reserved, n - 7, 0);

    // Alignment patterns
    const alignPos = ALIGN[version];
    if (alignPos.length >= 2) {
      for (const r of alignPos) {
        for (const c of alignPos) {
          // Skip if overlapping with finder pattern
          if (r <= 8 && c <= 8) continue;
          if (r <= 8 && c >= n - 8) continue;
          if (r >= n - 8 && c <= 8) continue;
          placeAlignmentPattern(reserved, r, c);
        }
      }
    }

    placeTimingPatterns(reserved);
    reserveFormatBits(reserved);

    // Create actual matrix & copy reserved cells
    const matrix = createMatrix(n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        matrix[r][c] = reserved[r][c];
      }
    }

    // Place data
    placeData(matrix, codewords);

    // Try all 8 masks, pick best
    let bestMask = 0;
    let bestPenalty = Infinity;
    for (let m = 0; m < 8; m++) {
      const trial = createMatrix(n);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) trial[r][c] = matrix[r][c];
      }
      applyMask(trial, reserved, m);
      placeFormatBits(trial, m);
      const p = penaltyScore(trial);
      if (p < bestPenalty) { bestPenalty = p; bestMask = m; }
    }

    // Apply best mask
    applyMask(matrix, reserved, bestMask);
    placeFormatBits(matrix, bestMask);

    return matrix;
  }

  // ── Render to SVG string ──
  function toSVG(text, opts = {}) {
    const size = opts.size || 200;
    const margin = opts.margin ?? 2;
    const fg = opts.fg || '#000';
    const bg = opts.bg || '#fff';

    const matrix = generate(text);
    const n = matrix.length;
    const total = n + margin * 2;
    const cellSize = size / total;

    let paths = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c] > 0) {
          const x = (c + margin) * cellSize;
          const y = (r + margin) * cellSize;
          paths += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" fill="${fg}"/>`;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="background:${bg};border-radius:8px;">
${paths}
</svg>`;
  }

  // ── Render to Data URL ──
  function toDataURL(text, opts = {}) {
    const svg = toSVG(text, opts);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  return { toSVG, toDataURL, generate };
})();
