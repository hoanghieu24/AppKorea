import { config } from './config.js';
import { recordAiUsage, sanitizeLogText } from './monitoring.js';
import { getAiRuntimeSettings, updateGeminiKeyHealth } from './settings.js';
import { snapAiScoreRatio } from './grading.js';

class AiError extends Error {
  constructor(code, publicMessage, statusCode = 502, details = '') {
    super(code);
    this.name = 'AiError';
    this.code = code;
    this.publicMessage = publicMessage;
    this.statusCode = statusCode;
    this.details = details;
  }
}

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
  throw new AiError('AI_RESPONSE_INVALID', 'AI trả về dữ liệu chưa hợp lệ. Vui lòng thử lại.', 502);
}

function textLengthOfHistory(history) {
  if (!Array.isArray(history)) return 0;
  return history.reduce((sum, item) => sum + (item?.parts || []).reduce((partSum, part) => partSum + String(part?.text || '').length, 0), 0);
}

function normalizeHistory(history) {
  if (!Array.isArray(history) || !history.length) return null;
  let output = history.slice(-config.aiHistoryMaxMessages).map((item) => ({
    role: item.role === 'model' ? 'model' : 'user',
    parts: (Array.isArray(item.parts) ? item.parts : [])
      .slice(0, 4)
      .map((part) => ({ text: String(part?.text || '').slice(0, 6000) }))
      .filter((part) => part.text),
  })).filter((item) => item.parts.length);

  // Bỏ dần message cũ nhất nếu lịch sử vượt ngân sách ký tự.
  while (output.length > 1 && textLengthOfHistory(output) > config.aiHistoryMaxChars) output = output.slice(1);
  return output;
}

function classifyFailure(status, detail, error) {
  const text = `${detail || ''} ${error?.message || ''}`.toLowerCase();
  if (error?.name === 'AbortError' || error?.code === 'AI_TIMEOUT') {
    return { code: 'TIMEOUT', retryable: true, cooldownSeconds: 15, publicMessage: 'AI phản hồi quá lâu. Hệ thống đang chuyển sang kết nối dự phòng.' };
  }
  if (status === 429 || text.includes('resource_exhausted') || text.includes('quota') || text.includes('rate limit')) {
    return { code: 'RATE_LIMITED', retryable: true, cooldownSeconds: config.aiKeyCooldownSeconds, publicMessage: 'AI đang quá tải hoặc chạm giới hạn tạm thời.' };
  }
  if (status === 503 || status === 502 || status === 504 || text.includes('overloaded') || text.includes('unavailable')) {
    return { code: 'UNAVAILABLE', retryable: true, cooldownSeconds: 20, publicMessage: 'AI đang tạm thời bận.' };
  }
  if (status === 401 || status === 403 || text.includes('api key not valid') || text.includes('api_key_invalid')) {
    return { code: 'AUTH_ERROR', retryable: true, cooldownSeconds: 3600, publicMessage: 'Một kết nối AI dự phòng đang lỗi xác thực.' };
  }
  if (!status && error) {
    return { code: 'NETWORK_ERROR', retryable: true, cooldownSeconds: 15, publicMessage: 'Không kết nối được tới AI.' };
  }
  return { code: `HTTP_${status || 'ERROR'}`, retryable: false, cooldownSeconds: 0, publicMessage: 'AI tạm thời không xử lý được yêu cầu này.' };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('AI_TIMEOUT');
      timeoutError.name = 'AbortError';
      timeoutError.code = 'AI_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function aiEnabled() {
  return (await getAiRuntimeSettings()).apiKeys.length > 0;
}

