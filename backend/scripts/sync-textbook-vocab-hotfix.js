import { seedTextbookCatalog, textbookStats } from '../src/textbook.js';

console.log(`[FULL VOCAB HOTFIX] Đồng bộ ${textbookStats.lessonCount} bài / ${textbookStats.vocabularyCount} mục từ...`);
await seedTextbookCatalog();
console.log('[FULL VOCAB HOTFIX] Đồng bộ MySQL hoàn tất. Không xóa dữ liệu vocabulary cũ để tránh làm mất liên kết class_vocabulary.');
process.exit(0);
