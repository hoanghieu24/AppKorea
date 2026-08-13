# HanQuoc Classroom 2.2.8

> 2.2.8: sửa tương thích MySQL cho toàn bộ phân trang server-side; không dùng prepared parameters cho `LIMIT/OFFSET` sau khi các giá trị đã được validate, tránh lỗi `ER_WRONG_ARGUMENTS / mysqld_stmt_execute` trên một số máy MySQL.
>
> 2.2.7: khóa lỗi giao từ vựng nhầm lớp: giáo viên có nhiều lớp phải chọn lớp đích, nút và thông báo hiển thị rõ tên lớp; backend xác nhận số từ thực sự được thêm, không báo thành công ảo và gửi thông báo cho học sinh khi có từ mới.
>
> 2.2.6: cải thiện màn tích hợp từ vựng với Chọn tất cả/Bỏ chọn, hàng từ dễ đọc và không tự kéo màn hình; thêm phân trang lazy/server-side cho các danh sách Classroom và phân trang render-on-demand cho list dài trong Phòng tự học.
>
> 2.2.5: tích hợp catalog Sơ cấp 1 theo 15 bài, dropdown bài học tự có dữ liệu và chọn bài nào tải ngay từ vựng bài đó; API tự đồng bộ catalog vào MySQL khi sử dụng.
>
> 2.2.4: chấm Luyện ngữ pháp/Kiểm tra tổng hợp theo nghĩa thay vì so chuỗi tuyệt đối; chấp nhận cách diễn đạt tương đương, có mức đúng / gần đúng / sai và AI nhận xét các câu không khớp mẫu.

Bản chuyển đổi từ project HTML/CSS/JS cũ sang:

- Frontend: React 19 + Vite, responsive desktop/mobile.
- Backend: Node.js + Express REST API.
- Database: MySQL 8.
- Auth: JWT + bcrypt, 3 role `ADMIN`, `TEACHER`, `STUDENT`.
- App điện thoại: PWA (`manifest` + service worker), có thể cài từ trình duyệt hỗ trợ.
- AI: Gemini chạy ở backend; chỉ Admin được xem/truy cập trang cấu hình và API key không bao giờ gửi xuống tài khoản giáo viên/học sinh.

## Chức năng đã làm

### Admin

- Đăng nhập theo role.
- Tạo tài khoản admin/giáo viên/học sinh.
- Tạo lớp.
- Giao giáo viên vào lớp.
- Thêm học sinh vào lớp.

### Giáo viên

- Chỉ nhìn thấy lớp được admin giao.
- Tạo BTVN hoặc bài kiểm tra.
- Câu hỏi: trắc nghiệm, trả lời ngắn, tự luận AI chấm.
- BTVN có 2 bước: học sinh `Check bằng AI` nhiều lần để sửa bài, sau đó mới `Nộp cho giáo viên`. Giáo viên xem được số lần check, điểm và nhận xét AI của từng lần.
- Admin có các màn `Quản lý lớp`, `Quản lý học sinh`, `Quản lý giáo viên`, `Quản lý người dùng`; đầy đủ Create/Read/Update/Delete, khóa/khôi phục và giao/gỡ thành viên lớp.
- Giáo viên có thể lọc bài theo từng lớp; nút `Mở` của lớp truyền `classId`, API chỉ trả bài đúng lớp và dashboard luôn ghi rõ bài thuộc lớp nào.
- Lưu nháp hoặc publish ngay.
- Khi publish, tất cả học sinh trong lớp nhận notification.
- Theo dõi ai đã nộp/chưa nộp, điểm và các chủ đề học sinh cần ôn thêm.
- Tích hợp từ vựng theo catalog Sơ cấp 1: chọn Bài 1–15, tick từ, đưa vào lớp.

### Học sinh

- Nhận BTVN/kiểm tra của lớp.
- Làm bài và nhận điểm/feedback sau khi nộp.
- Xem phần cần ôn dựa trên lịch sử làm sai.
- Học từ vựng giáo viên đã giao.
- Flashcard, nghe phát âm bằng Web Speech API, đánh dấu "Đã nhớ"/"Cần ôn lại".
- Notification có chấm báo mới.

### Phòng tự học đầy đủ từ project gốc

- Giữ nguyên engine học cũ trong giao diện Classroom: học từ mới, học hàng loạt, flashcard, quiz, điền từ, nghe, hội thoại nghe, viết, nói, AI Chat, AI Tutor, SRS/ôn tập, ngữ pháp, luyện ngữ pháp, TOPIK/kiểm tra, từ điển, dịch, học PDF, BTVN cá nhân, luyện câu theo sách, game ghép nhanh, số tiếng Hàn, sổ tay, game ngữ pháp và bất quy tắc.
- Dữ liệu luyện câu trong Phòng tự học vẫn giữ bộ 20 bài từ project gốc.
- Từ vựng giáo viên chọn ở mục `Tích hợp từ vựng từ sách` tự đồng bộ vào Phòng tự học của lớp.
- Tiến độ của engine cũ vẫn lưu local để dùng nhanh, đồng thời đồng bộ vào MySQL theo từng tài khoản giáo viên/học sinh.
- Các chế độ AI trong engine cũ đi qua API Node.js. Gemini/model/giọng đọc/personality/theme được Admin quản lý tập trung tại `Cấu hình hệ thống`; Phòng tự học không còn cho Teacher/Student tự đổi các mục này.
- Thao tác tạo/giao/nộp/lưu cấu hình có toast báo thành công/lỗi; badge Thông báo tự làm mới để giáo viên sớm thấy bài vừa nộp.

