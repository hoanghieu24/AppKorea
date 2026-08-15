# HanQuoc Classroom / AppKorea

Nền tảng lớp học và tự học tiếng Hàn cho **Admin / Giáo viên / Học sinh**.

- Frontend: React + Vite, deploy Vercel
- Backend: Node.js + Express, deploy Render
- Database: MySQL 8
- AI: Gemini API, hỗ trợ pool nhiều API key + failover
- Production hardening: phiên đăng nhập HttpOnly refresh token, rate limit, timeout AI/TTS, monitoring, backup/restore, security headers

## 1. Cấu trúc project

```text
AppKorea/
├─ backend/                 Express API + MySQL
│  ├─ scripts/              init/seed/backup/restore DB
│  ├─ sql/schema.sql
│  └─ src/
├─ frontend/                React + Vite
│  ├─ public/legacy/        Phòng tự học tích hợp
│  └─ src/
├─ PRODUCTION_CHECKLIST.md
├─ CHANGES_PRODUCTION_2.3.0.md
├─ docker-compose.yml       MySQL local
└─ package.json             npm workspaces backend/frontend
```

## 2. Chạy local

Yêu cầu Node.js 20+ và MySQL 8.

```bash
npm install
cp .env.example backend/.env
cp frontend/.env.example frontend/.env.local
npm run db:init
npm run db:seed
npm run dev
```

`db:seed` chỉ dành cho local/test. Mật khẩu demo được tạo ngẫu nhiên và in ra terminal; source không chứa mật khẩu demo cố định.

Frontend mặc định: `http://localhost:5173`
Backend mặc định: `http://localhost:4000`

## 3. Biến môi trường backend quan trọng

Xem đầy đủ trong `.env.example`.

```env
NODE_ENV=production
CLIENT_URL=https://hoctienghan.io.vn,https://www.hoctienghan.io.vn

DB_HOST=...
DB_PORT=3306
DB_USER=...
DB_PASSWORD=...
DB_NAME=...

JWT_SECRET=<chuoi-ngau-nhien-rieng-dai-it-nhat-32-ky-tu>
SETTINGS_ENCRYPTION_KEY=<chuoi-ngau-nhien-khac-dai-it-nhat-32-ky-tu>
JWT_EXPIRES_IN=1h

REFRESH_TOKEN_DAYS=30
REFRESH_COOKIE_SAME_SITE=none
REFRESH_COOKIE_SECURE=true

GEMINI_MODEL=gemini-2.5-flash
RATE_LIMIT_AI_PER_MINUTE=30
RATE_LIMIT_AI_CONCURRENT_PER_USER=2
AUTO_CLEANUP_DAYS=0
```

Production sẽ **không khởi động** nếu thiếu DB password/JWT secret/encryption key hoặc dùng secret quá ngắn. `JWT_SECRET` và `SETTINGS_ENCRYPTION_KEY` bắt buộc khác nhau.

Nếu backend dùng custom domain cùng site, ví dụ `api.hoctienghan.io.vn`, có thể dùng `REFRESH_COOKIE_SAME_SITE=lax`. Nếu frontend Vercel gọi trực tiếp domain `*.onrender.com`, dùng `SameSite=none; Secure`.

## 4. Vercel

Root Directory: `frontend`

Build command:

```bash
npm run build
```

Environment:

```env
VITE_API_URL=https://<backend-render-hoac-api-custom-domain>
```

`frontend/vercel.json` đã có SPA rewrite và security headers. Nếu thêm CDN/script bên ngoài mới, cập nhật CSP tương ứng thay vì tắt CSP.

## 5. Render backend

Root Directory: `backend`

Start command:

```bash
npm start
```

Health Check Path:

```text
/api/health
```

Trước khi deploy code 2.3.0 vào DB đang chạy, chạy một lần:

```bash
npm run db:init
```

Lệnh này dùng `CREATE TABLE IF NOT EXISTS`, tạo thêm bảng refresh session, Gemini key pool, AI usage và system error log.

