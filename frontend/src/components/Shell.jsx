import { useEffect, useMemo, useState } from 'react';
import { Bell, BookOpen, BrainCircuit, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, ClipboardList, GraduationCap, Home, LogOut, Menu, PanelLeftClose, PanelLeftOpen, School, Settings2, ShieldCheck, Smartphone, Users, X } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api, clearSession, roleLabel } from '../api.js';
export default function Shell({ user, onLogout, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('hanquoc_classroom_sidebar_collapsed') === '1');
  const [unread, setUnread] = useState(0);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const refreshUnread = () => api('/notifications?page=1&pageSize=1').then((data) => setUnread(data.unreadCount || 0)).catch(() => {});
    refreshUnread();
    const unreadTimer = window.setInterval(refreshUnread, 25000);
    const handler = (event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => { window.clearInterval(unreadTimer); window.removeEventListener('beforeinstallprompt', handler); };
  }, []);
  useEffect(() => {
    let timer;
    const handler = (event) => { clearTimeout(timer); setToast(event.detail || null); timer = setTimeout(() => setToast(null), 3200); };
    window.addEventListener('app-toast', handler);
    return () => { clearTimeout(timer); window.removeEventListener('app-toast', handler); };
  }, []);
  useEffect(() => { localStorage.setItem('hanquoc_classroom_sidebar_collapsed', sidebarCollapsed ? '1' : '0'); }, [sidebarCollapsed]);
  const navItems = useMemo(() => {
    const items = [{ to: '/', label: 'Tổng quan', icon: Home }];
    if (user.role !== 'ADMIN') items.push({ to: '/learning', label: 'Phòng tự học', icon: BrainCircuit });
    if (user.role !== 'ADMIN') items.push({ to: '/assignments', label: user.role === 'TEACHER' ? 'Giao & chấm bài' : 'Bài của tôi', icon: ClipboardList });
    if (user.role !== 'ADMIN') items.push({ to: '/vocabulary', label: 'Từ vựng', icon: BookOpen });
    if (user.role === 'TEACHER') items.push({ to: '/teacher/students', label: 'Học sinh của tôi', icon: Users });
    if (user.role === 'ADMIN') {
      items.push({ to: '/admin/classes', label: 'Quản lý lớp', icon: School });
      items.push({ to: '/admin/students', label: 'Quản lý học sinh', icon: Users });
      items.push({ to: '/admin/teachers', label: 'Quản lý giáo viên', icon: GraduationCap });
      items.push({ to: '/admin/users', label: 'Quản lý người dùng', icon: ShieldCheck });
      items.push({ to: '/settings', label: 'Cấu hình hệ thống', icon: Settings2 });
    }
    items.push({ to: '/notifications', label: 'Thông báo', icon: Bell, badge: unread });
    return items;
  }, [user.role, unread]);
  const logout = () => { clearSession(); onLogout(); navigate('/login'); };
  const install = async () => { if (!installPrompt) return; await installPrompt.prompt(); setInstallPrompt(null); };
  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark">한</div>
          <div className="brand-copy"><strong>HanQuoc</strong><span>Classroom · v2.2.8</span></div>
          <button className="icon-button close-mobile" onClick={() => setMobileOpen(false)} aria-label="Đóng menu"><X size={20} /></button>
        </div>
        <button className="sidebar-desktop-toggle" type="button" onClick={() => setSidebarCollapsed((value) => !value)} title={sidebarCollapsed ? 'Mở rộng menu' : 'Thu gọn menu'} aria-label={sidebarCollapsed ? 'Mở rộng menu' : 'Thu gọn menu'}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
        <nav className="side-nav">
          {navItems.map(({ to, label, icon: Icon, badge }) => (
            <NavLink key={to} to={to} end={to === '/'} title={sidebarCollapsed ? label : undefined} onClick={() => setMobileOpen(false)} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Icon size={19} /><span>{label}</span>{badge ? <b className="nav-badge">{badge}</b> : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {installPrompt && <button className="nav-link install" onClick={install} title={sidebarCollapsed ? 'Cài app điện thoại' : undefined}><Smartphone size={19} /><span>Cài app điện thoại</span></button>}
          <div className="account-box">
            <div className="avatar">{user.fullName?.slice(0, 1).toUpperCase()}</div>
            <div className="account-text"><strong>{user.fullName}</strong><span>{roleLabel[user.role]}</span></div>
            <button className="icon-button" onClick={logout} title="Đăng xuất"><LogOut size={18} /></button>
          </div>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-overlay" onClick={() => setMobileOpen(false)} aria-label="Đóng menu" />}
      <main className="main-area">
        <header className="mobile-header">
          <button className="icon-button" onClick={() => setMobileOpen(true)}><Menu /></button>
          <div className="brand-mini"><GraduationCap size={20} /> HanQuoc</div>
          <NavLink to="/notifications" className="icon-button bell-mobile"><Bell size={20} />{unread ? <i>{unread}</i> : null}</NavLink>
        </header>
        <div className={`page-wrap ${location.pathname === '/learning' ? 'learning-page-wrap' : ''}`}>{children}</div>
      </main>
      <nav className="bottom-nav">
        {navItems.slice(0, 5).map(({ to, label, icon: Icon, badge }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'bottom-link active' : 'bottom-link'}>
            <span><Icon size={20} />{badge ? <i>{badge}</i> : null}</span><small>{label}</small>
          </NavLink>
        ))}
      </nav>
      {toast && <div className={`app-toast ${toast.type === 'error' ? 'error' : 'success'}`} role="status">
        {toast.type === 'error' ? <CircleAlert size={19} /> : <CheckCircle2 size={19} />}
        <span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Đóng"><X size={16} /></button>
      </div>}
    </div>
  );
}
export function PageHeader({ eyebrow, title, subtitle, action }) { return <div className="page-head"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>; }
export function StatCard({ label, value, note, tone = 'purple', icon: Icon = ShieldCheck }) { return <div className={`stat-card ${tone}`}><div className="stat-icon"><Icon size={20} /></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>; }
export function Empty({ children = 'Chưa có dữ liệu.' }) { return <div className="empty-state"><GraduationCap size={30} /><p>{children}</p></div>; }
export function Pagination({ pagination, onPageChange, loading = false, label = 'dữ liệu' }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  const current = pagination.page; const totalPages = pagination.totalPages;
  const pageNumbers = [...new Set([1, current - 1, current, current + 1, totalPages])].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  return <div className="pagination-bar" aria-label={`Phân trang ${label}`}><span>{pagination.total} {label} · trang {current}/{totalPages}</span><div><button type="button" disabled={loading || !pagination.hasPrevious} onClick={() => onPageChange(current - 1)} aria-label="Trang trước"><ChevronLeft size={16} /></button>{pageNumbers.map((page, index) => <span key={page} className="pagination-number-wrap">{index > 0 && page - pageNumbers[index - 1] > 1 ? <i>…</i> : null}<button type="button" disabled={loading} className={page === current ? 'active' : ''} onClick={() => page !== current && onPageChange(page)}>{page}</button></span>)}<button type="button" disabled={loading || !pagination.hasNext} onClick={() => onPageChange(current + 1)} aria-label="Trang sau"><ChevronRight size={16} /></button></div></div>;
}
