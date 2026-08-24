// Document parser for PDF and Word (.docx / .doc) files

/**
 * Extract clean text and structure from a .docx file using standard ZIP parsing
 * @param {File | ArrayBuffer} fileOrBuffer 
 * @returns {Promise<string>}
 */
export async function extractDocxText(fileOrBuffer) {
  let arrayBuffer;
  if (fileOrBuffer instanceof Blob || fileOrBuffer instanceof File) {
    arrayBuffer = await fileOrBuffer.arrayBuffer();
  } else {
    arrayBuffer = fileOrBuffer;
  }

  const bytes = new Uint8Array(arrayBuffer);
  let offset = 0;
  let documentXmlBytes = null;

  while (offset < bytes.length - 30) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x03 && bytes[offset + 3] === 0x04) {
      const view = new DataView(arrayBuffer, offset);
      const compression = view.getUint16(8, true);
      const compressedSize = view.getUint32(18, true);
      const fileNameLen = view.getUint16(26, true);
      const extraLen = view.getUint16(28, true);

      const fileNameBytes = bytes.slice(offset + 30, offset + 30 + fileNameLen);
      const fileName = new TextDecoder('utf-8').decode(fileNameBytes);
      const dataOffset = offset + 30 + fileNameLen + extraLen;

      if (fileName === 'word/document.xml') {
        const compressedData = bytes.slice(dataOffset, dataOffset + compressedSize);
        if (compression === 0) {
          documentXmlBytes = compressedData;
        } else if (compression === 8) {
          try {
            documentXmlBytes = await inflateRawData(compressedData);
          } catch (e) {
            console.warn('Decompression failed:', e);
          }
        }
        break;
      }
      offset = dataOffset + (compressedSize || 0);
    } else {
      offset += 1;
    }
  }

  if (documentXmlBytes) {
    const xml = new TextDecoder('utf-8').decode(documentXmlBytes);
    return parseWordXmlToText(xml);
  }

  return extractRawTextFallback(bytes);
}

async function inflateRawData(compressedBytes) {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(compressedBytes);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(totalLen);
      let pos = 0;
      for (const chunk of chunks) {
        result.set(chunk, pos);
        pos += chunk.length;
      }
      return result;
    } catch {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(compressedBytes);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(totalLen);
      let pos = 0;
      for (const chunk of chunks) {
        result.set(chunk, pos);
        pos += chunk.length;
      }
      return result;
    }
  }
  throw new Error('DecompressionStream not supported in this browser.');
}

function parseWordXmlToText(xml) {
  let text = xml
    .replace(/<w:tab[^>]*\/>/gi, '\t')
    .replace(/<w:br[^>]*\/>/gi, '\n')
    .replace(/<w:cr[^>]*\/>/gi, '\n')
    .replace(/<w:tr[^>]*>/gi, '\n')
    .replace(/<w:tc[^>]*>/gi, ' | ')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export async function extractPdfText(fileOrBuffer, onProgress) {
  let arrayBuffer;
  if (fileOrBuffer instanceof Blob || fileOrBuffer instanceof File) {
    arrayBuffer = await fileOrBuffer.arrayBuffer();
  } else {
    arrayBuffer = fileOrBuffer;
  }

  const pdfjs = await loadPdfJsLib();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  const pagesText = [];

  for (let i = 1; i <= numPages; i += 1) {
    if (onProgress) onProgress({ current: i, total: numPages });
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    const lineMap = new Map();
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 4) * 4;
      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y).push({ x: item.transform[4], text: item.str });
    }

    const sortedYs = Array.from(lineMap.keys()).sort((a, b) => b - a);
    const pageLines = [];
    for (const y of sortedYs) {
      const items = lineMap.get(y).sort((a, b) => a.x - b.x);
      const lineStr = items.map((it) => it.text).join(' ').trim();
      if (lineStr) pageLines.push(lineStr);
    }

    if (pageLines.length) {
      pagesText.push(`--- Trang ${i} ---\n${pageLines.join('\n')}`);
    }
  }

  return pagesText.join('\n\n');
}

