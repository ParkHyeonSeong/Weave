import { useRouter } from 'next/router';
import { ArrowLeft, Users, Blocks } from 'lucide-react';

export default function AdminSidebar() {
  const router = useRouter();

  return (
    <aside className="AdminSidebar">
      <div className="AdminSidebar__Inner">
        <div className="AdminSidebar__Header">
          <button className="AdminSidebar__BackBtn" onClick={() => router.push('/')}>
            <ArrowLeft size={16} />
          </button>
          <span className="AdminSidebar__Title">Admin Settings</span>
        </div>

        <nav className="AdminSidebar__Menu">
          <button
            className={`AdminSidebar__MenuItem ${router.pathname === '/admin' ? 'AdminSidebar__MenuItem--active' : ''}`}
            onClick={() => router.push('/admin')}
          >
            <Users size={16} className="AdminSidebar__MenuIcon" />
            Members
          </button>
          <button
            className={`AdminSidebar__MenuItem ${router.pathname === '/admin/integrations' ? 'AdminSidebar__MenuItem--active' : ''}`}
            onClick={() => router.push('/admin/integrations')}
          >
            <Blocks size={16} className="AdminSidebar__MenuIcon" />
            Integrations
          </button>
        </nav>
      </div>
    </aside>
  );
}
