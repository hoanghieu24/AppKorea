import { useEffect, useState } from 'react';
import { Bell, CheckCheck, ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, formatDate } from '../api.js';
import { Empty, PageHeader, Pagination } from '../components/Shell.jsx';

export default function NotificationsPage() {
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = () => { setLoading(true); return api(`/notifications?page=${page}&pageSize=10`).then((data) => { setItems(data.notifications); setPagination(data.pagination); }).catch((err) => setMessage(err.message)).finally(() => setLoading(false)); };
  useEffect(load, [page]);
  const read = async (item) => {
    try { if (!item.readAt) await api(`/notifications/${item.id}/read`, { method: 'PATCH', toast: false }); await load(); }
    catch (err) { setMessage(err.message); }
  };
  return <>
    <PageHeader eyebrow="CẬP NHẬT" title="Thông báo" subtitle="Bài giáo viên vừa giao sẽ xuất hiện ở đây ngay khi được publish." />
    {message && <div className="notice">{message}</div>}
    <section className="panel notification-panel">{loading ? <Empty>Đang tải thông báo...</Empty> : items.length ? <div className="notification-list">{items.map((item) => {
      const content = <><div className={`notification-icon ${item.readAt ? '' : 'unread'}`}>{item.type === 'NEW_ASSIGNMENT' ? <ClipboardList /> : <Bell />}</div><div className="grow"><div className="notification-title"><strong>{item.title}</strong>{!item.readAt && <i>Mới</i>}</div><p>{item.message}</p><span>{formatDate(item.createdAt)}</span></div>{item.readAt ? <CheckCheck size={18} /> : null}</>;
      return item.referenceType === 'ASSIGNMENT' ? <Link key={item.id} to={`/assignments/${item.referenceId}`} onClick={() => read(item)} className={`notification-row ${item.readAt ? '' : 'unread'}`}>{content}</Link> : <button key={item.id} onClick={() => read(item)} className={`notification-row ${item.readAt ? '' : 'unread'}`}>{content}</button>;
    })}</div> : <Empty>Chưa có thông báo nào.</Empty>}<Pagination pagination={pagination} loading={loading} onPageChange={setPage} label="thông báo" /></section>
  </>;
}
