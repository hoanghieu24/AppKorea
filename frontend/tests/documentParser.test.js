import { describe, expect, it } from 'vitest';
import { parseDocumentRuleBased } from '../src/utils/documentParser.js';

describe('documentParser rule-based', () => {
  it('tách chính xác câu hỏi và các lựa chọn A B C D không cần AI', () => {
    const docText = `
Đề kiểm tra tiếng Hàn sơ cấp 1
Câu 1: Chọn từ đúng điền vào chỗ trống: 저는 ___ 입니다.
A. 사과
B. 학생
C. 책상
D. 의자
Đáp án: B

Câu 2: Dịch câu sau sang tiếng Hàn: Tôi đi đến trường.
A. 학교에 가요
B. 집에 와요
C. 밥을 먹어요
D. 잠을 자요
Đáp án: A
    `.trim();

    const res = parseDocumentRuleBased(docText);
    expect(res.questions.length).toBe(2);
    expect(res.questions[0].prompt).toContain('Chọn từ đúng');
    expect(res.questions[0].options.length).toBe(4);
    expect(res.questions[0].options[1]).toBe('학생');
    expect(res.questions[0].correctAnswer).toBe('B');
    expect(res.questions[0].type).toBe('MULTIPLE_CHOICE');

    expect(res.questions[1].prompt).toContain('Dịch câu sau');
    expect(res.questions[1].correctAnswer).toBe('A');
  });

  it('xử lý câu tự luận khi không có các phương án lựa chọn', () => {
    const docText = `
Bài tập viết câu
1. Hãy giới thiệu tên và quốc tịch của bạn bằng tiếng Hàn.
Đáp án: 저는 남입니다. 베트남 사람입니다.

2. Viết lại câu sau dạng kính ngữ: 밥을 먹다.
Đáp án: 진지를 드시다
    `.trim();

    const res = parseDocumentRuleBased(docText);
    expect(res.questions.length).toBe(2);
    expect(res.questions[0].type).toBe('ESSAY');
    expect(res.questions[0].correctAnswer).toContain('저는 남입니다');
    expect(res.questions[1].type).toBe('ESSAY');
  });
});
