// Synthesize tiny GPS-tagged JPEGs for E2E fixtures.
//
// The map-corridors import pipeline classifies a photo as "has GPS" purely from
// EXIF (`exifr.gps`), so any test of the real import flow needs genuinely
// GPS-tagged bytes — the committed `fixtures/photo.jpg` carries none, which is
// why the full map→editor handoff E2E was left as a `test.fixme`.
//
// Generating them at test time (rather than committing photos) keeps the repo
// free of binaries, lets each test choose its own coordinates — co-located
// photos, distinct points, deliberately missing GPS — and makes the EXIF the
// test depends on visible in code instead of buried in an opaque file.
//
// Implementation: splice an APP1/Exif segment in right after the SOI marker of
// a minimal baseline JPEG. Only the GPS IFD (plus an optional DateTimeOriginal)
// is written — everything the importer reads, nothing it doesn't.

import { writeFileSync } from 'node:fs';

/** Minimal 1x1 baseline JPEG. Decodes in Chromium; carries no EXIF of its own. */
const BLANK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEB' +
  'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
  'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
  'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiiv/9k=';

/** One EXIF RATIONAL: numerator/denominator, both unsigned 32-bit LE. */
function rational(num: number, den: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(Math.round(num), 0);
  b.writeUInt32LE(Math.round(den), 4);
  return b;
}

/**
 * Split a decimal degree into the EXIF degrees/minutes/seconds triple.
 * Seconds keep 4 decimal places (denominator 10000) — well past the precision
 * any camera writes, so a round-trip through exifr returns the input.
 */
function dmsRationals(decimal: number): Buffer {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  return Buffer.concat([rational(deg, 1), rational(min, 1), rational(sec * 10000, 10000)]);
}

type IfdEntry = {
  tag: number;
  /** 2 = ASCII, 4 = LONG, 5 = RATIONAL. */
  type: number;
  count: number;
  /** Inline 4-byte payload, or external data appended after the IFD. */
  inline?: Buffer;
  external?: Buffer;
};

/**
 * Serialize one IFD plus its external data block.
 * `startOffset` is the IFD's own offset within the TIFF block, needed because
 * every external value is addressed as an absolute TIFF offset.
 */
function buildIfd(entries: IfdEntry[], startOffset: number, nextIfdOffset = 0): Buffer {
  // Tags must be written in ascending order — some parsers binary-search them.
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const header = Buffer.alloc(2 + sorted.length * 12 + 4);
  header.writeUInt16LE(sorted.length, 0);

  let dataOffset = startOffset + header.length;
  const dataChunks: Buffer[] = [];

  sorted.forEach((e, i) => {
    const at = 2 + i * 12;
    header.writeUInt16LE(e.tag, at);
    header.writeUInt16LE(e.type, at + 2);
    header.writeUInt32LE(e.count, at + 4);
    if (e.external) {
      header.writeUInt32LE(dataOffset, at + 8);
      dataChunks.push(e.external);
      dataOffset += e.external.length;
    } else {
      (e.inline ?? Buffer.alloc(4)).copy(header, at + 8, 0, 4);
    }
  });

  header.writeUInt32LE(nextIfdOffset, 2 + sorted.length * 12);
  return Buffer.concat([header, ...dataChunks]);
}

export type GpsPhotoOptions = {
  /** Decimal degrees. Omit BOTH to produce a photo with no GPS at all. */
  lat?: number;
  lng?: number;
  /** EXIF DateTimeOriginal as `YYYY:MM:DD HH:MM:SS`. */
  dateTimeOriginal?: string;
};

/** Assemble the TIFF block (IFD0 → GPS IFD / Exif IFD) that APP1 wraps. */
function buildTiff(opts: GpsPhotoOptions): Buffer {
  const tiffHeader = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]); // "II*\0", IFD0 @ 8

  const hasGps = opts.lat !== undefined && opts.lng !== undefined;
  const ifd0Entries: IfdEntry[] = [];
  // IFD0 holds only pointers here; its size is fixed by the entry count, so the
  // sub-IFDs' offsets are known before their contents are built.
  const ifd0Size = 2 + (hasGps ? 1 : 0) * 12 + (opts.dateTimeOriginal ? 1 : 0) * 12 + 4;
  let cursor = 8 + ifd0Size;

  const blocks: { offset: number; buf: Buffer }[] = [];

  if (hasGps) {
    const gps = buildIfd(
      [
        { tag: 0x0001, type: 2, count: 2, inline: Buffer.from([opts.lat! >= 0 ? 0x4e : 0x53, 0, 0, 0]) }, // N/S
        { tag: 0x0002, type: 5, count: 3, external: dmsRationals(opts.lat!) },
        { tag: 0x0003, type: 2, count: 2, inline: Buffer.from([opts.lng! >= 0 ? 0x45 : 0x57, 0, 0, 0]) }, // E/W
        { tag: 0x0004, type: 5, count: 3, external: dmsRationals(opts.lng!) },
      ],
      cursor,
    );
    const ptr = Buffer.alloc(4);
    ptr.writeUInt32LE(cursor, 0);
    ifd0Entries.push({ tag: 0x8825, type: 4, count: 1, inline: ptr }); // GPSInfoIFDPointer
    blocks.push({ offset: cursor, buf: gps });
    cursor += gps.length;
  }

  if (opts.dateTimeOriginal) {
    const value = Buffer.from(`${opts.dateTimeOriginal}\0`, 'ascii');
    const exif = buildIfd([{ tag: 0x9003, type: 2, count: value.length, external: value }], cursor);
    const ptr = Buffer.alloc(4);
    ptr.writeUInt32LE(cursor, 0);
    ifd0Entries.push({ tag: 0x8769, type: 4, count: 1, inline: ptr }); // ExifIFDPointer
    blocks.push({ offset: cursor, buf: exif });
    cursor += exif.length;
  }

  const ifd0 = buildIfd(ifd0Entries, 8);
  if (ifd0.length !== ifd0Size) {
    // Guards the hand-computed offsets above: if IFD0 ever grows external data,
    // every sub-IFD pointer silently shifts and exifr reads garbage.
    throw new Error(`IFD0 size mismatch: predicted ${ifd0Size}, built ${ifd0.length}`);
  }
  return Buffer.concat([tiffHeader, ifd0, ...blocks.map((b) => b.buf)]);
}

/**
 * Write a tiny JPEG carrying the given GPS coordinates to `filePath`.
 * Returns the path for convenient inlining into `setInputFiles`.
 */
export function writeGpsJpeg(filePath: string, opts: GpsPhotoOptions = {}): string {
  const base = Buffer.from(BLANK_JPEG_BASE64, 'base64');
  const hasExif = opts.lat !== undefined || opts.dateTimeOriginal !== undefined;

  if (!hasExif) {
    writeFileSync(filePath, base);
    return filePath;
  }

  const tiff = buildTiff(opts);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2); // segment length includes these 2 bytes

  // SOI (2 bytes) stays first; APP1 must precede every other segment.
  writeFileSync(filePath, Buffer.concat([base.subarray(0, 2), app1, payload, base.subarray(2)]));
  return filePath;
}
