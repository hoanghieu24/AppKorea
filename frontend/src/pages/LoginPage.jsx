import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../api/auth';
import { apiErrorMessage } from '../api/client';
import { useAuthStore } from '../store/authStore';

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login(form);
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
        <div className="auth-title">Đăng nhập vào tài khoản</div>

        {error && <div className="auth-error">⚠️ {error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>Email</label>
            <input
              type="email" required autoFocus className="settings-input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="ban@email.com"
            />
          </div>
          <div className="auth-field">
            <label>Mật khẩu</label>
            <input
              type="password" required className="settings-input"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
            />
          </div>
          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {loading ? 'Đang đăng nhập...' : '🔑 Đăng nhập'}
          </button>
        </form>

        <div className="auth-switch">
          Chưa có tài khoản? <Link to="/register">Đăng ký ngay</Link>
        </div>
        <div className="helper-text" style={{ textAlign: 'center', marginTop: 14 }}>
          Demo: teacher@demo.com / student@demo.com — mật khẩu 123456
        </div>
      </div>
    </div>
  );
}
