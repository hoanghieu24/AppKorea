import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, ClipboardList, Megaphone, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, formatDate } from '../api.js';
import { Empty, PageHeader, Pagination } from '../components/Shell.jsx';

export default function NotificationsPage({ user }) {
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(false);
  const [classes, setClasses] = useState([]);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({ title: '', message: '', target: 'ALL' });

  const isStaff = user?.role === 'TEACHER' || user?.role === 'ADMIN';

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/notifications?page=${page}&pageSize=10`);
      setItems(data.notifications || []);
      setPagination(data.pagination);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    if (isStaff) {
      api('/classes').then((d) => setClasses(d.classes || [])).catch(() => {});
    }
  }, [isStaff]);

  const markAsRead = (item) => {
    if (item.readAt) return;
    setItems((prev) => prev.map((n) => n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n));
    api(`/notifications/${item.id}/read`, { method: 'PATCH', toast: false }).catch(() => {});
  };

  const sendAnnouncement = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.message.trim()) {
      return setMessage('Vui lòng nhập đầy đủ tiêu đề và nội dung thông báo.');
    }
    setSending(true);
    setMessage('');
    try {
      const res = await api('/notifications/announce', {
        method: 'POST',
        body: JSON.stringify({ title: form.title, message: form.message, classId: form.target }),
      });
      setMessage(res.message);
      setForm({ title: '', message: '', target: 'ALL' });
      await loadNotifications();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="CẬP NHẬT"
        title="Thông báo"
        subtitle={user?.role === 'ADMIN' ? "Gửi thông báo toàn trường hoặc theo từng lớp." : user?.role === 'TEACHER' ? "Gửi thông báo cho học sinh trong các lớp bạn phụ trách." : "Thông báo bài tập mới và lời nhắc từ giáo viên."}
      />
      {message && <div className="notice">{message}</div>}

      {isStaff && (
        <form className="panel announce-form" onSubmit={sendAnnouncement} style={{ marginBottom: 20 }}>
          <div className="panel-title">
            <div>
              <span>{user?.role === 'ADMIN' ? 'ADMIN' : 'GIÁO VIÊN'}</span>
              <h3><Megaphone size={19} style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px', color: 'var(--purple)' }} /> Gửi thông báo cho học sinh</h3>
            </div>
          </div>
          <div className="form-grid two">
            <label className="span-2">
              Tiêu đề thông báo
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Ví dụ: Ôn tập chuẩn bị kiểm tra giữa kỳ / Thông báo lịch học mới"
                required
              />
            </label>
            <label>
              Gửi đến
              <select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}>
                <option value="ALL">{user?.role === 'ADMIN' ? '📢 Tất cả học sinh toàn trường' : '📢 Tất cả học sinh các lớp của tôi'}</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    🏫 Chỉ học sinh Lớp {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              Nội dung thông báo
              <textarea
                rows="3"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Nhập nội dung dặn dò học sinh..."
                required
              />
            </label>
          </div>
          <div style={{ marginTop: 14, textAlign: 'right' }}>
            <button className="btn primary" disabled={sending}>
              <Send size={16} /> {sending ? 'Đang gửi thông báo...' : 'Gửi thông báo ngay'}
            </button>
          </div>
        </form>
      )}

      <section className="panel notification-panel">
        <div className="panel-title">
          <div>
            <span>DANH SÁCH</span>
            <h3>Thông báo của bạn</h3>
          </div>
        </div>
        {loading ? (
          <Empty>Đang tải thông báo...</Empty>
        ) : items.length ? (
          <div className="notification-list">
            {items.map((item) => {
              const isAssignmentLink = item.referenceType === 'ASSIGNMENT' && item.referenceId;
              const content = (
                <>
                  <div className={`notification-icon ${item.readAt ? '' : 'unread'}`}>
                    {item.type === 'NEW_ASSIGNMENT' ? <ClipboardList /> : item.type === 'ANNOUNCEMENT' ? <Megaphone /> : <Bell />}
                  </div>
                  <div className="grow">
                    <div className="notification-title">
                      <strong>{item.title}</strong>
                      {!item.readAt && <i>Mới</i>}
                    </div>
                    <p>{item.message}</p>
                    <span>{formatDate(item.createdAt)}</span>
                  </div>
                  {item.readAt ? <CheckCheck size={18} /> : null}
                </>
              );

              return isAssignmentLink ? (
                <Link
                  key={item.id}
                  to={`/assignments/${item.referenceId}`}
                  onClick={() => markAsRead(item)}
                  className={`notification-row ${item.readAt ? '' : 'unread'}`}
                >
                  {content}
                </Link>
              ) : (
                <div
                  key={item.id}
                  onClick={() => markAsRead(item)}
                  className={`notification-row ${item.readAt ? '' : 'unread'}`}
                  style={{ cursor: 'pointer' }}
                >
                  {content}
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>Chưa có thông báo nào.</Empty>
        )}
        <Pagination pagination={pagination} loading={loading} onPageChange={setPage} label="thông báo" />
      </section>
    </>
  );
}

