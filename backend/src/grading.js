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

export function shouldGradeWithAI(question) {
  return question?.type === 'ESSAY' || !String(question?.correct_answer || '').trim();
}

export function normalizeAttemptAnswer(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .trim();
}

export function attemptAnswersMatch(questions = [], currentAnswers = {}, previousAnswers = {}) {
  return questions.every((question) => normalizeAttemptAnswer(currentAnswers[String(question.id)])
    === normalizeAttemptAnswer(previousAnswers[String(question.id)]));
}

export function reusableAttemptResult(question, answer, previousAnswers = {}, previousResults = []) {
  const questionId = Number(question?.id);
  if (!questionId) return null;
  if (normalizeAttemptAnswer(answer) !== normalizeAttemptAnswer(previousAnswers[String(questionId)])) return null;
  return previousResults.find((item) => Number(item?.questionId) === questionId) || null;
}

export function snapAiScoreRatio(value) {
  const ratio = Math.max(0, Math.min(1, Number(value) || 0));
  if (ratio >= 0.95) return 1;
  if (ratio >= 0.7) return 0.8;
  if (ratio >= 0.25) return 0.5;
  return 0;
}

export function questionPromptForAi(question) {
  let options = question?.options || [];
  if (typeof options === 'string') {
    try { options = JSON.parse(options); } catch { options = []; }
  }
  if (!Array.isArray(options) || !options.length) return String(question?.prompt || '');
  return `${String(question?.prompt || '')}\nCác lựa chọn:\n${options.map((option, index) => `${index + 1}. ${option}`).join('\n')}`;
}

export function gradeObjective(question, answer) {
  const expected = acceptedAnswers(question.correct_answer);
  const actual = normalizeAnswer(answer);
  const isCorrect = Boolean(actual) && expected.includes(actual);
  let feedback = '';
  if (isCorrect) {
    feedback = 'Chính xác! Bạn làm rất tốt.';
  } else {
    const detail = question.explanation
      ? `\n💡 Giải thích chi tiết: ${question.explanation}`
      : '\n💡 Hướng dẫn: Bạn hãy đọc lại câu hỏi, so sánh với đáp án tham khảo để rút kinh nghiệm cho lần làm sau.';
    feedback = `Chưa chính xác. Đáp án đúng là: "${question.correct_answer || ''}".${detail}`;
  }
  return {
    awarded: isCorrect ? Number(question.points) : 0,
    isCorrect,
    feedback,
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
    return { awarded: Number(question.points), isCorrect: true, feedback: 'Đã nhận bài làm tự luận của bạn.', gradedByAi: false };
  }
  const hit = [...referenceWords].filter((word) => actualWords.has(word)).length;
  const ratio = hit / referenceWords.size;
  const isCorrect = ratio >= 0.5;
  let feedback = '';
  if (isCorrect) {
    feedback = 'Diễn đạt tốt, đúng ý cốt lõi của câu hỏi!';
  } else {
    feedback = `Chưa sát đáp án tham khảo. Đáp án chuẩn là: "${question.correct_answer}".\n💡 Giải thích: Hãy kiểm tra lại từ vựng và cấu trúc ngữ pháp để rút kinh nghiệm nhé!`;
  }
  return {
    awarded: Number((Number(question.points) * (isCorrect ? Math.max(ratio, 0.8) : ratio)).toFixed(2)),
    isCorrect,
    feedback,
    gradedByAi: false,
  };
}
