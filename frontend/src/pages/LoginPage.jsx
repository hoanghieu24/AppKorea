import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';
import { api, saveSession } from '../api.js';
import './LoginPage.css';

// Hiệu ứng pháo hoa hạt kỷ niệm (Confetti Canvas) khi đăng nhập thành công
function ConfettiCanvas({ active }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Bảng màu rực rỡ phong cách Hàn Quốc hiện đại
    const colors = [
      '#6366f1', '#8b5cf6', '#ec4899', '#3b82f6',
      '#10b981', '#f59e0b', '#fbbf24', '#38bdf8', '#c084fc',
    ];

    const particleCount = Math.min(100, Math.floor(window.innerWidth / 12));
    const particles = Array.from({ length: particleCount }).map(() => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 260,
      y: window.innerHeight / 2 + (Math.random() - 0.5) * 160,
      vx: (Math.random() - 0.5) * 18,
      vy: (Math.random() - 1.25) * 15 - 4,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 14,
      opacity: 1,
      gravity: 0.38,
      shape: Math.random() > 0.4 ? 'rect' : 'circle',
    }));

    let animationId;
    const startTime = Date.now();

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const elapsed = Date.now() - startTime;

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.rotation += p.rotationSpeed;
        p.opacity = Math.max(0, 1 - elapsed / 1300);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;

        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (elapsed < 1300) {
        animationId = requestAnimationFrame(render);
      }
    };

    animationId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [active]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  );
}

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'success' | 'error'
  const [error, setError] = useState('');
  const [welcomeName, setWelcomeName] = useState('');
  const [shake, setShake] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (status === 'loading' || status === 'success') return;

    setStatus('loading');
    setError('');
    setShake(false);

    try {
      const session = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
        toast: false,
      });
      const cleanSession = saveSession(session);
      setStatus('success');
      setWelcomeName(cleanSession?.user?.fullName || 'bạn');

      // Tận hưởng hiệu ứng pháo hoa và chào mừng 950ms trước khi chuyển trang
      setTimeout(() => {
        onLogin(cleanSession);
      }, 950);
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Đăng nhập không thành công. Vui lòng kiểm tra lại tài khoản hoặc mật khẩu.');
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  const fillDemo = (demoEmail, demoRole) => {
    setEmail(demoEmail);
    setError('');
    const inputPass = document.getElementById('login-password-input');
    if (inputPass) inputPass.focus();
  };

  return (
    <div className="login-page-v2">
      <ConfettiCanvas active={status === 'success'} />

      {/* CỘT BÊN TRÁI: Visual Hero & Tính năng nổi bật */}
      <section className="login-visual-v2">
        <div className="login-brand-v2">
          <div className="brand-badge-v2">한</div>
          <div className="brand-text-v2">
            <strong>HanQuoc Classroom</strong>
            <span>Hệ Thống Đào Tạo Tiếng Hàn</span>
          </div>
        </div>

        <div className="hero-content-v2">
          <span className="hero-pill-v2">
            <Sparkles size={14} /> NỀN TẢNG LỚP HỌC THÔNG MINH · CÙNG MỘT LỚP
          </span>
          <h1 className="hero-title-v2">
            Học tập dễ dàng.<br />
            Chấm bài <span className="text-highlight">thần tốc</span> với AI.
          </h1>
          <p className="hero-desc-v2">
            Hệ sinh thái toàn diện dành cho trung tâm và trường học: từ vựng chuẩn sách,
            chấm tự luận tự động không nghẽn tải, thống kê tiến độ học viên theo thời gian thực.
          </p>
        </div>

        <div className="hero-features-v2">
          <div className="feature-glass-card">
            <div className="feature-icon-wrap">
              <BrainCircuit size={20} />
            </div>
            <strong>AI Chấm Tức Thì</strong>
            <small>Tối ưu bộ nhớ đệm, nhận xét chi tiết sau khi nộp</small>
          </div>

          <div className="feature-glass-card">
            <div className="feature-icon-wrap">
              <BookOpenCheck size={20} />
            </div>
            <strong>Giáo Trình Chuẩn</strong>
            <small>Học theo bài, đẩy từ vựng và bài tập vào lớp 1 chạm</small>
          </div>

          <div className="feature-glass-card">
            <div className="feature-icon-wrap">
              <Zap size={20} />
            </div>
            <strong>Vận Hành Ổn Định</strong>
            <small>Chống nghẽn tải cao, phục vụ hàng trăm học sinh cùng lúc</small>
          </div>
        </div>
      </section>

      {/* CỘT BÊN PHẢI: Form Đăng Nhập Hiện Đại */}
      <section className="login-panel-v2">
        <form
          className={`login-card-v2 ${status === 'success' ? 'success-glow' : ''} ${shake ? 'animate-shake' : ''}`}
          onSubmit={submit}
        >
          <div className="mobile-brand-v2">
            <div className="brand-badge-v2" style={{ width: 38, height: 38, fontSize: '1.2rem' }}>한</div>
            <strong style={{ color: '#fff', fontSize: '1.1rem' }}>HanQuoc Classroom</strong>
          </div>

          <div className="login-card-header">
            <span className="login-eyebrow">
              <ShieldCheck size={14} /> ĐĂNG NHẬP HỆ THỐNG
            </span>
            <h2>Chào mừng trở lại!</h2>
            <p>Vui lòng nhập tài khoản được quản trị viên hoặc giáo viên cấp.</p>
          </div>

          {/* Banner chúc mừng khi đăng nhập thành công */}
          {status === 'success' && (
            <div className="login-success-banner">
              <CheckCircle2 size={19} />
              <span>Chào mừng <strong>{welcomeName}</strong>! Đang chuyển vào lớp học...</span>
            </div>
          )}

          {/* Cảnh báo lỗi */}
          {error && status !== 'success' && (
            <div className="login-error-alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="login-form-group">
            <label htmlFor="login-email-input">Email đăng nhập</label>
            <div className="input-with-icon">
              <Mail className="input-icon-left" />
              <input
                id="login-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="Ví dụ: teacher@hanquoc.local"
                required
                disabled={status === 'loading' || status === 'success'}
              />
            </div>
          </div>

          <div className="login-form-group">
            <label htmlFor="login-password-input">Mật khẩu</label>
            <div className="input-with-icon">
              <Lock className="input-icon-left" />
              <input
                id="login-password-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Nhập mật khẩu của bạn..."
                required
                disabled={status === 'loading' || status === 'success'}
              />
              <button
                type="button"
                className="input-toggle-right"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className={`login-submit-btn ${status === 'loading' ? 'is-loading' : ''} ${status === 'success' ? 'is-success' : ''}`}
            disabled={status === 'loading' || status === 'success'}
          >
            {status === 'loading' && (
              <>
                <span className="spin-icon">⏳</span>
                <span>Đang xác thực thông tin...</span>
              </>
            )}
            {status === 'success' && (
              <>
                <CheckCircle2 size={20} />
                <span>Xác thực thành công! ✨</span>
              </>
            )}
            {status !== 'loading' && status !== 'success' && (
              <>
                <span>Vào lớp học ngay</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>

          {/* Hộp hỗ trợ điền nhanh cho quản trị & kiểm thử */}
          <div className="login-demo-helper">
            <div className="login-demo-header">
              <span>Gợi ý tài khoản nhanh:</span>
            </div>
            <div className="login-demo-badges">
              <button
                type="button"
                className="demo-chip"
                onClick={() => fillDemo('admin@hanquoc.local', 'Admin')}
              >
                👑 Quản trị (Admin)
              </button>
              <button
                type="button"
                className="demo-chip"
                onClick={() => fillDemo('teacher@hanquoc.local', 'Giáo viên')}
              >
                👩‍🏫 Giáo viên (Hana)
              </button>
              <button
                type="button"
                className="demo-chip"
                onClick={() => fillDemo('student@hanquoc.local', 'Học sinh')}
              >
                🎓 Học sinh (Minh Anh)
              </button>
            </div>
          </div>

          <div className="login-footer-note">
            <ShieldCheck size={14} />
            <span>Hệ thống bảo mật đa lớp · Kết nối SSL an toàn</span>
          </div>
        </form>
      </section>
    </div>
  );
}
