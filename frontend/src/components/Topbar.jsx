import { useAuthStore } from '../store/authStore';

const ROLE_LABEL = { teacher: '👩‍🏫 Giáo viên', student: '🧑‍🎓 Học sinh' };

export default function Topbar({ title, onMenuClick }) {
  const { user } = useAuthStore();

  return (
    <header className="topbar">
      <button className="mobile-menu-btn" onClick={onMenuClick}>☰</button>
      <h2 style={{ fontSize: '1.05rem', fontWeight: 800 }}>{title}</h2>
      <div className="topbar-actions">
        <span className="badge" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', padding: '5px 12px', borderRadius: 20, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {ROLE_LABEL[user?.role] || ''}
        </span>
        <div className="avatar avatar-a" style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff' }}>
          {user?.name?.[0]?.toUpperCase() || '?'}
        </div>
      </div>
    </header>
  );
}
