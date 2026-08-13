import { useState } from 'react';
import { ArrowRight, BookOpenCheck, BrainCircuit, GraduationCap, Users } from 'lucide-react';
import { api, saveSession } from '../api.js';

const demos = [
  ['Admin', 'admin@hanquoc.local', 'Admin@123'],
  ['Giáo viên', 'teacher@hanquoc.local', 'Teacher@123'],
  ['Học sinh', 'student@hanquoc.local', 'Student@123'],
];

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('student@hanquoc.local');
  const [password, setPassword] = useState('Student@123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true); setError('');
    try {
      const session = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }), toast: false });
      saveSession(session);
      onLogin(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-visual">
        <div className="login-brand"><div className="brand-mark big">한</div><strong>HanQuoc Classroom</strong></div>
        <div className="hero-copy">
          <span className="hero-pill">HỌC TIẾNG HÀN · CÙNG MỘT LỚP</span>
          <h1>Học dễ hơn.<br />Dạy <em>nhẹ đầu</em> hơn.</h1>
          <p>Từ vựng theo sách, bài tập, kiểm tra và phân tích phần học sinh cần ôn — trong một giao diện gọn trên cả web lẫn điện thoại.</p>
        </div>
        <div className="login-features">
          <div><Users /><span><strong>Lớp học rõ ràng</strong><small>3 vai trò, đúng quyền</small></span></div>
          <div><BrainCircuit /><span><strong>AI hỗ trợ chấm</strong><small>Feedback sau khi nộp</small></span></div>
          <div><BookOpenCheck /><span><strong>Học theo sách</strong><small>Chọn bài, đẩy từ vào lớp</small></span></div>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-login-logo"><GraduationCap /> HanQuoc</div>
          <span className="eyebrow">CHÀO MỪNG TRỞ LẠI</span>
          <h2>Đăng nhập</h2>
          <p>Dùng tài khoản được quản trị viên cấp.</p>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
          <label>Mật khẩu<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary full" disabled={loading}>{loading ? 'Đang vào lớp...' : <>Vào lớp <ArrowRight size={18} /></>}</button>
          <div className="demo-box">
            <strong>Tài khoản demo</strong>
            <div className="demo-users">
              {demos.map(([label, demoEmail, demoPassword]) => <button type="button" key={label} onClick={() => { setEmail(demoEmail); setPassword(demoPassword); }}>{label}</button>)}
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
