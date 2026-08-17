import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Pencil, Plus, RotateCcw, Save, School, Search, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { api, formatDate, roleLabel } from '../api.js';
import { Empty, PageHeader, Pagination } from '../components/Shell.jsx';

const emptyUser = (role = 'STUDENT') => ({ fullName: '', email: '', password: '', role, active: true });
const emptyClass = { name: '', code: '', description: '', active: true };

export default function AdminManagementPage({ mode, currentUser }) {
  if (mode === 'classes') return <ClassManagement />;
  const fixedRole = mode === 'students' ? 'STUDENT' : mode === 'teachers' ? 'TEACHER' : null;
  return <UserManagement fixedRole={fixedRole} currentUser={currentUser} />;
}

function UserManagement({ fixedRole, currentUser }) {
  const [users, setUsers] = useState([]);
  const [queryText, setQueryText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyUser(fixedRole || 'STUDENT'));
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [listLoading, setListLoading] = useState(false);
  const [presence, setPresence] = useState({ onlineTotal: 0, onlineStudents: 0, onlineTeachers: 0, onlineAdmins: 0 });

  const load = async (targetPage = page, search = queryText, { silent = false } = {}) => {
    if (!silent) setListLoading(true);
    const params = new URLSearchParams({ page: String(targetPage), pageSize: '10' });
    if (fixedRole) params.set('role', fixedRole);
    if (search.trim()) params.set('q', search.trim());
    try {
      const data = await api(`/admin/users?${params.toString()}`, { toast: false });
      setUsers(data.users || []); setPagination(data.pagination);
      if (data.presence) setPresence(data.presence);
    } finally { if (!silent) setListLoading(false); }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => load(page, queryText), queryText ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [fixedRole, page, queryText]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(page, queryText, { silent: true }).catch(() => {});
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [fixedRole, page, queryText]);

  const title = fixedRole === 'STUDENT' ? 'Quản lý học sinh' : fixedRole === 'TEACHER' ? 'Quản lý giáo viên' : 'Quản lý người dùng';
  const eyebrow = fixedRole === 'STUDENT' ? 'ADMIN · HỌC SINH' : fixedRole === 'TEACHER' ? 'ADMIN · GIÁO VIÊN' : 'ADMIN · NGƯỜI DÙNG';
  const visible = users;
  const onlineCount = fixedRole === 'STUDENT' ? presence.onlineStudents : fixedRole === 'TEACHER' ? presence.onlineTeachers : presence.onlineTotal;
  const lastAccessText = (item) => {
    if (item.isOnline) return 'Đang sử dụng';
    if (item.lastSeenAt) return `Hoạt động cuối ${formatDate(item.lastSeenAt)}`;
    return 'Chưa có hoạt động';
  };

  const openCreate = () => {
    setEditingId(null); setForm(emptyUser(fixedRole || 'STUDENT')); setShowForm(true);
  };
  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({ fullName: item.fullName, email: item.email, password: '', role: item.role, active: Boolean(item.active) });
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(emptyUser(fixedRole || 'STUDENT')); };

  const save = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      if (editingId) {
        await api(`/admin/users/${editingId}`, { method: 'PUT', body: JSON.stringify({ ...form, role: fixedRole || form.role }) });
      } else {
        await api('/admin/users', { method: 'POST', body: JSON.stringify({ ...form, role: fixedRole || form.role }) });
      }
      closeForm(); await load();
    } finally { setBusy(false); }
  };

  const remove = async (item) => {
    if (!window.confirm(`Xóa ${item.fullName} khỏi hoạt động? Lịch sử bài và điểm vẫn được giữ.`)) return;
    await api(`/admin/users/${item.id}`, { method: 'DELETE' }); await load();
  };

  const restore = async (item) => {
    await api(`/admin/users/${item.id}`, { method: 'PUT', body: JSON.stringify({ fullName: item.fullName, email: item.email, password: '', role: item.role, active: true }) });
    await load();
  };

  return <>
    <PageHeader eyebrow={eyebrow} title={title} subtitle="Tạo, xem, sửa, khóa/khôi phục tài khoản. Dữ liệu học tập cũ luôn được bảo toàn." action={<button className="btn primary" onClick={openCreate}><Plus size={17} /> Thêm mới</button>} />
    <div className="management-toolbar">
      <label className="management-search"><Search size={17} /><input value={queryText} onChange={(e) => { setQueryText(e.target.value); setPage(1); }} placeholder="Tìm theo tên, email..." /></label>
      <div className="presence-toolbar-stats"><span className="presence-live-dot" /> <strong>{onlineCount}</strong> đang online <span>·</span> <span>{pagination?.total ?? visible.length} tài khoản</span></div>
    </div>

    {showForm && <section className="panel management-form-panel">
      <div className="panel-title"><div><span>{editingId ? 'UPDATE' : 'CREATE'}</span><h3>{editingId ? 'Sửa tài khoản' : 'Tạo tài khoản mới'}</h3></div><button className="icon-button" type="button" onClick={closeForm}><X size={18} /></button></div>
      <form className="form-grid management-form" onSubmit={save}>
        <label>Họ tên<input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></label>
        <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Vai trò<select disabled={Boolean(fixedRole)} value={fixedRole || form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="STUDENT">Học sinh</option><option value="TEACHER">Giáo viên</option><option value="ADMIN">Admin</option></select></label>
        <label>{editingId ? 'Mật khẩu mới (không bắt buộc)' : 'Mật khẩu tạm'}<input type="password" minLength={form.password ? 8 : undefined} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editingId} placeholder={editingId ? 'Để trống nếu không đổi' : 'Tối thiểu 8 ký tự'} /></label>
        {editingId && <label>Trạng thái<select value={form.active ? '1' : '0'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}><option value="1">Đang hoạt động</option><option value="0">Đã khóa</option></select></label>}
        <div className="management-form-actions"><button type="button" className="btn ghost" onClick={closeForm}>Hủy</button><button className="btn primary" disabled={busy}><Save size={17} /> {busy ? 'Đang lưu...' : 'Lưu'}</button></div>
      </form>
    </section>}

    <section className="panel management-table-panel">
      {listLoading ? <Empty>Đang tải trang tài khoản...</Empty> : visible.length ? <div className="management-table-wrap"><table className="management-table presence-table"><thead><tr><th>Người dùng</th><th>Vai trò</th><th>Trực tuyến</th><th>Đăng nhập gần nhất</th><th>Số lần đăng nhập</th><th>Tài khoản</th><th>Thao tác</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id} className={!item.active ? 'inactive-row' : ''}>
        <td><div className="user-cell"><div className="avatar small">{item.fullName?.slice(0, 1).toUpperCase()}</div><span><strong>{item.fullName}</strong><small>{item.email}</small></span></div></td>
        <td><span className={`role-chip ${item.role.toLowerCase()}`}>{roleLabel[item.role]}</span></td>
        <td><div className={`presence-state ${item.isOnline ? 'online' : 'offline'}`}><span className="presence-dot" /><span><strong>{item.isOnline ? 'Online' : 'Offline'}</strong><small>{lastAccessText(item)}</small></span></div></td>
        <td><span className="presence-date">{item.lastLoginAt ? formatDate(item.lastLoginAt) : 'Chưa đăng nhập'}</span></td>
        <td><span className="login-count-badge">{Number(item.loginCount || 0)} lần</span></td>
        <td><span className={`status-chip ${item.active ? 'active' : 'inactive'}`}>{item.active ? 'Hoạt động' : 'Đã khóa'}</span></td>
        <td><div className="row-actions"><button className="icon-button" title="Sửa" onClick={() => openEdit(item)}><Pencil size={16} /></button>{item.active ? <button className="icon-button danger" title="Xóa" disabled={Number(item.id) === Number(currentUser.id)} onClick={() => remove(item)}><Trash2 size={16} /></button> : <button className="icon-button restore" title="Khôi phục" onClick={() => restore(item)}><RotateCcw size={16} /></button>}</div></td>
      </tr>)}</tbody></table></div> : <Empty>Không tìm thấy tài khoản.</Empty>}
      <Pagination pagination={pagination} loading={listLoading} onPageChange={setPage} label="tài khoản" />
    </section>
  </>;
}

