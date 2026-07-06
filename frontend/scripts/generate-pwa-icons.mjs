/**
 * PWA 圖示產生器（零相依：只用 Node 內建 zlib＋手寫 CRC32 產合法 PNG）。
 *
 * 設計書 §8.4 要求 PWA 地基有有效 PNG icons，且禁止抓外部資源（Satori/next-og 需字型＝外部，故不採用）。
 * 本腳本產生：icon-192.png、icon-512.png、apple-touch-icon-180.png，
 * 圖樣＝品牌綠底（#2d5016）＋白色「Z」點陣（等比放大填像素，blocky 佔位圖）。決定性、可重跑。
 *
 * 執行：Node 20 PATH 後 `node frontend/scripts/generate-pwa-icons.mjs`。
 * 產物寫入 frontend/public/icons/（供監工整合；本腳本不執行 git 操作）。
 */

import zlib from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ── 品牌色 ──────────────────────────────────────────────────────────────
const BG = [0x2d, 0x50, 0x16]; // 品牌綠 #2d5016（對應 --action-primary-bg warmpaper 值）
const FG = [0xff, 0xff, 0xff]; // 白

// ── 「Z」點陣（9×9，1＝白；粗體含 2px 橫槓與對角線）────────────────────────
const Z_BITMAP = [
  "111111111",
  "111111111",
  "000000110",
  "000001100",
  "000011000",
  "000110000",
  "001100000",
  "111111111",
  "111111111",
].map((row) => row.split("").map((ch) => ch === "1"));
const Z_ROWS = Z_BITMAP.length;
const Z_COLS = Z_BITMAP[0].length;

// ── CRC32（PNG 用 IEEE 多項式）──────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** 計算 buffer 的 CRC32。 */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 組一個 PNG chunk（長度＋類型＋資料＋CRC）。 */
function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * 產生指定尺寸的 PNG（品牌綠底＋白色 Z）。
 * @param {number} size 邊長（正方形）。
 * @returns {Buffer} PNG 位元組。
 */
function makeIconPng(size) {
  // 「Z」佔內部方塊，四周留 18% 邊距。
  const margin = Math.round(size * 0.18);
  const inner = size - margin * 2;
  const cellW = inner / Z_COLS;
  const cellH = inner / Z_ROWS;

  /** 取某像素顏色（Z 筆畫為白、其餘為底色）。 */
  const pixelAt = (x, y) => {
    const gx = x - margin;
    const gy = y - margin;
    if (gx < 0 || gy < 0 || gx >= inner || gy >= inner) return BG;
    const col = Math.floor(gx / cellW);
    const row = Math.floor(gy / cellH);
    if (row >= 0 && row < Z_ROWS && col >= 0 && col < Z_COLS && Z_BITMAP[row][col]) {
      return FG;
    }
    return BG;
  };

  // 原始影像：每列前置 filter byte(0) + RGBA 像素。
  const raw = Buffer.alloc(size * (1 + size * 4));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelAt(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = 255;
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── 輸出 ────────────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../public/icons");
mkdirSync(outDir, { recursive: true });

const targets = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "apple-touch-icon-180.png", size: 180 },
];

for (const { name, size } of targets) {
  const png = makeIconPng(size);
  const out = resolve(outDir, name);
  writeFileSync(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
}
console.log("PWA icons generated.");
