import { useEffect, useState } from 'react';
import { Award, BookOpenCheck, CheckCircle2, GraduationCap, School, Search, Users } from 'lucide-react';
import { api } from '../api.js';
import { Empty, PageHeader, Pagination } from '../components/Shell.jsx';

export default function TeacherStudentsPage({ user }) {
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [queryText, setQueryText] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api('/classes').then((res) => setClasses(res.classes || [])).catch(() => {});
  }, []);

  const loadStudents = async (targetPage = page, search = queryText, classId = selectedClassId) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(targetPage), pageSize: '10' });
    if (classId) params.set('classId', classId);
    if (search.trim()) params.set('q', search.trim());
    try {
      const data = await api(`/teacher/students?${params.toString()}`);
      setStudents(data.students || []);
      setPagination(data.pagination);
      setMessage('');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => loadStudents(page, queryText, selectedClassId), queryText ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [page, queryText, selectedClassId]);

  const selectedClass = classes.find((item) => String(item.id) === selectedClassId);

  return (
    <>
      <PageHeader
        eyebrow="GIÁO VIÊN"
        title="Học sinh của tôi"
        subtitle={selectedClass ? `Đang xem danh sách học sinh thuộc Lớp ${selectedClass.name}.` : 'Xem danh sách toàn bộ học sinh thuộc các lớp bạn phụ trách, theo dõi tiến độ nộp bài và điểm trung bình.'}
      />
      {message && <div className="notice">{message}</div>}

      <div className="management-toolbar">
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          <label className="management-search" style={{ flex: 1, minWidth: 220 }}>
            <Search size={17} />
            <input
              value={queryText}
              onChange={(e) => { setQueryText(e.target.value); setPage(1); }}
              placeholder="Tìm theo tên học sinh, email..."
            />
          </label>
          <select
            value={selectedClassId}
            onChange={(e) => { setSelectedClassId(e.target.value); setPage(1); }}
            style={{ padding: '0 12px', borderRadius: 10, border: '1px solid var(--line)', background: '#fff', fontSize: '.84rem', fontWeight: 600, color: '#3730a3' }}
          >
            <option value="">🏫 Tất cả các lớp của tôi</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>Lớp {c.name} ({c.code})</option>
            ))}
          </select>
        </div>
        <span>{pagination?.total ?? students.length} học sinh</span>
      </div>

      <section className="panel management-table-panel">
        <div className="panel-title">
          <div>
            <span>DANH SÁCH HỌC SINH</span>
            <h3>{selectedClass ? `Lớp ${selectedClass.name}` : 'Tất cả các lớp phụ trách'}</h3>
          </div>
        </div>

        {loading ? (
          <Empty>Đang tải danh sách học sinh...</Empty>
        ) : students.length ? (
          <div className="management-table-wrap">
            <table className="management-table">
              <thead>
                <tr>
                  <th>Học sinh</th>
                  <th>Lớp phụ trách</th>
                  <th>Bài nộp</th>
                  <th>Điểm trung bình</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {students.map((item) => (
                  <tr key={`${item.id}-${item.classId}`}>
                    <td>
                      <div className="user-cell">
                        <div className="avatar small">{item.fullName?.slice(0, 1).toUpperCase()}</div>
                        <span>
                          <strong>{item.fullName}</strong>
                          <small>{item.email}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="class-context-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 8, background: '#eeebff', color: '#4338ca', fontSize: '.78rem', fontWeight: 700 }}>
                        <School size={13} /> {item.className} ({item.classCode})
                      </span>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.84rem', fontWeight: 600, color: '#374151' }}>
                        <BookOpenCheck size={15} color="var(--purple)" /> {item.submissionCount} bài đã nộp
                      </span>
                    </td>
                    <td>
                      {item.avgPercentage != null ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, background: '#ecfdf5', color: '#047857', fontWeight: 800, fontSize: '.82rem' }}>
                          <Award size={14} /> {item.avgPercentage}%
                        </span>
                      ) : (
                        <small className="muted">Chưa nộp bài</small>
                      )}
                    </td>
                    <td>
                      <span className={`status-chip ${item.active ? 'active' : 'inactive'}`}>
                        {item.active ? 'Đang học' : 'Đã khóa'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{selectedClass ? `Lớp ${selectedClass.name} chưa có học sinh.` : 'Chưa có học sinh trong các lớp phụ trách.'}</Empty>
        )}

        <Pagination pagination={pagination} loading={loading} onPageChange={setPage} label="học sinh" />
      </section>
    </>
  );
}
