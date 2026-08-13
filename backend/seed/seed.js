// Nạp dữ liệu mặc định (từ vựng + ngữ pháp gốc của app) và 2 tài khoản demo để test nhanh.
// Chạy: npm run seed
require('dotenv').config();
const bcrypt = require('bcryptjs');
const {
  sequelize, User, UserStats, Lesson, Word, Grammar, Class, ClassMember,
} = require('../models');

const LESSON_NAMES = ['Bài 1', 'Bài 2', 'Bài 3', 'Bài 4', 'Bài 5'];

const DEFAULT_GRAMMAR = [
  { title: '-입니다 / -입니까?', body: 'Đuôi câu khẳng định / nghi vấn lịch sự trang trọng (Là... / Là... phải không?)', lesson: 'Bài 1' },
  { title: '-은 / -는', body: 'Tiểu từ chủ đề, đứng sau danh từ để nhấn mạnh chủ đề của câu', lesson: 'Bài 1' },
  { title: '-이 / -가', body: 'Tiểu từ chủ ngữ, đứng sau danh từ làm chủ ngữ trong câu', lesson: 'Bài 1' },
  { title: '-을 / -를', body: 'Tiểu từ tân ngữ, đứng sau danh từ chịu sự tác động của động từ', lesson: 'Bài 2' },
  { title: '-아/어/여요', body: 'Đuôi câu thân mật lịch sự dùng phổ biến trong giao tiếp hằng ngày', lesson: 'Bài 2' },
  { title: '-에 / -에서', body: 'Tiểu từ chỉ thời gian, địa điểm (ở, tại, đến)', lesson: 'Bài 2' },
  { title: '-고 싶다', body: 'Cấu trúc biểu thị mong muốn "Muốn làm gì đó"', lesson: 'Bài 3' },
  { title: '-(으)ㄹ 거예요', body: 'Thì tương lai "Sẽ làm gì đó / Sẽ diễn ra"', lesson: 'Bài 3' },
  { title: '-지 않다 / 안 -', body: 'Phủ định "Không làm gì / Không như thế nào"', lesson: 'Bài 3' },
  { title: '-아/어/여야 하다', body: 'Cấu trúc bắt buộc "Phải làm gì đó"', lesson: 'Bài 4' },
  { title: '-(으)ㄹ 수 있다/없다', body: 'Cấu trúc khả năng "Có thể / Không thể làm gì"', lesson: 'Bài 4' },
  { title: '-(으)면서', body: 'Cấu trúc thực hiện song song 2 hành động "Vừa... vừa..."', lesson: 'Bài 5' },
];

