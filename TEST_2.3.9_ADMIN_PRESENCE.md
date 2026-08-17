# Test 2.3.9 — Admin Online Presence

1. Deploy Render + Vercel cùng bản 2.3.9.
2. Mở Admin > Quản lý người dùng.
3. Mở cửa sổ/thiết bị khác và login bằng một học sinh.
4. Trong tối đa 30 giây, Admin phải thấy học sinh lên `Online`, số lần đăng nhập tăng 1 và có thời gian đăng nhập gần nhất.
5. Để tab học sinh mở: trạng thái phải tiếp tục Online nhờ heartbeat 60 giây.
6. Đóng tab/mất mạng: sau khoảng 2 phút trạng thái chuyển Offline.
7. Bấm Logout: trạng thái thường chuyển Offline ngay ở lần refresh Admin kế tiếp.
8. Login lại: `Số lần đăng nhập` tăng thêm 1.
9. Khóa tài khoản: tài khoản vẫn giữ lịch sử login nhưng không đăng nhập tiếp được.