export async function generateTextWithAI(
  {
    prompt = '',
    systemPrompt = '',
    history = null,
    temperature = 0.4,
    maxOutputTokens = 1200,
    jsonMode = false,
    userId = null,
    route = 'internal',
    telemetry = null,
  },
  overrides = {},
) {
  const saved = await getAiRuntimeSettings();
  const model = overrides.model || saved.model;
  const normalizedHistory = normalizeHistory(history);
  const cleanPrompt = String(prompt || '').slice(0, config.aiPromptMaxChars);
  const cleanSystemPrompt = String(systemPrompt || '').slice(0, 12000);
  const promptChars = cleanPrompt.length + cleanSystemPrompt.length + textLengthOfHistory(normalizedHistory);

  let keyCandidates;
  if (overrides.apiKey !== undefined) {
    const apiKey = String(overrides.apiKey || '').trim();
    keyCandidates = apiKey ? [{ id: null, label: 'Key đang thử', apiKey, active: true, source: 'override', priority: 0 }] : [];
  } else {
    keyCandidates = saved.apiKeys;
  }
  if (!keyCandidates.length) throw new AiError('AI_NOT_CONFIGURED', 'Gemini chưa được Admin cấu hình.', 503);

  const now = Date.now();
  const available = keyCandidates
    .filter((item) => item.active !== false && item.apiKey)
    .filter((item) => !item.cooldownUntil || new Date(item.cooldownUntil).getTime() <= now)
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));

  if (!available.length) {
    throw new AiError('AI_KEYS_COOLDOWN', 'Các kết nối AI đang nghỉ tạm do quá tải. Vui lòng thử lại sau ít phút.', 503);
  }

  const contents = normalizedHistory?.length
    ? normalizedHistory
    : [{ role: 'user', parts: [{ text: cleanPrompt }] }];
  const body = {
    contents,
    generationConfig: {
      temperature: Math.max(0, Math.min(1.5, Number(temperature) || 0.4)),
      maxOutputTokens: Math.max(128, Math.min(4096, Number(maxOutputTokens) || 1200)),
    },
  };
  if (jsonMode) body.generationConfig.responseMimeType = 'application/json';
  if (cleanSystemPrompt) body.system_instruction = { parts: [{ text: cleanSystemPrompt }] };

  let lastFailure = null;
  for (const keyInfo of available) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(keyInfo.apiKey)}`;
    const started = Date.now();
    if (telemetry && typeof telemetry === 'object') {
      telemetry.providerAttempts = Math.max(0, Number(telemetry.providerAttempts) || 0) + 1;
      telemetry.attemptedKeyIds = Array.isArray(telemetry.attemptedKeyIds) ? telemetry.attemptedKeyIds : [];
      telemetry.attemptedKeyIds.push(keyInfo.id ?? null);
    }
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, config.aiTimeoutMs);

      if (!response.ok) {
        const status = response.status;
        let errDetail = '';
        try {
          const errJson = await response.json();
          errDetail = JSON.stringify(errJson);
        } catch {
          try { errDetail = await response.text(); } catch { /* ignore */ }
        }
        const failure = classifyFailure(status, errDetail);
        lastFailure = failure;
        await updateGeminiKeyHealth(keyInfo.id, {
          status: failure.code,
          cooldownSeconds: failure.cooldownSeconds,
          error: sanitizeLogText(errDetail || failure.code, 240),
        });
        await recordAiUsage({
          userId,
          route,
          keyId: keyInfo.id,
          keyLabel: keyInfo.label,
          status: failure.code,
          httpStatus: status,
          latencyMs: Date.now() - started,
          promptChars,
          errorCode: failure.code,
        });
        if (failure.retryable) continue;
        throw new AiError(`AI_${failure.code}`, failure.publicMessage, status >= 400 && status < 600 ? status : 502);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const visibleText = parts.filter((part) => !part.thought).map((part) => part.text || '').join('').trim();
      const allText = parts.map((part) => part.text || '').join('').trim();
      const text = visibleText || allText;
      if (!text) {
        throw new AiError(`AI_EMPTY_RESPONSE_${candidate?.finishReason || 'UNKNOWN'}`, 'AI chưa tạo được câu trả lời. Vui lòng thử lại.', 502);
      }

      await updateGeminiKeyHealth(keyInfo.id, { success: true });
      await recordAiUsage({
        userId,
        route,
        keyId: keyInfo.id,
        keyLabel: keyInfo.label,
        status: 'SUCCESS',
        httpStatus: response.status,
        latencyMs: Date.now() - started,
        promptChars,
        responseChars: text.length,
      });
      return text;
    } catch (error) {
      if (error instanceof AiError) throw error;
      const failure = classifyFailure(null, '', error);
      lastFailure = failure;
      await updateGeminiKeyHealth(keyInfo.id, {
        status: failure.code,
        cooldownSeconds: failure.cooldownSeconds,
        error: failure.code,
      });
      await recordAiUsage({
        userId,
        route,
        keyId: keyInfo.id,
        keyLabel: keyInfo.label,
        status: failure.code,
        latencyMs: Date.now() - started,
        promptChars,
        errorCode: failure.code,
      });
      if (!failure.retryable) throw new AiError(`AI_${failure.code}`, failure.publicMessage, 502);
    }
  }

  throw new AiError(
    `AI_${lastFailure?.code || 'UNAVAILABLE'}`,
    'AI đang tạm thời quá tải. Hệ thống đã thử các kết nối dự phòng nhưng chưa có kết nối khả dụng.',
    503,
  );
}

export async function testGeminiConnection({ apiKey, model }) {
  const text = await generateTextWithAI(
    { prompt: 'Trả lời đúng một từ: OK', temperature: 0, maxOutputTokens: 128, route: 'admin-test' },
    { apiKey: apiKey || undefined, model },
  );
  return Boolean(text.trim());
}


export async function gradeEssayBatchWithAI({ items, userId = null, route = 'assignment-grade-batch' }) {
  const batch = (Array.isArray(items) ? items : []).slice(0, 5).map((item) => ({
    questionId: Number(item.questionId),
    prompt: String(item.prompt || '').slice(0, 3000),
    referenceAnswer: String(item.referenceAnswer || '').slice(0, 1600),
    answer: String(item.answer || '').slice(0, 3000),
    maxPoints: Math.max(0, Number(item.maxPoints) || 0),
  }));
  if (!batch.length) return { results: [], providerAttempts: 0 };

  const systemPrompt = `Bạn là giáo viên tiếng Hàn. Bạn nhận tối đa 5 câu trong một request và phải chấm từng câu độc lập.

