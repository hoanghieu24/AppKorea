# AppKorea 2.3.0 — Production Hardening

Bản này tập trung đưa hệ thống từ trạng thái demo/development sang trạng thái phù hợp để pilot với người dùng thật.

## Security & Auth

- Access JWT mặc định giảm còn 1 giờ.
- Thêm refresh token HttpOnly cookie, random token + SHA-256 hash trong DB, rotation và revoke.
- Auth middleware kiểm tra user hiện tại trong MySQL trên mỗi request được bảo vệ.
- Deactivate/delete/password change/role change revoke refresh sessions.
- Frontend bỏ persist JWT mới trong localStorage; có migration một lần cho session cũ.
- CORS allowlist và credential support.
- Production ENV validation + secret separation.
- Vercel security headers + CSP.

## AI

- Pool nhiều Gemini API key trong DB, mã hóa AES-256-GCM.
- API quản trị add/test/enable/disable/delete key.
- Timeout, cooldown, failover cho 429/503/auth/network.
- Anti-abuse 30 request/phút/user và tối đa 2 request AI đồng thời/user theo mặc định.
- Không giới hạn quota học sinh theo ngày.
- Prompt/history bounds.
- AI usage monitoring: request, success, rate-limit, unavailable, latency, top user.

## Backend / DB

- Sửa SQL `users.status` sai cột.
- Sửa duplicate `submitted_at` trong schema.
- Sửa teacher submission timestamp.
- Query/connect timeout + bounded pool queue + optional TLS.
- Health check DB latency.
- Request ID, sanitized error logs, monitoring tables.
- Graceful SIGTERM/SIGINT shutdown.
- Tắt hành vi auto-close bài published cũ.
- Backup/restore scripts và production guards.
- Demo seed dùng password random, production seed guard.

## Frontend / Deploy

- Root npm workspaces sửa đúng `backend/frontend`.
- Vercel SPA rewrite giữ nguyên và thêm security headers.
- Stale axios client thay bằng wrapper dùng API client chính.
- Admin Settings thêm Gemini key pool và production monitoring.
- Legacy self-study vẫn bridge AI qua backend khi chạy trong Classroom nhưng không phụ thuộc JWT localStorage.

## Migration

Trước deploy vào DB hiện tại:

1. Backup database.
2. Cập nhật ENV production.
3. Chạy `npm run db:init` để tạo bảng mới.
4. Deploy backend rồi frontend.
5. Login lại và chạy smoke test trong `PRODUCTION_CHECKLIST.md`.

## Vá quyền truy cập bổ sung

- Teacher broadcast `ALL` chỉ gửi tới học sinh thuộc các lớp mình phụ trách; classId khác quyền trả 403.
- Teacher AI kiểm tra quyền sở hữu lớp trước khi đọc dữ liệu assignment/student, chặn IDOR.
- Login rate-limit tách theo IP + email và thêm trần IP để phù hợp lớp học dùng chung Wi-Fi.
- Pool Gemini bỏ qua record key lỗi giải mã thay vì làm sập toàn bộ AI.
- Transaction DB cũng áp dụng query timeout.
- Legacy self-study escape nội dung chat/user và trung hòa markup AI để giảm XSS qua các vùng `innerHTML`.