function ClassManagement() {
  const [classes, setClasses] = useState([]);
  const [users, setUsers] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyClass);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [members, setMembers] = useState({ teachers: [], students: [], teacherIds: [], studentIds: [], teacherPagination: null, studentPagination: null });
  const [teacherId, setTeacherId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [teacherPage, setTeacherPage] = useState(1);
  const [studentPage, setStudentPage] = useState(1);
  const [membersLoading, setMembersLoading] = useState(false);
  const [classOptions, setClassOptions] = useState([]);
  const [classPage, setClassPage] = useState(1);
  const [classPagination, setClassPagination] = useState(null);
  const [classesLoading, setClassesLoading] = useState(false);

  const load = async () => {
    setClassesLoading(true);
    try {
      const [classData, classOptionData, userData] = await Promise.all([
        api(`/admin/classes?page=${classPage}&pageSize=6`), api('/admin/classes?all=1'), api('/admin/users?all=1'),
      ]);
      setClasses(classData.classes || []); setClassPagination(classData.pagination); setClassOptions(classOptionData.classes || []); setUsers(userData.users || []);
    } finally { setClassesLoading(false); }
  };
  useEffect(() => { load(); }, [classPage]);
  const loadMembers = async () => {
    if (!selectedId) { setMembers({ teachers: [], students: [], teacherIds: [], studentIds: [], teacherPagination: null, studentPagination: null }); return; }
    setMembersLoading(true);
    try { setMembers(await api(`/classes/${selectedId}/members?teacherPage=${teacherPage}&studentPage=${studentPage}&pageSize=6`)); }
    finally { setMembersLoading(false); }
  };
  useEffect(() => {
    setTeacherPage(1); setStudentPage(1);
  }, [selectedId]);
  useEffect(() => { loadMembers(); }, [selectedId, teacherPage, studentPage]);

  const teacherMemberIds = new Set((members.teacherIds || members.teachers.map((member) => member.id)).map(Number));
  const studentMemberIds = new Set((members.studentIds || members.students.map((member) => member.id)).map(Number));
  const activeTeachers = users.filter((item) => item.role === 'TEACHER' && item.active && !teacherMemberIds.has(Number(item.id)));
  const activeStudents = users.filter((item) => item.role === 'STUDENT' && item.active && !studentMemberIds.has(Number(item.id)));

  const openCreate = () => { setEditingId(null); setForm(emptyClass); setShowForm(true); };
  const openEdit = (item) => { setEditingId(item.id); setForm({ name: item.name, code: item.code, description: item.description || '', active: Boolean(item.active) }); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(emptyClass); };
  const save = async (event) => {
    event.preventDefault();
    if (editingId) await api(`/admin/classes/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
    else await api('/admin/classes', { method: 'POST', body: JSON.stringify({ name: form.name, code: form.code, description: form.description }) });
    closeForm(); await load();
  };
  const remove = async (item) => {
    if (!window.confirm(`Xóa lớp ${item.name} khỏi hoạt động? Bài tập và điểm cũ vẫn được giữ.`)) return;
    await api(`/admin/classes/${item.id}`, { method: 'DELETE' }); await load();
  };
  const restore = async (item) => {
    await api(`/admin/classes/${item.id}`, { method: 'PUT', body: JSON.stringify({ name: item.name, code: item.code, description: item.description || '', active: true }) }); await load();
  };
  const addMember = async (kind) => {
    const personId = kind === 'teachers' ? teacherId : studentId;
    if (!selectedId || !personId) return;
    const body = kind === 'teachers' ? { teacherId: Number(personId) } : { studentId: Number(personId) };
    await api(`/admin/classes/${selectedId}/${kind}`, { method: 'POST', body: JSON.stringify(body) });
    setTeacherId(''); setStudentId(''); await loadMembers(); await load();
  };
  const removeMember = async (kind, memberId) => {
    if (!window.confirm(`Gỡ ${kind === 'teachers' ? 'giáo viên' : 'học sinh'} này khỏi lớp?`)) return;
    await api(`/admin/classes/${selectedId}/${kind}/${memberId}`, { method: 'DELETE' });
    await loadMembers(); await load();
  };

  return <>
    <PageHeader eyebrow="ADMIN · LỚP HỌC" title="Quản lý lớp" subtitle="CRUD lớp học và quản lý thành viên của từng lớp tại một chỗ." action={<button className="btn primary" onClick={openCreate}><Plus size={17} /> Tạo lớp</button>} />
    {showForm && <section className="panel management-form-panel">
      <div className="panel-title"><div><span>{editingId ? 'UPDATE' : 'CREATE'}</span><h3>{editingId ? 'Sửa lớp học' : 'Tạo lớp mới'}</h3></div><button className="icon-button" onClick={closeForm}><X size={18} /></button></div>
      <form className="form-grid management-form" onSubmit={save}>
        <label>Tên lớp<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label>Mã lớp<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></label>
        <label className="span-2">Mô tả<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        {editingId && <label>Trạng thái<select value={form.active ? '1' : '0'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}><option value="1">Đang hoạt động</option><option value="0">Ngừng hoạt động</option></select></label>}
        <div className="management-form-actions"><button type="button" className="btn ghost" onClick={closeForm}>Hủy</button><button className="btn primary"><Save size={17} /> Lưu</button></div>
      </form>
    </section>}

    {classesLoading ? <section className="panel"><Empty>Đang tải trang lớp học...</Empty></section> : <section className="management-class-grid">{classes.map((item) => <article className={`panel management-class-card ${!item.active ? 'inactive-card' : ''}`} key={item.id}>
      <div className="class-manage-head"><div className="class-code">{item.code}</div><span className={`status-chip ${item.active ? 'active' : 'inactive'}`}>{item.active ? 'Hoạt động' : 'Đã xóa'}</span></div>
      <h3>{item.name}</h3><p>{item.description || 'Chưa có mô tả.'}</p><div className="class-manage-stats"><span><Users size={15} /> {item.studentCount} HS</span><span><GraduationCap size={15} /> {item.teacherCount} GV</span></div>
      <div className="class-manage-actions"><button className="btn ghost small" onClick={() => setSelectedId(String(item.id))}><School size={15} /> Thành viên</button><button className="icon-button" title="Sửa" onClick={() => openEdit(item)}><Pencil size={16} /></button>{item.active ? <button className="icon-button danger" title="Xóa" onClick={() => remove(item)}><Trash2 size={16} /></button> : <button className="icon-button restore" title="Khôi phục" onClick={() => restore(item)}><RotateCcw size={16} /></button>}</div>
    </article>)}</section>}
    {!classes.length && <section className="panel"><Empty>Chưa có lớp nào.</Empty></section>}
    <Pagination pagination={classPagination} loading={classesLoading} onPageChange={setClassPage} label="lớp" />

    <section className="panel class-member-manager">
      <div className="panel-title"><div><span>THÀNH VIÊN LỚP</span><h3>Giao giáo viên & xếp học sinh</h3></div><select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}><option value="">Chọn lớp</option>{classOptions.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      {!selectedId ? <Empty>Chọn một lớp để quản lý thành viên.</Empty> : <div className="member-columns">
        <div><h4><GraduationCap size={17} /> Giáo viên</h4><div className="member-add"><select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}><option value="">Chọn giáo viên</option>{activeTeachers.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select><button className="btn secondary small" disabled={!teacherId} onClick={() => addMember('teachers')}><UserPlus size={15} /> Thêm</button></div><div className="member-list">{membersLoading ? <small className="muted">Đang tải...</small> : members.teachers.map((item) => <div key={item.id}><span><strong>{item.fullName}</strong><small>{item.email}</small></span><button className="icon-button danger" onClick={() => removeMember('teachers', item.id)}><UserMinus size={16} /></button></div>)}{!membersLoading && !members.teachers.length && <small className="muted">Chưa có giáo viên.</small>}</div><Pagination pagination={members.teacherPagination} loading={membersLoading} onPageChange={setTeacherPage} label="giáo viên" /></div>
        <div><h4><Users size={17} /> Học sinh</h4><div className="member-add"><select value={studentId} onChange={(e) => setStudentId(e.target.value)}><option value="">Chọn học sinh</option>{activeStudents.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select><button className="btn secondary small" disabled={!studentId} onClick={() => addMember('students')}><UserPlus size={15} /> Thêm</button></div><div className="member-list">{membersLoading ? <small className="muted">Đang tải...</small> : members.students.map((item) => <div key={item.id}><span><strong>{item.fullName}</strong><small>{item.email}{item.submissions ? ` · ${item.submissions} bài` : ''}</small></span><button className="icon-button danger" onClick={() => removeMember('students', item.id)}><UserMinus size={16} /></button></div>)}{!membersLoading && !members.students.length && <small className="muted">Chưa có học sinh.</small>}</div><Pagination pagination={members.studentPagination} loading={membersLoading} onPageChange={setStudentPage} label="học sinh" /></div>
      </div>}
    </section>
  </>;
}
