import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useQuery } from '@tanstack/react-query';
import { progressApi } from '../api/progress';

const NAV_ITEMS = [
  { to: '/', icon: '🏠', label: 'Trang chủ', end: true },
  { to: '/words', icon: '📖', label: 'Từ vựng' },
  { to: '/flashcard', icon: '🃏', label: 'Flashcard' },
  { to: '/quiz', icon: '❓', label: 'Trắc nghiệm' },
  { to: '/classes', icon: '🏫', label: 'Lớp học' },
  { to: '/assignments', icon: '📑', label: 'Bài tập' },
];

export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuthStore();
  const { data: stats } = useQuery({ queryKey: ['progress', 'me'], queryFn: progressApi.me });

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} id="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <div className="logo-icon-wrap"><span className="logo-icon">🇰🇷</span></div>
          <div className="logo-text">
            <h1 className="logo-title">HanQuoc</h1>
            <span className="logo-sub">Learn AI</span>
          </div>
        </div>
      </div>

      <nav className="nav-menu">
        <div className="nav-section">
          <div className="nav-group-label">📚 Học</div>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="sidebar-footer">
        <div className="streak-badge" title="Chuỗi ngày học liên tiếp">
          <span>🔥</span>
          <span className="streak-count">{stats?.streak ?? 0}</span>
          <span className="streak-label">ngày</span>
        </div>
        <div className="footer-right">
          <span className="xp-badge" title="Điểm kinh nghiệm">⭐ {stats?.xp ?? 0} XP</span>
          <button className="icon-btn" onClick={logout} title="Đăng xuất">🚪</button>
        </div>
      </div>
    </aside>
  );
}
