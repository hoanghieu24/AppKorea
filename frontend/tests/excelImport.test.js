import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  applyExcelAuditCorrections,
  excelCellMarkedText,
  excelImportDiagnostics,
  parseExcelRuleBased,
  resolveChoiceAnswer,
  workbookRowsForAI,
} from '../src/pages/AssignmentsPage.jsx';

const semanticRow = (row, values) => ({
  sheet: 'Sheet1',
  row,
  cells: values.map((item, index) => {
    const cell = typeof item === 'string' ? { value: item } : item;
    return {
      col: XLSX.utils.encode_col(index * 3),
      value: cell.value,
      formatted: cell.formatted || cell.value,
      emphasisSegments: cell.emphasisSegments || [],
    };
  }),
});

describe('Excel assignment importer', () => {
  it('keeps actual Excel row coordinates when blank rows exist', () => {
    const sheet = {
      A1: { t: 's', v: 'Tiêu đề', w: 'Tiêu đề', h: 'Tiêu đề' },
      A5: {
        t: 's',
        v: 'A: 책상이 무거워요?',
        w: 'A: 책상이 무거워요?',
        h: 'A: 책상이 <b>무거워요?</b>',
      },
      '!ref': 'A1:A5',
    };
    const workbook = { SheetNames: ['Sheet1'], Sheets: { Sheet1: sheet } };

    const rows = workbookRowsForAI(XLSX, workbook);

    expect(rows.map((item) => item.row)).toEqual([1, 5]);
    expect(rows[1].cells[0].value).toBe('A: 책상이 무거워요?');
    expect(rows[1].cells[0].formatted).toBe('A: 책상이 **무거워요?**');
    expect(rows[1].cells[0].emphasisSegments).toEqual(['무거워요?']);
  });

  it('reads bold and underline from both SheetJS HTML and rich XML', () => {
    expect(excelCellMarkedText({ h: '책상이 <span style="font-weight:700">무거워요</span>.' }, '책상이 무거워요.'))
      .toBe('책상이 **무거워요**.');
    expect(excelCellMarkedText({
      h: '책이 두꺼워요?',
      r: '<r><t xml:space="preserve">책이 </t></r><r><rPr><u/></rPr><t>두꺼워요?</t></r>',
    }, '책이 두꺼워요?')).toBe('책이 **두꺼워요?**');
  });

  it('maps exact numeric or letter answer keys to the real option text', () => {
    const options = ['학교', '도서관', '식당', '은행'];
    expect(resolveChoiceAnswer('2', options)).toBe('도서관');
    expect(resolveChoiceAnswer('D', options)).toBe('은행');
    expect(resolveChoiceAnswer('3. 식당', options)).toBe('식당');
  });

  it('lets AI fill a verified option but never rewrite source question text', () => {
    const source = [{
      number: '2',
      type: 'MULTIPLE_CHOICE',
      prompt: 'A: 책상이 **무거워요?**',
      options: ['쉬워요', '가벼워요', '귀여워요', '무거워요'],
      correctAnswer: '',
    }];
    const [corrected] = applyExcelAuditCorrections(source, [{
      number: '2',
      prompt: 'AI tự viết lại một câu khác',
      correctAnswer: '2',
      confidence: 0.99,
    }]);

    expect(corrected.prompt).toBe(source[0].prompt);
    expect(corrected.correctAnswer).toBe('가벼워요');
  });

  it('builds sections, dialogue, shared passages, listening and essays without creating junk questions', () => {
    const rows = [
      semanticRow(1, ['ĐỀ KIỂM TRA TỔNG HỢP\nThời gian làm bài: 45 phút']),
      semanticRow(2, ['Câu 1-2: Chọn đáp án đúng']),
      semanticRow(4, ['Câu 1: 오늘은 월요일입니다. 내일은 무슨 요일입니까?']),
      semanticRow(6, ['1. 일요일', '2. 화요일', '3. 수요일', '4. 목요일']),
      semanticRow(8, ['Câu 2']),
      semanticRow(9, [{ value: 'A: 책상이 무거워요?', formatted: 'A: 책상이 **무거워요?**', emphasisSegments: ['무거워요?'] }]),
      semanticRow(10, ['B: 아니요, (      ).']),
      semanticRow(11, ['1. 쉬워요', '2. 가벼워요', '3. 귀여워요', '4. 무거워요']),
      semanticRow(13, ['Câu 3-4: Đọc đoạn văn và trả lời câu hỏi']),
      semanticRow(14, ['저는 한국에서 공부하는 학생입니다. 주말마다 친구와 도서관에 가서 한국어 책을 읽고 숙제를 합니다. 그리고 저녁에는 같이 밥을 먹습니다.']),
      semanticRow(15, ['3. 이 글의 내용과 같은 것을 고르세요.']),
      semanticRow(16, ['1. 학생은 주말에 혼자 쉽니다.']),
      semanticRow(17, ['2. 학생은 도서관에서 운동합니다.']),
      semanticRow(18, ['3. 학생은 친구와 숙제를 합니다.']),
      semanticRow(19, ['4. 학생은 한국어를 공부하지 않습니다.']),
      semanticRow(21, ['4. 학생은 저녁에 무엇을 합니까?']),
      semanticRow(22, ['1. 잡니다.', '2. 밥을 먹습니다.', '3. 운동합니다.', '4. 일합니다.']),
      semanticRow(24, ['Câu 5-5: Nghe và chọn đáp án đúng']),
      semanticRow(25, ['Câu 5: 두 사람은 어디에서 만납니까?']),
      semanticRow(26, ['1. 교실', '2. 도서관', '3. 식당']),
      semanticRow(28, ['Câu 6-6: Dịch câu sau sang tiếng Hàn']),
      semanticRow(29, ['6. Tôi muốn mua một chiếc váy dài.']),
      semanticRow(30, ['…................................................................................']),
    ];

    const parsed = parseExcelRuleBased(rows);
    const diagnostics = excelImportDiagnostics(parsed, rows);

    expect(parsed.assignmentTitle).toBe('ĐỀ KIỂM TRA TỔNG HỢP');
    expect(parsed.questions).toHaveLength(6);
    expect(parsed.questions.map((question) => question.number)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(parsed.questions.filter((question) => question.type === 'MULTIPLE_CHOICE')).toHaveLength(5);
    expect(parsed.questions[1].prompt).toContain('**무거워요?**');
    expect(parsed.questions[1].options).toEqual(['쉬워요', '가벼워요', '귀여워요', '무거워요']);
    expect(parsed.questions[2].sharedContext).toContain('주말마다 친구와 도서관에 가서');
    expect(parsed.questions[3].sharedContext).toBe('');
    expect(parsed.questions[4].options).toEqual(['교실', '도서관', '식당']);
    expect(parsed.questions[5].type).toBe('ESSAY');
    expect(parsed.questions[5].prompt).toBe('Tôi muốn mua một chiếc váy dài.');
    expect(diagnostics.needsStructuralAI).toBe(false);
    expect(diagnostics.sharedContextCount).toBe(1);
    expect(diagnostics.preservedFormatCount).toBe(1);
  });
});
