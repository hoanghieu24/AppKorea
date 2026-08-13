import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../api/auth';
import { apiErrorMessage } from '../api/client';
import { useAuthStore } from '../store/authStore';

const ROLES = [
  { value: 'student', icon: '🧑‍🎓', label: 'Học sinh', desc: 'Học từ vựng, làm bài tập được giao' },
  { value: 'teacher', icon: '👩‍🏫', label: 'Giáo viên', desc: 'Tạo lớp, giao & chấm bài tập' },
];

export default function RegisterPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'student' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.register(form);
      login(res.token, res.user);
      navigate('/');
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="logo-icon">🇰🇷</span>
          <div>
            <h1>HanQuoc</h1>
            <span>Learn AI</span>
          </div>
        </div>
        <div className="auth-title">Tạo tài khoản mới</div>

        {error && <div className="auth-error">⚠️ {error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>Bạn là</label>
            <div className="role-grid">
              {ROLES.map((r) => (
                <button
                  type="button" key={r.value}
                  className={`personality-btn ${form.role === r.value ? 'active' : ''}`}
                  onClick={() => setForm({ ...form, role: r.value })}
                >
                  <span>{r.icon}</span>
                  <strong>{r.label}</strong>
                  <small>{r.desc}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="auth-field">
            <label>Họ và tên</label>
            <input
              type="text" required className="settings-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Nguyễn Văn A"
            />
          </div>
          <div className="auth-field">
            <label>Email</label>
            <input
              type="email" required className="settings-input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="ban@email.com"
            />
          </div>
          <div className="auth-field">
            <label>Mật khẩu (tối thiểu 6 ký tự)</label>
            <input
              type="password" required minLength={6} className="settings-input"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
            />
          </div>
          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {loading ? 'Đang tạo tài khoản...' : '✨ Đăng ký'}
          </button>
        </form>

        <div className="auth-switch">
          Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
        </div>
      </div>
    </div>
  );
}
