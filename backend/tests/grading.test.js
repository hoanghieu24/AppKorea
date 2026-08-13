import { describe, expect, it } from 'vitest';
import { acceptedAnswers, gradeEssayFallback, gradeObjective, normalizeAnswer } from '../src/grading.js';

describe('grading', () => {
  it('chuẩn hóa câu trả lời nhưng giữ nguyên chữ Hàn', () => {
    expect(normalizeAnswer('  저는   학생이에요. ')).toBe('저는 학생이에요');
  });

  it('chấp nhận nhiều đáp án ngăn bằng ||', () => {
    expect(acceptedAnswers('네||예')).toEqual(['네', '예']);
    expect(gradeObjective({ correct_answer: '네||예', points: 2, explanation: '' }, '예').awarded).toBe(2);
  });

  it('không cộng điểm câu khách quan sai', () => {
    expect(gradeObjective({ correct_answer: '학교', points: 1, explanation: 'Xem lại từ vựng.' }, '병원')).toMatchObject({ awarded: 0, isCorrect: false });
  });

  it('có phương án chấm dự phòng tự luận khi chưa cấu hình AI', () => {
    const result = gradeEssayFallback({ correct_answer: '저는 한국어를 공부해요', points: 4 }, '저는 한국어를 공부해요');
    expect(result.awarded).toBe(4);
    expect(result.gradedByAi).toBe(false);
  });
});
