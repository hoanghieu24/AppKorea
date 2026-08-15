# Production Checklist — hoctienghan.io.vn

## A. Code đã harden trong bản 2.3.0

- [x] Sửa query thông báo ALL từ `status='ACTIVE'` sang `active=1`.
- [x] Sửa `submissions.submitted_at` bị khai báo trùng trong schema.
- [x] Sửa teacher AI context dùng nhầm `s.created_at` thay vì `s.submitted_at`.
- [x] Đồng bộ giới hạn thông báo với schema DB 500 ký tự.
- [x] Bỏ fallback secret nguy hiểm trên production; thiếu ENV thì fail startup.
- [x] Tách `JWT_SECRET` và `SETTINGS_ENCRYPTION_KEY`.
- [x] Access JWT ngắn hạn + refresh token HttpOnly + rotation + revoke.
- [x] User bị khóa/đổi role được kiểm tra lại từ DB trên request auth.
- [x] Frontend không persist JWT mới trong localStorage.
- [x] Rate limit API chung/login/AI/TTS; login theo IP + email để không khóa cả lớp khi chung Wi-Fi.
- [x] Chặn Teacher gửi thông báo sang lớp không được giao; `ALL` chỉ tới học sinh thuộc lớp của Teacher.
- [x] Chặn IDOR ở Teacher AI: không đọc dữ liệu bài/lớp của giáo viên khác bằng cách sửa `assignmentId`.
- [x] Giới hạn AI request đồng thời/user, không áp quota học theo ngày.
- [x] AI timeout, retry/failover/cooldown nhiều key.
- [x] TTS yêu cầu đăng nhập + rate limit + timeout.
- [x] Giới hạn prompt/history AI để tránh request phình vô hạn.
- [x] Gemini key mã hóa AES-256-GCM trong MySQL.
- [x] Admin quản lý pool Gemini key, bật/tắt/test/xóa key.
- [x] Log AI usage, 429/503/latency và lỗi backend cho Admin.
- [x] DB pool có connect/query timeout, bounded queue.
- [x] Hỗ trợ MySQL TLS qua ENV.
- [x] `/api/health` kiểm tra DB và latency.
- [x] Graceful shutdown khi Render SIGTERM/redeploy.
- [x] Security headers/CSP trên Vercel.
- [x] Legacy AI/user chat escape HTML + trung hòa markup AI trước các màn hình dùng `innerHTML`.
- [x] CORS allowlist nhiều production origin.
- [x] Root npm workspace sửa thành `backend/frontend`.
- [x] Stale axios client được thay bằng compatibility wrapper.
- [x] Tắt auto-close published assignments; mặc định không tự xóa bài/draft.
- [x] Có DB backup/restore script và production restore guard.
- [x] Demo seed production bị chặn; mật khẩu demo không còn hard-code.
- [x] `.gitignore` cập nhật secrets/backups/node_modules/dist.

## B. Việc phải làm trên Render/Vercel/AnViên — code không thể tự bấm thay

- [ ] Render: đặt `NODE_ENV=production`.
- [ ] Render: khai báo đầy đủ ENV theo `.env.example`.
- [ ] Render: `CLIENT_URL=https://hoctienghan.io.vn,https://www.hoctienghan.io.vn`.
- [ ] Render: health check path `/api/health`.
- [ ] Render: dùng instance always-on khi mở lớp thật; không để backend sleep giữa buổi học.
- [ ] Vercel: `VITE_API_URL` trỏ đúng backend production.
- [ ] Vercel/Domain: cân nhắc `api.hoctienghan.io.vn` trỏ backend để cookie session ổn định hơn trên browser hạn chế third-party cookie.
- [ ] AnViên: hỏi/bật MySQL TLS nếu gói hỗ trợ, rồi set `DB_SSL=true`.
- [ ] AnViên: giới hạn Remote MySQL source IP nếu hạ tầng cho phép; tránh `%` khi có lựa chọn an toàn hơn.
- [ ] AnViên: bật automatic database backup mỗi ngày, giữ tối thiểu 7–30 phiên bản.
- [ ] Lưu thêm một bản backup ngoài cùng server/hosting DB.
- [ ] Thử restore backup vào DB staging trước go-live.
- [ ] Trước deploy 2.3.0: backup DB production.
- [ ] Chạy `npm run db:init` một lần để tạo bảng production-hardening mới.
- [ ] Kiểm tra DB production không còn account demo cũ/mật khẩu mặc định.
- [ ] Nếu secret/API key từng xuất hiện public trong Git history: rotate tại provider.

## C. Smoke test bắt buộc

- [ ] Admin login → refresh trang → logout → login lại.
- [ ] Khóa một Student đang đăng nhập → request tiếp theo phải 401.
- [ ] Đổi password/role user → refresh session cũ bị revoke.
- [ ] Admin tạo Teacher/Student/Class và phân lớp.
- [ ] Admin gửi thông báo ALL không lỗi SQL.
- [ ] Teacher chỉ thấy lớp được giao.
- [ ] Teacher tạo bài từng câu / nhiều dòng / Excel / AI ảnh.
- [ ] Student làm bài → AI check → nộp → reload không mất trạng thái.
- [ ] Student không gọi được Admin API; Teacher không sửa lớp không thuộc quyền.
- [ ] Test submit double-click/mất mạng giữa submit.
- [ ] Test AI với 1 key lỗi + 1 key tốt: hệ thống failover.
- [ ] Test Gemini 429/503/timeout: UI nhận lỗi thân thiện, backend không treo.
- [ ] Test TTS khi login và khi logout.
- [ ] Reload trực tiếp các route `/student`, `/teacher`, `/self-study` không 404 trên Vercel.
- [ ] Test Chrome + Edge + mobile.
- [ ] Pilot 10–30 học sinh trước khi mở rộng; xem Admin Monitoring, Render logs và DB connections.
