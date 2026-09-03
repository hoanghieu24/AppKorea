import { describe, expect, it } from 'vitest';
import { extractJson, globalAiQueue, AiError } from '../src/ai.js';

describe('ai module', () => {
  describe('extractJson', () => {
    it('trích xuất JSON thông thường', () => {
      const data = extractJson('{"results": [{"scoreRatio": 1, "isCorrect": true}]}');
      expect(data.results[0].scoreRatio).toBe(1);
    });

    it('trích xuất JSON nằm trong markdown code block', () => {
      const text = 'Sau đây là kết quả đánh giá:\n```json\n{"results":[{"questionId":1,"scoreRatio":1}]}\n```\nHy vọng hữu ích!';
      const data = extractJson(text);
      expect(data.results[0].questionId).toBe(1);
    });

    it('trích xuất JSON dạng mảng [ ... ]', () => {
      const text = '[\n  {"questionId": 10, "scoreRatio": 0.8},\n  {"questionId": 11, "scoreRatio": 1}\n]';
      const data = extractJson(text);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);
      expect(data[0].questionId).toBe(10);
    });

    it('tự động xử lý trailing comma trong JSON', () => {
      const text = '{"results": [{"scoreRatio": 1,},],}';
      const data = extractJson(text);
      expect(data.results[0].scoreRatio).toBe(1);
    });

    it('tự phục hồi JSON bị ngắt ngọn (unclosed brackets)', () => {
      const truncated = '{"results":[{"questionId":1,"scoreRatio":1,"feedback":"Tốt"';
      const data = extractJson(truncated);
      expect(data.results[0].questionId).toBe(1);
      expect(data.results[0].feedback).toBe('Tốt');
    });

    it('ném lỗi AiError khi text không thể chuyển thành JSON', () => {
      expect(() => extractJson('Xin chào tôi là giáo viên')).toThrow(AiError);
    });
  });

  describe('globalAiQueue', () => {
    it('quản lý hàng đợi và số task đang chạy', async () => {
      const status = globalAiQueue.status();
      expect(status.maxConcurrent).toBe(4);
      expect(typeof status.running).toBe('number');
      expect(typeof status.queued).toBe('number');

      let executed = false;
      const res = await globalAiQueue.run(async () => {
        executed = true;
        return 'success';
      });
      expect(executed).toBe(true);
      expect(res).toBe('success');
    });
  });
});
