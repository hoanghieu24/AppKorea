import { describe, expect, it } from 'vitest';
import { formatScoreValue, studentScoreText } from '../src/pages/AssignmentDetailPage.jsx';

describe('teacher assignment score display', () => {
  it('hiển thị rõ điểm học sinh trên tổng điểm cùng phần trăm', () => {
    expect(studentScoreText({ score: 9.8, maxScore: 10, percentage: 98 })).toBe('9.8/10 điểm · 98%');
    expect(studentScoreText({ score: '8.50', maxScore: '10.00', percentage: '85.4' })).toBe('8.5/10 điểm · 85%');
  });

  it('không để số thập phân dài làm vỡ giao diện', () => {
    expect(formatScoreValue(0.799999999)).toBe('0.8');
  });
});
