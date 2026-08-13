// Gọi Gemini AI từ backend — API key chỉ nằm trong .env, không lộ ra trình duyệt.
// Toàn bộ tính năng AI (tạo bài tập, chấm điểm, giải thích từ...) đều đi qua đây.

function endpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

async function callGemini(prompt, { systemPrompt = '', temperature = 0.7, maxOutputTokens = 1024 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  if (!key) {
    const err = new Error('Server chưa cấu hình GEMINI_API_KEY trong .env');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens },
  };
  if (systemPrompt) body.system_instruction = { parts: [{ text: systemPrompt }] };

  const res = await fetch(`${endpoint(model)}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `Gemini API lỗi HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Gọi Gemini và ép kết quả về JSON (dùng regex bắt khối {...} đầu tiên, giống app gốc)
async function callGeminiJSON(prompt, opts = {}) {
  const raw = await callGemini(prompt, opts);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI không trả về JSON hợp lệ.');
  return JSON.parse(match[0]);
}

module.exports = { callGemini, callGeminiJSON };