Kho tích hợp từ vựng cho giáo viên dùng catalog Sơ cấp 1 gồm 15 bài và 210 mục từ cơ bản theo chủ đề; bộ luyện tập cũ vẫn được giữ riêng cho Phòng tự học.

## Chạy nhanh

Yêu cầu: Node.js 20+ và MySQL 8+.

1. Cài package ở thư mục gốc:

```bash
npm install
```

2. Copy `.env.example` thành `server/.env`, rồi sửa thông tin MySQL:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=mat_khau_mysql_cua_ban
DB_NAME=hanquoc_classroom
JWT_SECRET=hay-doi-thanh-mot-chuoi-rat-dai-va-ngau-nhien
```

3. Tạo database/table và seed dữ liệu demo:

```bash
npm run db:init
npm run db:seed
```

Nếu đã chạy `db:init` ở bản 2.0 trước đó, hãy chạy lại `npm run db:init` một lần. Lệnh này dùng `CREATE TABLE IF NOT EXISTS` nên không xóa dữ liệu cũ và sẽ bổ sung bảng cấu hình hệ thống + lịch sử các lần Check AI.

4. Chạy frontend + backend cùng lúc:

```bash
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:4000/api/health`

## Nếu muốn chạy MySQL bằng Docker

Project có sẵn `docker-compose.yml`:

```bash
docker compose up -d
```

Khi dùng file compose mẫu, đặt `DB_PASSWORD=root123` trong `server/.env`, sau đó chạy `npm run db:init` và `npm run db:seed`.

## Tài khoản demo

| Role | Email | Mật khẩu |
| --- | --- | --- |
| Admin | `admin@hanquoc.local` | `Admin@123` |
| Giáo viên | `teacher@hanquoc.local` | `Teacher@123` |
| Học sinh | `student@hanquoc.local` | `Student@123` |
| Học sinh 2 | `student2@hanquoc.local` | `Student@123` |

Seed cũng tạo lớp `Sơ cấp 1 - K01`, giao giáo viên + 2 học sinh, nạp từ vựng Bài 1–2 và một BTVN mẫu đã publish.

> Các mật khẩu trên chỉ dành cho local/demo. Khi deploy thật phải đổi toàn bộ.

## Cấu hình Gemini

Khuyến nghị: đăng nhập bằng Admin → `Cấu hình hệ thống` → nhập Gemini API key, chọn model → `Thử kết nối` → `Lưu & áp dụng`. Key được mã hóa trước khi lưu MySQL.

Trong `server/.env` nên thêm một secret riêng và giữ nguyên giá trị này sau khi đã lưu key:

```env
SETTINGS_ENCRYPTION_KEY=change-this-to-another-long-random-secret
```

`GEMINI_API_KEY` và `GEMINI_MODEL` trong `.env` vẫn được hỗ trợ làm fallback cho bản cũ, nhưng sau khi Admin lưu cấu hình thì giá trị trong MySQL được ưu tiên. Nếu chưa có Gemini, trắc nghiệm/trả lời ngắn vẫn chấm bình thường; tự luận dùng cơ chế chấm dự phòng.

## Lệnh kiểm tra

```bash
npm test
npm run build
```

`npm run build` chạy được cả ở thư mục gốc lẫn `client/` hoặc `server/`. Với Node.js backend, bước build của server là kiểm tra cú pháp vì source chạy trực tiếp bằng Node, không cần transpile.

## Cấu trúc chính

```text
korean-classroom/
├─ client/                 React + PWA
│  ├─ src/pages/           màn hình theo role
│  └─ public/legacy/       toàn bộ engine HTML/CSS/JS từ project gốc
├─ server/
│  ├─ src/                 API, auth, AI, grading
│  ├─ sql/schema.sql       toàn bộ schema MySQL
│  ├─ data/textbook.json          bộ dữ liệu luyện tập cũ
│  ├─ data/textbook-socap1.json   catalog từ vựng Sơ cấp 1 · 15 bài / 210 từ
│  └─ scripts/             init DB + seed demo
├─ .env.example
└─ docker-compose.yml
```

## Gợi ý bước tiếp theo

MVP hiện ưu tiên đúng luồng lớp học và dễ dùng. Khi làm bản production nên thêm refresh token, quên mật khẩu, import học sinh Excel, upload file/ảnh câu hỏi, lịch học, WebSocket notification realtime và đóng gói Capacitor nếu cần phát hành APK/IPA native thay vì PWA.
