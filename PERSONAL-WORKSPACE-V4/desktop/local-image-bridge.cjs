'use strict';

const { lstat, readFile } = require('node:fs/promises');
const path = require('node:path');

const MAX_LOCAL_IMAGE_BYTES = 8 * 1024 * 1024;

const formats = new Map([
  ['.png', { mime: 'image/png', matches: isPng }],
  ['.jpg', { mime: 'image/jpeg', matches: isJpeg }],
  ['.jpeg', { mime: 'image/jpeg', matches: isJpeg }],
  ['.webp', { mime: 'image/webp', matches: isWebp }],
]);

function isPng(buffer) {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function isJpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isWebp(buffer) {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

function unavailable(reason) {
  return { ok: false, reason };
}

async function readLocalImage(target) {
  if (
    typeof target !== 'string' ||
    target.length === 0 ||
    target.length > 32_767 ||
    target.includes('\0') ||
    !path.isAbsolute(target)
  ) {
    return unavailable('invalid-path');
  }

  const format = formats.get(path.extname(target).toLowerCase());
  if (!format) return unavailable('unsupported-format');

  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    return unavailable(error && error.code === 'ENOENT' ? 'missing' : 'read-failed');
  }

  if (!metadata.isFile() || metadata.isSymbolicLink()) return unavailable('not-file');
  if (metadata.size > MAX_LOCAL_IMAGE_BYTES) return unavailable('oversized');

  try {
    const content = await readFile(target);
    if (content.length > MAX_LOCAL_IMAGE_BYTES) return unavailable('oversized');
    if (!format.matches(content)) return unavailable('invalid-image');
    return { ok: true, src: `data:${format.mime};base64,${content.toString('base64')}` };
  } catch {
    return unavailable('read-failed');
  }
}

module.exports = { MAX_LOCAL_IMAGE_BYTES, readLocalImage };