async function loadPdfJsLib() {
  if (window.pdfjsLib) return window.pdfjsLib;

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="pdf.min.js"], script[src*="pdf.js"]');
    if (existing && window.pdfjsLib) return resolve(window.pdfjsLib);

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      } else {
        reject(new Error('Không thể khởi tạo PDF.js'));
      }
    };
    script.onerror = () => reject(new Error('Không thể tải thư viện đọc PDF. Vui lòng kiểm tra kết nối mạng.'));
    document.head.appendChild(script);
  });
}

function extractRawTextFallback(bytes) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const raw = decoder.decode(bytes);
  const lines = raw
    .replace(/[^\x20-\x7E\u00C0-\u024F\u1EA0-\u1EF9\uAC00-\uD7AF\u1100-\u11FF\n\r\t]/g, ' ')
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3);
  return lines.join('\n');
}

export function chunkDocumentText(fullText, maxChunkSize = 3500) {
  const lines = fullText.split('\n');
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const line of lines) {
    if (currentLength + line.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
      currentChunk = [line];
      currentLength = line.length;
    } else {
      currentChunk.push(line);
      currentLength += line.length + 1;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'));
  }

  return chunks.length > 0 ? chunks : [fullText];
}

export function buildDocumentAiPrompt(textChunk) {
  return `Bạn là trợ lý giáo viên tiếng Hàn chuyên nghiệp. Hãy đọc đoạn văn bản tài liệu bên dưới (từ file Word / PDF) và tự động nhận diện, cấu trúc thành danh sách câu hỏi bài tập tiếng Hàn chuẩn xác.

NỘI DUNG TÀI LIỆU:
"""
${textChunk}
"""

HƯỚNG DẪN BÓC TÁCH:
1. Nhận diện các câu hỏi (Câu 1, Câu 2, 1., 2., [1~2], ...), câu trắc nghiệm (①, ②, ③, ④ hoặc A, B, C, D) hoặc câu tự luận (dịch câu, viết câu, điền từ, trả lời câu hỏi).
2. Nếu có đoạn văn đọc hiểu hoặc hội thoại dùng chung cho nhiều câu (ví dụ: [1~2] 다음을 읽고 물음에 답하십시오), hãy đưa vào "sharedContext" của các câu đó.
3. Nếu tài liệu có sẵn đáp án (ở cuối câu hoặc ở bảng đáp án cuối bài), hãy điền đúng vào "correctAnswer" và viết giải thích ngắn gọn vào "explanation".
4. Phân loại loại câu:
   - "MULTIPLE_CHOICE" nếu có các phương án lựa chọn A/B/C/D hoặc ①/②/③/④.
   - "ESSAY" nếu là câu dịch, tự luận, điền câu trả lời ngắn.
5. Gán chủ đề phù hợp vào "topic" (VD: "Từ vựng", "Ngữ pháp", "Đọc hiểu", "Kính ngữ", "Dịch câu").
6. Điểm số: mặc định 1 điểm mỗi câu (hoặc theo điểm ghi trong đề).

HÃY TRẢ VỀ DUY NHẤT MỘT ĐỐI TƯỢNG JSON với định dạng sau (không viết lời mở đầu hay kết thúc):
{
  "title": "Tiêu đề bài kiểm tra / bài tập nếu nhận diện được trong tài liệu",
  "instructions": "Hướng dẫn làm bài nếu có",
  "questions": [
    {
      "prompt": "Nội dung câu hỏi (bằng tiếng Việt hoặc tiếng Hàn)",
      "sharedContext": "Đoạn văn đọc hiểu hoặc hội thoại dùng chung (nếu có, không có thì bỏ trống)",
      "type": "MULTIPLE_CHOICE",
      "options": ["Lựa chọn 1", "Lựa chọn 2", "Lựa chọn 3", "Lựa chọn 4"],
      "correctAnswer": "Lựa chọn đúng (hoặc chữ A/B/C/D tương ứng)",
      "explanation": "Giải thích vì sao đúng (nếu có)",
      "topic": "Từ vựng",
      "points": 1
    }
  ]
}`;
}