## 6. MySQL production

Backend hỗ trợ:

```env
DB_CONNECT_TIMEOUT_MS=10000
DB_QUERY_TIMEOUT_MS=15000
DB_CONNECTION_LIMIT=10
DB_QUEUE_LIMIT=100
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true
DB_SSL_CA_BASE64=<CA-neu-nha-cung-cap-cap>
```

Chỉ bật `DB_SSL=true` khi nhà cung cấp MySQL hỗ trợ TLS. Nếu control panel cho phép giới hạn nguồn truy cập MySQL, chỉ mở nguồn cần thiết thay vì mở toàn Internet.

## 7. Gemini AI

Admin có thể thêm nhiều key trong **Cài đặt → Gemini AI → Pool API & failover**. Key được mã hóa AES-256-GCM trước khi lưu DB.

Backend tự:

- timeout request AI;
- cooldown key khi 429/503/network timeout;
- chuyển sang key khỏe khác;
- đánh dấu key lỗi auth lâu hơn;
- giới hạn tốc độ chống bot nhưng **không đặt quota lượt học theo ngày**;
- giới hạn số request AI chạy đồng thời trên mỗi user;
- ghi usage/error cho Admin theo dõi.

Nhiều API key thuộc cùng một Google Cloud project vẫn dùng quota cấp project; pool key chủ yếu giúp failover credential/lỗi key và vận hành ổn định hơn.

## 8. Phiên đăng nhập

- Access JWT mặc định: 1 giờ, chỉ giữ trong memory frontend.
- Refresh token: cookie `HttpOnly`, `Secure` trên production; DB chỉ lưu hash refresh token.
- Refresh token được rotate khi làm mới phiên.
- Admin khóa user/đổi role/đổi password: các refresh session của user bị revoke.
- Mỗi request có auth đều đọc lại trạng thái user từ DB, nên tài khoản bị khóa không tiếp tục dùng token cũ.

Frontend có migration mềm cho session localStorage cũ: token cũ được dùng một lần để tạo refresh cookie rồi bị xóa khỏi localStorage.

## 9. Rate limit mặc định

```text
API chung       300 request/phút
Login            10 lần/15 phút
Refresh session  60 lần/15 phút
AI               30 request/phút/user
AI đồng thời      2 request/user
TTS             120 request/phút/user
```

Có thể chỉnh bằng ENV. Đây là anti-abuse, không phải quota học tập theo ngày.

## 10. Backup / restore

Máy chạy lệnh cần có `mysqldump` và `mysql` CLI.

Backup:

```bash
npm run db:backup
```

Mặc định tạo file gzip trong `backend/backups/`.

Restore local/staging:

```bash
npm run db:restore -- /duong-dan/backup.sql.gz
```

Restore production bị khóa. Chỉ khi chủ động xác nhận:

```env
ALLOW_PRODUCTION_RESTORE=I_UNDERSTAND
```

Ngoài script này vẫn phải bật backup tự động ở nhà cung cấp DB và thử restore định kỳ.

## 11. Seed demo

Production bị chặn chạy demo seed. Nếu thực sự cần seed test trên production-like environment phải đặt rõ:

```env
ALLOW_PRODUCTION_DEMO_SEED=I_UNDERSTAND
```

Không khuyến nghị cho hệ thống đang có học sinh thật.

## 12. Kiểm tra trước khi mở lớp

```bash
npm run build
npm test
```

Sau đó chạy smoke test 3 role theo `PRODUCTION_CHECKLIST.md`: login/logout, khóa user, tạo lớp, giao bài, AI check, submit, thông báo, TTS, reload URL con, lỗi Gemini và mất DB/network.

## 13. Bảo mật secret

Không commit các file sau:

```text
backend/.env
frontend/.env.local
backup database
API key
JWT secret
SETTINGS_ENCRYPTION_KEY
```

Nếu một secret từng bị commit public, phải **rotate secret tại nhà cung cấp**, không chỉ xóa dòng khỏi GitHub history hiện tại.
