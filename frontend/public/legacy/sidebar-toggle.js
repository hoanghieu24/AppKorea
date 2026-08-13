// ============================================================
// Sidebar collapse / expand (icon-rail) toggle
// File riêng, độc lập — KHÔNG chỉnh sửa app.js hiện có.
// Chỉ thêm hiệu ứng thu gọn/mở rộng menu bên trái, ghi nhớ lựa
// chọn của người dùng bằng localStorage.
// ============================================================
(function () {
  var STORAGE_KEY = 'hanquoc_sidebarCollapsed';

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    var btn = document.getElementById('sidebarCollapseBtn');
    if (!btn) return;

    function setState(collapsed) {
      document.body.classList.toggle('sidebar-collapsed', collapsed);
      btn.textContent = collapsed ? '›' : '‹';
      btn.title = collapsed ? 'Mở rộng menu' : 'Thu gọn menu';
      btn.setAttribute('aria-expanded', String(!collapsed));
    }

    var saved = false;
    try {
      saved = localStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
      // localStorage không khả dụng (chế độ ẩn danh, v.v.) - bỏ qua, mặc định mở rộng
    }
    setState(saved);

    btn.addEventListener('click', function () {
      var collapsed = !document.body.classList.contains('sidebar-collapsed');
      setState(collapsed);
      try {
        localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
      } catch (e) {
        // bỏ qua nếu không lưu được
      }
    });

    // Trên màn hình nhỏ (mobile), menu đã có cơ chế mở/đóng riêng
    // (nút ☰ + class "open") — nút thu gọn ở đây tự ẩn qua CSS
    // (@media) nên không cần xử lý gì thêm ở đây.
  });
})();