// Ported nguyên vẹn từ VOCAB_DB + BODY_EXTRA trong app.js gốc
const VOCAB_DB = {
  '사람': { roman: 'saram', meaning: 'người, con người', pos: '명사', tip: 'Sa-ram: "Sa ra" - người bạn luôn nhớ mãi', example: '이 사람은 친구예요.', exampleViet: 'Người này là bạn của tôi.' },
  '학생': { roman: 'haksaeng', meaning: 'học sinh, sinh viên', pos: '명사', tip: 'Hak-saeng: "học sinh" âm gần giống tiếng Việt! Hak=học', example: '저는 학생이에요.', exampleViet: 'Tôi là học sinh.' },
  '의사': { roman: 'uisa', meaning: 'bác sĩ', pos: '명사', tip: 'Ui-sa: "ý sĩ" = bác sĩ có ý định chữa bệnh', example: '의사는 병원에 있어요.', exampleViet: 'Bác sĩ ở bệnh viện.' },
  '회사원': { roman: 'hoesawon', meaning: 'nhân viên công ty', pos: '명사', tip: 'Hoesa=công ty, won=người → nhân viên', example: '오빠는 회사원이에요.', exampleViet: 'Anh ấy là nhân viên.' },
  '행복': { roman: 'haengbok', meaning: 'hạnh phúc', pos: '명사', tip: 'Haeng-bok gần âm "hạnh phúc" tiếng Việt!', example: '저는 행복해요.', exampleViet: 'Tôi hạnh phúc.' },
  '사랑': { roman: 'sarang', meaning: 'tình yêu', pos: '명사', tip: 'Sarang haeyo! = I love you - từ K-drama nổi tiếng', example: '사랑해요!', exampleViet: 'Tôi yêu bạn!' },
  '친구': { roman: 'chingu', meaning: 'bạn bè', pos: '명사', tip: 'Chin-gu: "chính goo" = người bạn thật sự', example: '친구가 많아요.', exampleViet: 'Tôi có nhiều bạn.' },
  '가족': { roman: 'gajok', meaning: 'gia đình', pos: '명사', tip: 'Ga-jok: "gia tộc" âm Hán Việt gần giống!', example: '가족이 좋아요.', exampleViet: 'Tôi yêu gia đình.' },
  '음식': { roman: 'eumsik', meaning: 'thức ăn', pos: '명사', tip: 'Eum-sik: "ăm sích" = thứ để ăn → thức ăn', example: '음식이 맛있어요.', exampleViet: 'Đồ ăn ngon quá.' },
  '물': { roman: 'mul', meaning: 'nước', pos: '명사', tip: 'Mul: ngắn gọn. MUL = nước (H2O)', example: '물을 마셔요.', exampleViet: 'Tôi uống nước.' },
  '밥': { roman: 'bap', meaning: 'cơm', pos: '명사', tip: 'Bap: 밥 먹었어요? = Ăn cơm chưa? = xin chào!', example: '밥을 먹어요.', exampleViet: 'Tôi ăn cơm.' },
  '집': { roman: 'jip', meaning: 'nhà', pos: '명사', tip: 'Jip: JIP = nhà. 집에 가요 = về nhà', example: '집에 있어요.', exampleViet: 'Tôi ở nhà.' },
  '학교': { roman: 'hakkyo', meaning: 'trường học', pos: '명사', tip: 'Hak=học, kyo=trường → trường học!', example: '학교에 가요.', exampleViet: 'Tôi đi học.' },
  '선생님': { roman: 'seonsaengnim', meaning: 'giáo viên', pos: '명사', tip: 'Nim = kính ngữ. Giống sensei Nhật!', example: '선생님 감사해요.', exampleViet: 'Cảm ơn thầy/cô.' },
  '감사합니다': { roman: 'gamsahamnida', meaning: 'cảm ơn (lịch sự)', pos: '표현', tip: 'Gam-sa ≈ "cảm tạ" Hán Việt!', example: '도와주셔서 감사합니다.', exampleViet: 'Cảm ơn đã giúp đỡ.' },
  '안녕하세요': { roman: 'annyeonghaseyo', meaning: 'xin chào (lịch sự)', pos: '표현', tip: 'An-nyeong = bình an. Chào bình an!', example: '안녕하세요! 처음 뵙겠습니다.', exampleViet: 'Xin chào! Rất vui được gặp.' },
  '네': { roman: 'ne', meaning: 'vâng, dạ', pos: '표현', tip: 'Ne ngắn gọn = yes! Giống "nê" tiếng Việt', example: '네, 맞아요.', exampleViet: 'Vâng, đúng rồi.' },
  '아니요': { roman: 'aniyo', meaning: 'không', pos: '표현', tip: 'A-ni-yo = không. Đơn giản!', example: '아니요, 괜찮아요.', exampleViet: 'Không, không sao ạ.' },
  '맛있다': { roman: 'masitda', meaning: 'ngon', pos: '형용사', tip: 'Ma-SIT-da: ngồi xuống (sit) vì ăn quá ngon!', example: '김치가 맛있어요!', exampleViet: 'Kim chi ngon quá!' },
  '좋다': { roman: 'jota', meaning: 'tốt, thích', pos: '형용사', tip: 'Jo-ta! = Tốt! Dùng để khen', example: '날씨가 좋아요.', exampleViet: 'Thời tiết đẹp.' },
  '예쁘다': { roman: 'yeppeuda', meaning: 'đẹp', pos: '형용사', tip: 'Yep-peu-da: K-pop girls thường được khen vậy!', example: '꽃이 예뻐요.', exampleViet: 'Hoa đẹp quá.' },
  '가다': { roman: 'gada', meaning: 'đi', pos: '동사', tip: 'Ga-da: ga tàu → đi đến ga → đi!', example: '어디 가요?', exampleViet: 'Bạn đi đâu vậy?' },
  '오다': { roman: 'oda', meaning: 'đến, tới', pos: '동사', tip: 'O-da: "ôi đến rồi!" → đến', example: '언제 와요?', exampleViet: 'Khi nào bạn đến?' },
  '먹다': { roman: 'meokda', meaning: 'ăn', pos: '동사', tip: 'Meok-da: đừng để mốc → ăn ngay!', example: '뭐 먹어요?', exampleViet: 'Bạn ăn gì?' },
  '마시다': { roman: 'masida', meaning: 'uống', pos: '동사', tip: 'Ma-si-da: "mình si" uống gì đó → uống', example: '커피 마셔요.', exampleViet: 'Tôi uống cà phê.' },
  '공부하다': { roman: 'gongbuhada', meaning: 'học bài', pos: '동사', tip: 'Gongbu (工夫) = công phu học tập!', example: '매일 공부해요.', exampleViet: 'Tôi học mỗi ngày.' },
  '머리': { roman: 'meori', meaning: 'đầu, tóc', pos: '명사', tip: 'Meo-ri: "mỡ" trên đầu → tóc', example: '머리가 아파요.', exampleViet: 'Tôi đau đầu.' },
  '눈': { roman: 'nun', meaning: 'mắt / tuyết', pos: '명사', tip: 'Nun: mắt trắng như tuyết! Đa nghĩa', example: '눈이 예뻐요.', exampleViet: 'Mắt đẹp.' },
  '손': { roman: 'son', meaning: 'tay', pos: '명사', tip: 'Son: "son" môi → dùng tay tô son', example: '손이 예뻐요.', exampleViet: 'Tay đẹp.' },
  '한국': { roman: 'hanguk', meaning: 'Hàn Quốc', pos: '명사', tip: 'Han=dân tộc Hàn, guk=quốc → Hàn Quốc!', example: '한국이 좋아요.', exampleViet: 'Tôi thích Hàn Quốc.' },
  '베트남': { roman: 'betenam', meaning: 'Việt Nam', pos: '명사', tip: 'Be-te-nam: "Vietnam" đọc kiểu Hàn!', example: '베트남 음식이 맛있어요.', exampleViet: 'Đồ ăn Việt Nam ngon.' },
  '김치': { roman: 'gimchi', meaning: 'kim chi', pos: '명사', tip: 'Kim chi! Nổi tiếng thế giới!', example: '김치가 맛있어요.', exampleViet: 'Kim chi ngon.' },
  '불고기': { roman: 'bulgogi', meaning: 'thịt nướng Hàn', pos: '명사', tip: 'Bul=lửa, gogi=thịt → thịt nướng lửa!', example: '불고기 주세요.', exampleViet: 'Cho tôi bulgogi.' },
  '돈': { roman: 'don', meaning: 'tiền', pos: '명사', tip: 'Don ≈ "đồng" tiền Việt Nam!', example: '돈이 없어요.', exampleViet: 'Tôi hết tiền rồi.' },
  '시간': { roman: 'sigan', meaning: 'thời gian', pos: '명사', tip: 'Si-gan ≈ "thì giờ" Hán Việt', example: '시간이 없어요.', exampleViet: 'Tôi không có thời gian.' },
  '오늘': { roman: 'oneul', meaning: 'hôm nay', pos: '부사', tip: 'O-neul: "ô hôm nay"', example: '오늘 날씨가 좋아요.', exampleViet: 'Hôm nay đẹp trời.' },
  '내일': { roman: 'naeil', meaning: 'ngày mai', pos: '부사', tip: 'Na-eil: "mail" tới ngày mai mới đến', example: '내일 봐요!', exampleViet: 'Hẹn gặp ngày mai!' },
  '지금': { roman: 'jigeum', meaning: 'bây giờ', pos: '부사', tip: 'Ji-geum: "gold" = bây giờ quý như vàng!', example: '지금 어디예요?', exampleViet: 'Bạn đang ở đâu vậy?' },
  '있다': { roman: 'itda', meaning: 'có, tồn tại', pos: '동사', tip: 'It-da: "it đó" = có đó!', example: '시간이 있어요?', exampleViet: 'Bạn có thời gian không?' },
  '없다': { roman: 'eopda', meaning: 'không có', pos: '동사', tip: 'Eop-da: ôm không có = rỗng tay', example: '돈이 없어요.', exampleViet: 'Tôi không có tiền.' },
  '많다': { roman: 'manta', meaning: 'nhiều', pos: '형용사', tip: 'Man-ta: manta cá đuối to = nhiều vây!', example: '친구가 많아요.', exampleViet: 'Tôi có nhiều bạn.' },
  '피곤하다': { roman: 'pigonhada', meaning: 'mệt mỏi', pos: '형용사', tip: 'Pi-gon: "phi công" mệt sau chuyến bay!', example: '너무 피곤해요.', exampleViet: 'Tôi mệt quá.' },
  '슬프다': { roman: 'seulpeuda', meaning: 'buồn', pos: '형용사', tip: 'Seul-peu-da ≈ "sầu" tiếng Việt', example: '왜 슬퍼요?', exampleViet: 'Tại sao bạn buồn?' },
  '행복하다': { roman: 'haengbokhada', meaning: 'hạnh phúc', pos: '형용사', tip: 'Haengbok=hạnh phúc + hada=là/làm', example: '지금 행복해요.', exampleViet: 'Bây giờ tôi hạnh phúc.' },
  '사과': { roman: 'sagwa', meaning: 'táo / xin lỗi', pos: '명사', tip: 'Sa-gwa đa nghĩa: quả táo và xin lỗi!', example: '사과가 맛있어요.', exampleViet: 'Táo ngon.' },
  '고양이': { roman: 'goyangi', meaning: 'mèo', pos: '명사', tip: 'Go-yang-i = mèo cute!', example: '고양이가 귀여워요.', exampleViet: 'Mèo thật dễ thương.' },
  '강아지': { roman: 'gangaji', meaning: 'cún con', pos: '명사', tip: 'Gang-a-ji = puppy Hàn Quốc', example: '강아지가 귀여워요.', exampleViet: 'Cún dễ thương!' },
  '날씨': { roman: 'nalsi', meaning: 'thời tiết', pos: '명사', tip: 'Nal-si: ngày-thời = thời tiết ngày hôm nay', example: '오늘 날씨가 좋아요.', exampleViet: 'Hôm nay thời tiết đẹp.' },
  '사랑하다': { roman: 'saranghada', meaning: 'yêu', pos: '동사', tip: 'Sarang=tình yêu + hada=làm → yêu!', example: '사랑해요!', exampleViet: 'Tôi yêu bạn!' },
  '코': { roman: 'ko', meaning: 'mũi', pos: '명사', tip: 'Ko ngắn gọn = mũi. Nose!', example: '코가 높아요.', exampleViet: 'Mũi cao.' },
  '입': { roman: 'ip', meaning: 'miệng', pos: '명사', tip: 'Ip: "lip" bỏ L = môi → miệng', example: '입이 작아요.', exampleViet: 'Miệng nhỏ.' },
  '발': { roman: 'bal', meaning: 'chân', pos: '명사', tip: 'Bal: ball đá bằng chân!', example: '발이 아파요.', exampleViet: 'Chân đau.' },
  '귀': { roman: 'gwi', meaning: 'tai', pos: '명사', tip: 'Gwi = tai nghe!', example: '귀가 작아요.', exampleViet: 'Tai nhỏ.' },
  '어깨': { roman: 'eokkae', meaning: 'vai', pos: '명사', tip: 'Eo-kkae: vai gánh nặng', example: '어깨가 아파요.', exampleViet: 'Vai đau.' },
  '다리': { roman: 'dari', meaning: 'chân, cầu', pos: '명사', tip: 'Da-ri: đa nghĩa chân và cầu!', example: '다리가 예뻐요.', exampleViet: 'Chân đẹp.' },
  '배': { roman: 'bae', meaning: 'bụng / thuyền / quả lê', pos: '명사', tip: 'Bae đa nghĩa 3 cách: bụng, thuyền, lê!', example: '배가 고파요.', exampleViet: 'Tôi đói bụng.' },
  '고기': { roman: 'gogi', meaning: 'thịt', pos: '명사', tip: 'Go-gi: K-BBQ gogi = thịt!', example: '고기가 맛있어요.', exampleViet: 'Thịt ngon.' },
  '채소': { roman: 'chaeso', meaning: 'rau củ', pos: '명사', tip: 'Chae-so: rau sạch', example: '채소를 먹어요.', exampleViet: 'Tôi ăn rau.' },
  '과일': { roman: 'gwail', meaning: 'trái cây', pos: '명사', tip: 'Gwa-il: "quả ít" calo', example: '과일이 좋아요.', exampleViet: 'Tôi thích trái cây.' },
  '커피': { roman: 'keopi', meaning: 'cà phê', pos: '명사', tip: 'Keo-pi: "coffee" đọc tiếng Hàn!', example: '커피를 마셔요.', exampleViet: 'Tôi uống cà phê.' },
};

