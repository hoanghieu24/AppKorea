import { getAiRuntimeSettings } from './settings.js';

function extractJson(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const candidate of candidates) {
    try { return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1').trim()); }
    catch { /* Thử candidate tiếp theo. */ }
  }
  throw new Error('AI_RESPONSE_INVALID');
}

export async function aiEnabled() {
  return Boolean((await getAiRuntimeSettings()).apiKey);
}

export async function generateTextWithAI({ prompt = '', systemPrompt = '', history = null, temperature = 0.4, maxOutputTokens = 1200, jsonMode = false }, overrides = {}) {
  const saved = await getAiRuntimeSettings();
  const apiKey = overrides.apiKey === undefined ? saved.apiKey : overrides.apiKey;
  const model = overrides.model || saved.model;
  if (!apiKey) throw new Error('AI_NOT_CONFIGURED');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const contents = Array.isArray(history) && history.length
    ? history
    : [{ role: 'user', parts: [{ text: String(prompt) }] }];
  const body = {
    contents,
    generationConfig: {
      temperature: Math.max(0, Math.min(1.5, Number(temperature) || 0.4)),
      maxOutputTokens: Math.max(128, Math.min(4096, Number(maxOutputTokens) || 1200)),
    },
  };
  if (jsonMode) body.generationConfig.responseMimeType = 'application/json';
  if (systemPrompt) body.system_instruction = { parts: [{ text: String(systemPrompt) }] };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`AI_HTTP_${response.status}`);
  const data = await response.json();
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const visibleText = parts.filter((part) => !part.thought).map((part) => part.text || '').join('').trim();
  const allText = parts.map((part) => part.text || '').join('').trim();
  const text = visibleText || allText;
  if (!text) {
    throw new Error(`AI_EMPTY_RESPONSE_${candidate?.finishReason || 'UNKNOWN'}`);
  }
  return text;
}

export async function testGeminiConnection({ apiKey, model }) {
  const text = await generateTextWithAI(
    { prompt: 'Trả lời đúng một từ: OK', temperature: 0, maxOutputTokens: 128 },
    { apiKey: apiKey || undefined, model },
  );
  return Boolean(text.trim());
}

async function callGemini(prompt) {
  return generateTextWithAI({ prompt, temperature: 0.2, maxOutputTokens: 700, jsonMode: true });
}

export async function gradeEssayWithAI({ prompt, referenceAnswer, answer, maxPoints }) {
  const request = `Bạn là giáo viên tiếng Hàn ân cần và linh hoạt đang chấm bài tự luận cho học sinh Việt Nam.

QUY TẮC CHẤM VÀ ĐÁNH GIÁ:
1. CHẤM CỞI MỞ, KHÔNG QUÁ GẮT/SÁT TỪNG CHỮ: Không phạt nặng các lỗi lặt vặt về khoảng trắng, dấu câu hay viết hoa. Nếu bài làm của học sinh diễn đạt đúng ý cốt lõi, người Hàn có thể hiểu được và đúng ngữ cảnh thì hãy tính là ĐÚNG (isCorrect = true) và cho điểm tối đa hoặc gần tối đa (scoreRatio từ 0.8 đến 1.0).
2. GIẢI THÍCH KỸ KHI SAI: Với bất kỳ câu nào sai hoặc bị trừ điểm (isCorrect = false hoặc scoreRatio < 0.8), bạn PHẢI GIẢI THÍCH KỸ TẠI SAO SAI bằng tiếng Việt (chỉ rõ sai ở điểm ngữ pháp nào, dùng sai từ vựng gì, hoặc nhầm lẫn cấu trúc ra sao), đồng thời hướng dẫn lại đáp án đúng chuẩn.
3. VỚI CÂU ĐÚNG: Đưa ra lời khen ngắn gọn khích lệ.

Thông tin bài làm:
- Câu hỏi: ${prompt}
- Đáp án tham khảo: ${referenceAnswer || '(không có đáp án cố định)'}
- Bài làm của học sinh: ${answer || '(bỏ trống)'}
- Điểm tối đa: ${maxPoints}

Trả về duy nhất một chuỗi JSON hợp lệ (không dùng markdown code fence, không thêm văn bản bên ngoài):
{
  "scoreRatio": 1.0,
  "isCorrect": true,
  "feedback": "Nhận xét tiếng Việt chi tiết. Nếu sai phải giải thích kỹ tại sao sai và hướng dẫn lại câu đúng."
}
Lưu ý: scoreRatio là số thực từ 0.0 đến 1.0.`;

  const parsed = extractJson(await callGemini(request));
  const ratio = Math.max(0, Math.min(1, Number(parsed.scoreRatio) || 0));
  return {
    awarded: Number((ratio * maxPoints).toFixed(2)),
    isCorrect: Boolean(parsed.isCorrect ?? ratio >= 0.7),
    feedback: String(parsed.feedback || 'Đã chấm bằng AI.'),
    gradedByAi: true,
  };
}
