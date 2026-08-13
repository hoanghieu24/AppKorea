export default function Loader({ label = 'Đang tải...' }) {
  return (
    <div className="ldial-loading" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '40px 20px' }}>
      <div className="typing-dots">
        <div className="typing-dot"></div>
        <div className="typing-dot"></div>
        <div className="typing-dot"></div>
      </div>
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{label}</span>
    </div>
  );
}