async function seed() {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  console.log('🌱 Đang tạo bài học mặc định...');
  const lessonMap = {};
  for (let i = 0; i < LESSON_NAMES.length; i++) {
    const [lesson] = await Lesson.findOrCreate({
      where: { name: LESSON_NAMES[i], ownerId: null },
      defaults: { name: LESSON_NAMES[i], orderIndex: i, ownerId: null },
    });
    lessonMap[LESSON_NAMES[i]] = lesson.id;
  }

  console.log('🌱 Đang nạp ngữ pháp mặc định...');
  for (const g of DEFAULT_GRAMMAR) {
    await Grammar.findOrCreate({
      where: { title: g.title, ownerId: null },
      defaults: { title: g.title, body: g.body, lessonId: lessonMap[g.lesson], ownerId: null },
    });
  }

  console.log(`🌱 Đang nạp ${Object.keys(VOCAB_DB).length} từ vựng mặc định (thuộc Bài 1, giống app gốc)...`);
  for (const [korean, v] of Object.entries(VOCAB_DB)) {
    await Word.findOrCreate({
      where: { korean, ownerId: null },
      defaults: {
        korean,
        roman: v.roman,
        meaning: v.meaning,
        pos: v.pos,
        tip: v.tip,
        example: v.example,
        exampleViet: v.exampleViet,
        lessonId: lessonMap['Bài 1'],
        ownerId: null,
      },
    });
  }

  console.log('🌱 Đang tạo tài khoản demo (chỉ dùng để test local)...');
  const demoPassHash = await bcrypt.hash('123456', 10);
  const [teacher] = await User.findOrCreate({
    where: { email: 'teacher@demo.com' },
    defaults: { name: 'Cô Giáo Demo', email: 'teacher@demo.com', passwordHash: demoPassHash, role: 'teacher' },
  });
  await UserStats.findOrCreate({ where: { userId: teacher.id } });

  const [student] = await User.findOrCreate({
    where: { email: 'student@demo.com' },
    defaults: { name: 'Học Sinh Demo', email: 'student@demo.com', passwordHash: demoPassHash, role: 'student' },
  });
  await UserStats.findOrCreate({ where: { userId: student.id } });

  const [demoClass] = await Class.findOrCreate({
    where: { joinCode: 'DEMO01' },
    defaults: { teacherId: teacher.id, name: 'Lớp Tiếng Hàn Demo', joinCode: 'DEMO01', description: 'Lớp mẫu để test hệ thống' },
  });
  await ClassMember.findOrCreate({ where: { classId: demoClass.id, studentId: student.id } });

  console.log('\n✅ Seed xong!');
  console.log('   👩‍🏫 Giáo viên demo: teacher@demo.com / 123456');
  console.log('   🧑‍🎓 Học sinh demo:  student@demo.com / 123456');
  console.log('   🏫 Mã lớp demo:     DEMO01\n');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed lỗi:', err);
  process.exit(1);
});
