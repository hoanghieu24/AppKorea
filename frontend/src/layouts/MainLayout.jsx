import { useState } from 'react';
import Sidebar from '../components/Sidebar';
import Topbar from '../components/Topbar';

export default function MainLayout({ title, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="main-content">
        <Topbar title={title} onMenuClick={() => setSidebarOpen((o) => !o)} />
        <div style={{ padding: '24px 28px', flex: 1 }}>{children}</div>
      </main>
    </>
  );
}
