# 2.3.9 — Admin Online Presence

## Mục tiêu
Admin có thể mở các trang Quản lý người dùng / học sinh / giáo viên và biết ai đang sử dụng hệ thống.

## Backend
- Thêm bảng `user_presence` tách riêng khỏi dữ liệu tài khoản.
- Ghi `last_login_at`, `last_seen_at`, `last_logout_at`, `login_count`.
- Login thành công tăng `login_count` và đánh dấu online.
- Refresh/session đánh dấu hoạt động.
- Endpoint `POST /api/auth/heartbeat` cập nhật hoạt động mỗi 60 giây.
- Logout đánh dấu offline ngay khi access token còn hợp lệ.
- User được xem là online khi có heartbeat trong khoảng ~130 giây và chưa logout sau heartbeat đó.
- `/api/admin/users` trả thêm trạng thái online, lần đăng nhập gần nhất và số lần đăng nhập; online được ưu tiên lên đầu danh sách.
- `/api/health` kiểm tra cả bảng presence.

## Frontend
- Khi đã đăng nhập, client gửi heartbeat nhẹ mỗi 60 giây và khi quay lại tab.
- Trang Admin tự làm mới trạng thái online mỗi 30 giây mà không nháy loading table.
- Bảng quản lý hiển thị Online/Offline, hoạt động cuối, đăng nhập gần nhất và tổng số lần đăng nhập.
- Thanh công cụ hiển thị số người đang online theo đúng trang Học sinh/Giáo viên/Toàn hệ thống.

## Riêng tư
Không lưu hoặc hiển thị IP/thiết bị trong tính năng presence này.
