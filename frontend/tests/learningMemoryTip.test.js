import { describe, expect, it } from 'vitest';
import { classroomStudyWord } from '../src/pages/LearningHubPage.jsx';

describe('learning hub memory tips', () => {
  it('bổ sung mẹo và ví dụ đúng ngữ cảnh cho từ chỉ vị trí', () => {
    const word = classroomStudyWord({ korean: '위', meaningVi: 'trên' });
    expect(word.roman).toBe('wi');
    expect(word.tip).toContain('책상 위에');
    expect(word.example).toBe('책이 책상 위에 있어요.');
    expect(word.exampleViet).toBe('Quyển sách ở trên bàn.');
  });

  it('mọi từ đồng bộ đều có mẹo dự phòng mà không cần gọi AI', () => {
    const word = classroomStudyWord({ korean: '컴퓨터', romanization: 'keompyuteo', meaningVi: 'máy tính' });
    expect(word.tip).toContain('keompyuteo');
    expect(word.tip).toContain('máy tính');
  });

  it('ưu tiên mẹo do học liệu cung cấp nếu đã có', () => {
    const word = classroomStudyWord({ korean: '물', meaningVi: 'nước', memoryTip: 'Mẹo riêng của giáo viên.' });
    expect(word.tip).toBe('Mẹo riêng của giáo viên.');
  });
});
