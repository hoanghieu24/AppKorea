export default function EmptyState({ icon = '📭', title, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" style={{ fontSize: '2.6rem' }}>{icon}</div>
      <p>{title}</p>
      {action}
    </div>
  );
}
