# HanQuoc Learn AI — Node.js + React + MySQL

Bản chuyển đổi từ app học tiếng Hàn gốc (HTML/CSS/JS thuần, lưu localStorage) sang kiến trúc 3 lớp:
**Backend: Node.js (Express + Sequelize) · Frontend: React (Vite) · Database: MySQL**

Đây là **Round 1** — đã có hệ thống tài khoản (giáo viên/học sinh), lớp học, giao & chấm bài tập bằng AI,
và các tính năng học cốt lõi (từ vựng, flashcard, trắc nghiệm). Xem mục "Đã làm gì / Chưa làm gì" bên dưới.

## 📁 Cấu trúc thư mục

```
project/
├── backend/          # Node.js + Express API
│   ├── config/        # Kết nối MySQL (Sequelize)
│   ├── models/         # Định nghĩa bảng + quan hệ
│   ├── controllers/    # Logic xử lý từng API
│   ├── routes/          # Định tuyến API
│   ├── middleware/     # Xác thực JWT, phân quyền
│   ├── utils/            # JWT, gọi Gemini AI, tính XP...
│   ├── seed/             # Dữ liệu mặc định + tài khoản demo
│   └── server.js       # Điểm khởi chạy
└── frontend/         # React (Vite)
    └── src/
        ├── api/          # Gọi API backend (axios)
        ├── store/       # Zustand (trạng thái đăng nhập)
        ├── pages/       # Các trang
        ├── components/ # Sidebar, Topbar, Toast...
        ├── layouts/     # Bố cục chung
        └── styles/      # base.css (giữ nguyên giao diện gốc) + app.css (bổ sung)
```

## 🚀 Cài đặt & chạy

### 1. Cài MySQL và tạo database

```sql
CREATE DATABASE hanquoc_learn CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Mở `.env` và điền:
- `DB_USER`, `DB_PASSWORD` — tài khoản MySQL của bạn
- `JWT_SECRET` — một chuỗi bí mật bất kỳ, càng dài càng tốt
- `GEMINI_API_KEY` — lấy miễn phí tại [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (cần cho tính năng AI tạo đề & chấm bài)

```bash
npm run dev        # chạy server, TỰ ĐỘNG tạo toàn bộ bảng trong MySQL
npm run seed        # (chạy 1 lần) nạp từ vựng/ngữ pháp mặc định + tài khoản demo
```

Server chạy tại `http://localhost:5000`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Mở `http://localhost:5173`. Vite đã cấu hình sẵn proxy `/api` → `http://localhost:5000`.

### 4. Đăng nhập thử

Sau khi chạy `npm run seed`, dùng 1 trong 2 tài khoản demo:

| Vai trò | Email | Mật khẩu |
|---|---|---|
| 👩‍🏫 Giáo viên | `teacher@demo.com` | `123456` |
| 🧑‍🎓 Học sinh | `student@demo.com` | `123456` |

Học sinh demo đã ở sẵn trong lớp demo (mã lớp `DEMO01`).

⚠️ **Đây là tài khoản demo cho môi trường phát triển** — hãy xoá hoặc đổi mật khẩu trước khi triển khai thật.

## ✅ Đã hoàn thành (Round 1)

- **Xác thực & phân quyền**: đăng ký/đăng nhập JWT, 2 vai trò giáo viên/học sinh
- **Lớp học**: giáo viên tạo lớp + mã mời, học sinh nhập mã để tham gia
- **Giao bài tập**: giáo viên tự soạn câu hỏi HOẶC để **AI (Gemini) tự sinh đề** theo nguồn (từ vựng/ngữ pháp/TOPIK) + độ khó, giao cho cả lớp hoặc từng học sinh
- **Nộp bài & AI chấm điểm**: học sinh nộp bài → AI chấm từng câu (đúng/gần đúng/sai + giải thích) → giáo viên xem, có thể chấm đè
- **Bảo mật API key**: Gemini API key nằm ở backend (`.env`), không lộ ra trình duyệt như bản gốc
- **Từ vựng / Ngữ pháp / Bài học**: xem, thêm, xoá — có sẵn dữ liệu gốc (60 từ, 12 ngữ pháp, 5 bài học)
- **Flashcard**: lật thẻ, phát âm (Web Speech API), đánh giá độ khó, cộng XP, lưu tiến độ theo từng người dùng
- **Trắc nghiệm**: trắc nghiệm 4 đáp án, tính điểm, cộng XP
- **XP / Streak**: giữ đúng công thức gốc, lưu theo từng tài khoản trong MySQL thay vì localStorage

## 🚧 Chưa làm — dành cho các round tiếp theo

App gốc có ~27 tính năng; các phần sau **chưa được chuyển đổi** (sidebar hiện chỉ hiển thị các mục đã hoàn thiện):

- Điền từ / Luyện viết / Luyện nói / Luyện nghe / Nghe hội thoại AI
- Trò chuyện AI / Gia sư AI / Dịch thuật
- Game nối từ / Game ngữ pháp
- Luyện đề TOPIK / Bất quy tắc / Bảng số Hàn Quốc
- Từ điển tra cứu / Học từ PDF / Ôn tập SRS / Sổ tay cá nhân / Trang thống kê chi tiết

Toàn bộ backend đã có **model + bảng DB sẵn sàng** cho notebook, dictionary, PDF, exam history —
chỉ cần viết thêm controller/route/trang React theo đúng pattern đã có ở Round 1.

## 🗄️ Ghi chú kỹ thuật

- Bảng MySQL được **tự động tạo** khi chạy `npm run dev` lần đầu (Sequelize `sync`). Xem `backend/seed/schema_reference.sql` để tham khảo cấu trúc bảng thực tế.
- Đã kiểm thử toàn bộ luồng: đăng ký/đăng nhập → tạo lớp → tham gia lớp → giao bài → nộp bài → chấm điểm → cộng XP.
- Nếu chưa cấu hình `GEMINI_API_KEY`, tính năng "AI tự sinh đề" và "AI chấm điểm" sẽ báo lỗi rõ ràng thay vì crash; giáo viên vẫn có thể tự soạn câu hỏi thủ công và chấm điểm tay bình thường.
