export const ASSIGNMENT_AUDIO_MAX_BYTES = 8 * 1024 * 1024;

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'aac']);

function startsWithBytes(buffer, bytes, offset = 0) {
  if (!Buffer.isBuffer(buffer) || buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

export function decodeAudioFileName(value) {
  let decoded = String(value || '').trim();
  try { decoded = decodeURIComponent(decoded); } catch { /* giữ tên gốc nếu header không encode */ }
  const clean = decoded
    .replace(/[\r\n\0]/g, '')
    .replace(/[\\/]/g, '_')
    .trim()
    .slice(0, 255);
  return clean || 'bai-nghe';
}

export function audioFileExtension(fileName) {
  const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

export function detectAudioMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  // AAC ADTS frame sync phải kiểm tra trước MPEG vì cùng bắt đầu bằng 0xff.
  if (buffer[0] === 0xff && (buffer[1] === 0xf1 || buffer[1] === 0xf9)) return 'audio/aac';

  // MP3: ID3 tag hoặc MPEG audio frame sync.
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3'
    || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return 'audio/mpeg';

  // WAV: RIFF....WAVE.
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';

  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';

  // M4A/MP4 đặt box ftyp ở byte 4.
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'audio/mp4';

  // WebM/Matroska EBML header.
  if (startsWithBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'audio/webm';

  return null;
}

export function validateAssignmentAudio({ buffer, fileName }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, message: 'File nghe đang rỗng hoặc chưa được gửi lên.' };
  }
  if (buffer.length > ASSIGNMENT_AUDIO_MAX_BYTES) {
    return { ok: false, message: 'File nghe vượt quá 8 MB. Hãy nén audio hoặc chọn file ngắn hơn.' };
  }

  const safeName = decodeAudioFileName(fileName);
  const extension = audioFileExtension(safeName);
  if (!AUDIO_EXTENSIONS.has(extension)) {
    return { ok: false, message: 'Chỉ nhận file nghe MP3, M4A, WAV, OGG, WebM hoặc AAC.' };
  }

  const mimeType = detectAudioMime(buffer);
  if (!mimeType) {
    return { ok: false, message: 'Nội dung file không phải định dạng âm thanh hợp lệ hoặc file đã bị lỗi.' };
  }

  return { ok: true, fileName: safeName, mimeType, sizeBytes: buffer.length };
}
