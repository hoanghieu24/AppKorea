import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, ClipboardList, Clock3, GraduationCap, RefreshCw, School, Sparkles, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, formatDate } from '../api.js';
import { Empty, PageHeader, StatCard } from '../components/Shell.jsx';

export default function DashboardPage({ user }) {
  if (user.role === 'ADMIN') return <AdminDashboard user={user} />;
  if (user.role === 'TEACHER') return <TeacherDashboard user={user} />;
  return <StudentDashboard user={user} />;
}

function AdminDashboard({ user }) {
  const [classes, setClasses] = useState([]);
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState('');
  const [userForm, setUserForm] = useState({ fullName: '', email: '', password: '', role: 'STUDENT' });
  const [classForm, setClassForm] = useState({ name: '', code: '', description: '' });
  const [memberForm, setMemberForm] = useState({ classId: '', teacherId: '', studentId: '' });
  const [presence, setPresence] = useState({ onlineTotal: 0, onlineStudents: 0, onlineTeachers: 0, onlineAdmins: 0 });
  const [refreshingPresence, setRefreshingPresence] = useState(false);
  const [presenceUpdatedAt, setPresenceUpdatedAt] = useState(null);

  const load = async ({ presenceOnly = false, manual = false } = {}) => {
    if (manual) setRefreshingPresence(true);
    try {
      if (presenceOnly) {
        const userData = await api('/admin/users?page=1&pageSize=1', { toast: false });
        if (userData.presence) setPresence(userData.presence);
        setPresenceUpdatedAt(new Date());
        return;
      }
      const [classData, userData] = await Promise.all([api('/classes'), api('/admin/users?all=1')]);
      setClasses(classData.classes); setUsers(userData.users);
      if (userData.presence) setPresence(userData.presence);
      setPresenceUpdatedAt(new Date());
      setMemberForm((old) => ({ ...old, classId: old.classId || String(classData.classes[0]?.id || '') }));
    } finally {
      if (manual) setRefreshingPresence(false);
    }
  };
  useEffect(() => {
    load().catch((err) => setMessage(err.message));
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load({ presenceOnly: true }).catch(() => {});
    }, 15_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') load({ presenceOnly: true }).catch(() => {}); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  const teachers = users.filter((item) => item.role === 'TEACHER');
  const students = users.filter((item) => item.role === 'STUDENT');
  const createUser = async (event) => {
    event.preventDefault();
    try {
      const data = await api('/admin/users', { method: 'POST', body: JSON.stringify(userForm) });
      setMessage(data.message); setUserForm({ fullName: '', email: '', password: '', role: 'STUDENT' }); await load();
    } catch (err) { setMessage(err.message); }
  };
  const createClass = async (event) => {
    event.preventDefault();
    try {
      const data = await api('/admin/classes', { method: 'POST', body: JSON.stringify(classForm) });
      setMessage(data.message); setClassForm({ name: '', code: '', description: '' }); await load();
    } catch (err) { setMessage(err.message); }
  };
  const assign = async (kind) => {
    const personId = kind === 'teachers' ? memberForm.teacherId : memberForm.studentId;
    if (!memberForm.classId || !personId) return setMessage('Chọn lớp và tài khoản trước.');
    try {
      const body = kind === 'teachers' ? { teacherId: Number(personId) } : { studentId: Number(personId) };
      const data = await api(`/admin/classes/${memberForm.classId}/${kind}`, { method: 'POST', body: JSON.stringify(body) });
      setMessage(data.message); await load();
    } catch (err) { setMessage(err.message); }
  };

  return <>
    <PageHeader eyebrow="QUẢN TRỊ" title={`Chào ${user.fullName}`} subtitle="Tạo tài khoản, mở lớp và giao đúng giáo viên vào lớp." action={<button type="button" className="btn ghost" onClick={() => load({ presenceOnly: true, manual: true }).catch(() => {})} disabled={refreshingPresence}><RefreshCw size={16} className={refreshingPresence ? 'spin' : ''} /> {refreshingPresence ? 'Đang cập nhật...' : 'Làm mới online'}</button>} />
    {message && <div className="notice">{message}</div>}
    <div className="stats-grid">
      <StatCard label="Lớp đang có" value={classes.length} note="Do admin quản lý" icon={School} />
      <StatCard label="Đang online" value={presence.onlineTotal} note={presenceUpdatedAt ? `Cập nhật ${presenceUpdatedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Tự cập nhật mỗi 15 giây'} tone="green" icon={Users} />
      <StatCard label="Giáo viên" value={teachers.length} note="Tài khoản hoạt động" icon={GraduationCap} />
      <StatCard label="Học sinh" value={students.length} note="Trên toàn hệ thống" tone="orange" icon={Users} />
    </div>
    <div className="two-col admin-grid">
      <section className="panel"><div className="panel-title"><div><span>TÀI KHOẢN</span><h3>Tạo người dùng</h3></div></div>
        <form className="form-grid" onSubmit={createUser}>
          <label>Họ tên<input value={userForm.fullName} onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })} required /></label>
          <label>Vai trò<select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}><option value="STUDENT">Học sinh</option><option value="TEACHER">Giáo viên</option><option value="ADMIN">Admin</option></select></label>
          <label>Email<input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required /></label>
          <label>Mật khẩu tạm<input type="text" minLength="8" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} required /></label>
          <button className="btn primary">Tạo tài khoản</button>
        </form>
      </section>
      <section className="panel"><div className="panel-title"><div><span>LỚP HỌC</span><h3>Tạo lớp mới</h3></div></div>
        <form className="form-grid" onSubmit={createClass}>
          <label>Tên lớp<input value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} placeholder="Sơ cấp 1 - K02" required /></label>
          <label>Mã lớp<input value={classForm.code} onChange={(e) => setClassForm({ ...classForm, code: e.target.value })} placeholder="K02" required /></label>
          <label className="span-2">Mô tả<input value={classForm.description} onChange={(e) => setClassForm({ ...classForm, description: e.target.value })} /></label>
          <button className="btn primary">Tạo lớp</button>
        </form>
      </section>
    </div>
    <section className="panel"><div className="panel-title"><div><span>PHÂN LỚP</span><h3>Giao giáo viên & thêm học sinh</h3></div><span className="muted">Có thể thêm nhiều học sinh vào cùng lớp</span></div>
      <div className="assign-row">
        <select value={memberForm.classId} onChange={(e) => setMemberForm({ ...memberForm, classId: e.target.value })}><option value="">Chọn lớp</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={memberForm.teacherId} onChange={(e) => setMemberForm({ ...memberForm, teacherId: e.target.value })}><option value="">Chọn giáo viên</option>{teachers.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select>
        <button className="btn secondary" onClick={() => assign('teachers')}>Giao giáo viên</button>
        <select value={memberForm.studentId} onChange={(e) => setMemberForm({ ...memberForm, studentId: e.target.value })}><option value="">Chọn học sinh</option>{students.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select>
        <button className="btn secondary" onClick={() => assign('students')}>Thêm học sinh</button>
      </div>
      <div className="class-cards">{classes.map((item) => <div className="class-card" key={item.id}><div className="class-code">{item.code}</div><div><strong>{item.name}</strong><span>{item.studentCount} học sinh · {item.teacherCount} giáo viên</span></div></div>)}</div>
    </section>
  </>;
}

function TeacherDashboard({ user }) {
  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  useEffect(() => { Promise.all([api('/classes'), api('/assignments')]).then(([a, b]) => { setClasses(a.classes); setAssignments(b.assignments); }); }, []);
  const published = assignments.filter((item) => item.status === 'PUBLISHED');
  const submitted = assignments.reduce((sum, item) => sum + Number(item.submittedCount || 0), 0);
  return <>
    <PageHeader eyebrow="GIÁO VIÊN" title={`Chào ${user.fullName} 👋`} subtitle="Hôm nay lớp nào cần bạn để mắt tới?" action={<Link className="btn primary" to="/assignments">+ Tạo bài mới</Link>} />
    <div className="stats-grid">
      <StatCard label="Lớp phụ trách" value={classes.length} note={`${classes.reduce((n, c) => n + Number(c.studentCount), 0)} lượt học sinh`} icon={School} />
      <StatCard label="Bài đang mở" value={published.length} note="BTVN + kiểm tra" tone="orange" icon={ClipboardList} />
      <StatCard label="Lượt đã nộp" value={submitted} note="Có thể xem điểm ngay" tone="green" icon={CheckCircle2} />
    </div>
    <div className="two-col">
      <section className="panel"><div className="panel-title"><div><span>LỚP CỦA TÔI</span><h3>Tiến độ nhanh</h3></div><Link to="/vocabulary">Tích hợp từ vựng →</Link></div>
        {classes.length ? <div className="stack-list">{classes.map((item) => { const classOpen = assignments.filter((assignment) => Number(assignment.class_id) === Number(item.id) && assignment.status === 'PUBLISHED').length; return <div className="list-row" key={item.id}><div className="round-icon purple"><School size={18} /></div><div className="grow"><strong>{item.name}</strong><span>{item.studentCount} học sinh · {classOpen} bài đang mở · {item.code}</span></div><Link to={`/assignments?classId=${item.id}`}>Mở</Link></div>; })}</div> : <Empty>Admin chưa giao lớp nào.</Empty>}
      </section>
      <section className="panel"><div className="panel-title"><div><span>GẦN ĐÂY</span><h3>Bài đã tạo</h3></div><Link to="/assignments">Xem tất cả</Link></div>
        {assignments.length ? <div className="stack-list">{assignments.slice(0, 5).map((item) => <Link className="list-row clickable" to={`/assignments/${item.id}`} key={item.id}><div className={`round-icon ${item.type === 'TEST' ? 'orange' : 'green'}`}><ClipboardList size={18} /></div><div className="grow"><strong>{item.title}</strong><span><b className="recent-class-name">Lớp: {item.className}</b> · {item.status === 'DRAFT' ? 'Bản nháp' : `${item.submittedCount || 0}/${item.studentCount || 0} đã nộp`}</span></div><ArrowRight size={17} /></Link>)}</div> : <Empty>Chưa có bài nào.</Empty>}
      </section>
    </div>
  </>;
}

function StudentDashboard({ user }) {
  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  useEffect(() => { Promise.all([api('/classes'), api('/assignments'), api('/students/me/recommendations')]).then(([a, b, c]) => { setClasses(a.classes); setAssignments(b.assignments); setRecommendations(c.recommendations); }); }, []);
  const pending = assignments.filter((item) => !item.submissionId && item.status === 'PUBLISHED');
  const done = assignments.filter((item) => item.submissionId);
  const average = done.length ? Math.round(done.reduce((sum, item) => sum + Number(item.percentage || 0), 0) / done.length) : 0;
  const next = pending[0];
  return <>
    <PageHeader eyebrow="HỌC SINH" title={`안녕하세요, ${user.fullName}!`} subtitle="Một chút mỗi ngày là đủ để tiến bộ. Đây là việc cần làm tiếp theo." />
    {next && <section className="hero-task"><div><span className="hero-task-label"><Sparkles size={16} /> TIẾP THEO</span><h2>{next.title}</h2><p>{next.className} · Hạn {formatDate(next.due_at)}</p><Link className="btn white" to={`/assignments/${next.id}`}>Làm bài ngay <ArrowRight size={17} /></Link></div><div className="hero-hangul">가</div></section>}
    <div className="stats-grid student-stats">
      <StatCard label="Bài cần làm" value={pending.length} note="Đang chờ bạn" tone="orange" icon={Clock3} />
      <StatCard label="Điểm trung bình" value={`${average}%`} note={`${done.length} bài đã nộp`} tone="green" icon={CheckCircle2} />
      <StatCard label="Lớp đang học" value={classes.length} note={classes[0]?.name || 'Chưa có lớp'} icon={School} />
    </div>
    <div className="two-col">
      <section className="panel"><div className="panel-title"><div><span>CẦN LÀM</span><h3>Bài được giao</h3></div><Link to="/assignments">Tất cả →</Link></div>
        {pending.length ? <div className="stack-list">{pending.slice(0, 5).map((item) => <Link className="list-row clickable" key={item.id} to={`/assignments/${item.id}`}><div className={`round-icon ${item.type === 'TEST' ? 'orange' : 'purple'}`}><ClipboardList size={18} /></div><div className="grow"><strong>{item.title}</strong><span>{item.className} · {formatDate(item.due_at)}</span></div><ArrowRight size={17} /></Link>)}</div> : <Empty>Bài đã làm hết rồi. Gọn!</Empty>}
      </section>
      <section className="panel"><div className="panel-title"><div><span>ÔN THÔNG MINH</span><h3>Phần cần củng cố</h3></div><Link to="/vocabulary">Ôn từ →</Link></div>
        {recommendations.length ? <div className="recommend-list">{recommendations.slice(0, 4).map((item) => <div className="recommend-item" key={item.topic}><div className="mastery"><span style={{ width: `${item.mastery}%` }} /></div><div><strong>{item.topic}</strong><span>{item.mastery}% nắm vững · nên ôn lại</span></div></div>)}</div> : <Empty>Làm vài bài để hệ thống nhận ra phần cần ôn.</Empty>}
      </section>
    </div>
  </>;
}
