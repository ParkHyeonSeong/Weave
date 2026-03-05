import Header from '@/components/Layout/Header';
import AdminSidebar from './AdminSidebar';

export default function AdminLayout({ children }) {
  return (
    <div className="Layout">
      <Header />
      <div className="Layout__Body">
        <AdminSidebar />
        <main className="Layout__Content">
          {children}
        </main>
      </div>
    </div>
  );
}
