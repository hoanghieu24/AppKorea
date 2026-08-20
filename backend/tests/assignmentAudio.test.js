import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_AUDIO_MAX_BYTES,
  decodeAudioFileName,
  detectAudioMime,
  validateAssignmentAudio,
} from '../src/assignmentAudio.js';

describe('assignment audio validation', () => {
  it('nhận MP3 có ID3 header', () => {
    const buffer = Buffer.from('49443304000000000000', 'hex');
    expect(detectAudioMime(buffer)).toBe('audio/mpeg');
    expect(validateAssignmentAudio({ buffer, fileName: 'bai-nghe.mp3' })).toMatchObject({
      ok: true,
      mimeType: 'audio/mpeg',
      fileName: 'bai-nghe.mp3',
    });
  });

  it('nhận M4A/MP4 qua ftyp box', () => {
    const buffer = Buffer.from('00000018667479704d34412000000000', 'hex');
    expect(detectAudioMime(buffer)).toBe('audio/mp4');
  });

  it('không tin file giả chỉ đổi đuôi', () => {
    const result = validateAssignmentAudio({ buffer: Buffer.from('day khong phai audio'), fileName: 'gia.mp3' });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/không phải định dạng âm thanh/i);
  });

  it('làm sạch tên file trong header', () => {
    expect(decodeAudioFileName(encodeURIComponent('../Bài nghe 01.mp3\r\n'))).toBe('.._Bài nghe 01.mp3');
  });

  it('chặn file vượt giới hạn', () => {
    const buffer = Buffer.alloc(ASSIGNMENT_AUDIO_MAX_BYTES + 1);
    buffer.write('ID3');
    expect(validateAssignmentAudio({ buffer, fileName: 'dai.mp3' })).toMatchObject({ ok: false });
  });
});