HÃY ĐÁNH GIÁ CÂU TRẢ LỜI CỦA HỌC SINH DỰA TRÊN:
1. Nghĩa có đúng với câu tiếng Việt/yêu cầu đề bài hay không.
2. Ngữ pháp tiếng Hàn có đúng hay không.
3. Câu có tự nhiên và có thể được người Hàn sử dụng hay không.

QUY TẮC BẮT BUỘC:
- KHÔNG được đánh dấu sai chỉ vì câu trả lời khác đáp án tham khảo.
- Chấp nhận:
  + Từ đồng nghĩa (ví dụ: 정말 / 아주 / 너무, 집 / 가족...).
  + Cách diễn đạt tương đương.
  + 우리 / 저희 nếu đều phù hợp ngữ cảnh.
  + Các mức độ kính ngữ khác nhau nếu vẫn đúng ngữ pháp và ngữ cảnh (ví dụ: đuôi câu -아/어요 hoặc -ㅂ/습니다).
  + 사세요 / 살고 계세요 / 살고 계십니다 nếu đều truyền tải đúng nghĩa.
- Đáp án tham khảo chỉ dùng để tham khảo, KHÔNG phải đáp án duy nhất.
- Bỏ trống hoặc lạc đề: 0 điểm.

CHỈ ĐÁNH DẤU SAI KHI:
- Sai nghĩa so với đề bài.
- Sai ngữ pháp (sai trợ từ, chia sai đuôi từ, sai trật tự từ nghiêm trọng).
- Dùng từ không phù hợp làm thay đổi nghĩa.

THANG ĐIỂM & ĐỊNH DẠNG:
- scoreRatio: 1 (đúng hoàn toàn, tự nhiên, chấp nhận các cách diễn đạt tương đương), 0.8 (đúng nghĩa nhưng lỗi chính tả/ngữ pháp rất nhẹ), 0.5 (đúng một phần nhưng lỗi rõ), 0 (sai nghĩa/sai ngữ pháp/bỏ trống).
- isCorrect: true khi scoreRatio === 1, false khi scoreRatio < 1.
- feedback: nhận xét ngắn gọn bằng tiếng Việt (nêu rõ lỗi sai nếu có, hoặc khen ngợi ngắn gọn nếu đúng).
- Phải trả đủ đúng ${batch.length} phần tử, giữ nguyên questionId đầu vào.
- Chỉ trả JSON thuần đúng schema, không markdown, không thêm chữ bên ngoài:
{"results":[{"questionId":1,"scoreRatio":1,"isCorrect":true,"feedback":"..."}]}`;

  // telemetry chỉ đếm request HTTP thật sự tới Gemini. Bình thường 1 batch = 1 providerAttempt.
  // Nếu key đầu bị 429/503 rồi failover sang key dự phòng thì providerAttempts có thể > 1.
  const telemetry = { providerAttempts: 0, attemptedKeyIds: [] };
  const raw = await generateTextWithAI({
    systemPrompt,
    prompt: `Hãy chấm ${batch.length} câu sau trong MỘT request Gemini duy nhất:\n${JSON.stringify(batch)}`,
    temperature: 0,
    maxOutputTokens: Math.min(2600, 500 + batch.length * 380),
    jsonMode: true,
    userId,
    route,
    telemetry,
  });

  const parsed = extractJson(raw);
  const rows = Array.isArray(parsed?.results) ? parsed.results : [];
  const byId = new Map(rows.map((row) => [Number(row?.questionId), row]));

  const results = batch.map((item) => {
    const row = byId.get(item.questionId);
    if (!row) return null;
    const ratioRaw = Number(row.scoreRatio);
    if (!Number.isFinite(ratioRaw)) return null;
    const ratio = snapAiScoreRatio(ratioRaw);
    return {
      questionId: item.questionId,
      awarded: Number((ratio * item.maxPoints).toFixed(2)),
      isCorrect: Boolean(row.isCorrect) && ratio === 1,
      feedback: String(row.feedback || 'Đã chấm bằng AI.').trim(),
      gradedByAi: true,
    };
  });

  return {
    results,
    providerAttempts: Math.max(0, Number(telemetry.providerAttempts) || 0),
  };
}


export function aiErrorResponse(error) {
  if (error instanceof AiError) {
    return { status: error.statusCode || 502, message: error.publicMessage || 'AI tạm thời không phản hồi.', code: error.code };
  }
  return { status: 502, message: 'AI tạm thời không phản hồi.', code: 'AI_UNKNOWN_ERROR' };
}
