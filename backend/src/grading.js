export function normalizeAnswer(value) {
  return String(value ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[.!?。！？]+$/g, '')
    .replace(/\s+/g, ' ');
}

export function acceptedAnswers(correctAnswer) {
  return String(correctAnswer || '')
    .split('||')
    .map(normalizeAnswer)
    .filter(Boolean);
}

export function gradeObjective(question, answer) {
  const expected = acceptedAnswers(question.correct_answer);
  const actual = normalizeAnswer(answer);
  const isCorrect = Boolean(actual) && expected.includes(actual);
  return {
    awarded: isCorrect ? Number(question.points) : 0,
    isCorrect,
    feedback: isCorrect
      ? 'Chính xác.'
      : `Chưa đúng.${question.explanation ? ` ${question.explanation}` : ''}`,
    gradedByAi: false,
  };
}

export function gradeEssayFallback(question, answer) {
  const actualWords = new Set(normalizeAnswer(answer).split(' ').filter(Boolean));
  const referenceWords = new Set(normalizeAnswer(question.correct_answer).split(' ').filter(Boolean));
  if (!actualWords.size) {
    return { awarded: 0, isCorrect: false, feedback: 'Bạn chưa trả lời câu này.', gradedByAi: false };
  }
  if (!referenceWords.size) {
    return { awarded: 0, isCorrect: false, feedback: 'Cần cấu hình Gemini để chấm câu tự luận này.', gradedByAi: false };
  }
  const hit = [...referenceWords].filter((word) => actualWords.has(word)).length;
  const ratio = hit / referenceWords.size;
  return {
    awarded: Number((Number(question.points) * ratio).toFixed(2)),
    isCorrect: ratio >= 0.7,
    feedback: ratio >= 0.7 ? 'Ý chính khá sát đáp án tham khảo.' : 'Cần xem lại từ vựng hoặc cấu trúc của câu.',
    gradedByAi: false,
  };
}
