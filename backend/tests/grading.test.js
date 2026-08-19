import { describe, expect, it } from 'vitest';
import { acceptedAnswers, attemptAnswersMatch, gradeEssayFallback, gradeObjective, normalizeAnswer, normalizeAttemptAnswer, questionPromptForAi, reusableAttemptResult, shouldGradeWithAI, snapAiScoreRatio } from '../src/grading.js';

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

  it('đưa câu không có đáp án mẫu sang luồng chấm AI', () => {
    expect(shouldGradeWithAI({ type: 'MULTIPLE_CHOICE', correct_answer: '' })).toBe(true);
    expect(shouldGradeWithAI({ type: 'MULTIPLE_CHOICE', correct_answer: '학교' })).toBe(false);
    expect(shouldGradeWithAI({ type: 'ESSAY', correct_answer: '저는 학생입니다' })).toBe(true);
  });

  it('gửi cả lựa chọn cho AI khi câu trắc nghiệm không có đáp án mẫu', () => {
    expect(questionPromptForAi({ prompt: '학교는 어디입니까?', options: '["집","학교"]' }))
      .toBe('학교는 어디입니까?\nCác lựa chọn:\n1. 집\n2. 학교');
  });

  it('nhận ra đáp án không đổi để không reroll điểm AI', () => {
    const questions = [{ id: 1 }, { id: 2 }];
    expect(normalizeAttemptAnswer('  안녕하세요\r\n')).toBe('안녕하세요');
    expect(attemptAnswersMatch(questions, { 1: '안녕하세요', 2: '학교' }, { 1: ' 안녕하세요 ', 2: '학교' })).toBe(true);
    expect(attemptAnswersMatch(questions, { 1: '안녕하세요', 2: '병원' }, { 1: '안녕하세요', 2: '학교' })).toBe(false);
  });

  it('chỉ tái sử dụng kết quả của câu có đáp án giữ nguyên', () => {
    const previousResults = [{ questionId: 1, awarded: 0.8 }, { questionId: 2, awarded: 1 }];
    expect(reusableAttemptResult({ id: 1 }, '공원', { 1: ' 공원 ' }, previousResults)).toEqual(previousResults[0]);
    expect(reusableAttemptResult({ id: 2 }, '학교', { 2: '병원' }, previousResults)).toBeNull();
  });

  it('đưa điểm AI về các mức cố định để tránh số lẻ tùy hứng', () => {
    expect(snapAiScoreRatio(0.91)).toBe(0.8);
    expect(snapAiScoreRatio(0.96)).toBe(1);
    expect(snapAiScoreRatio(0.61)).toBe(0.5);
  });
});
