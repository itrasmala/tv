import { useEffect, useState, type ReactNode } from 'react';
import { isConfigured, displayUrl } from '../shared/env';
import { ROLE_LABEL } from '../shared/labels';
import { AuthProvider, useAuth } from './auth';
import { navigate, useRoute } from './router';
import { ConfirmProvider, Spinner, ToastProvider } from './ui';
import { LastUpdate } from './components/LastUpdate';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Schedule } from './pages/Schedule';
import { Templates } from './pages/Templates';
import { Videos } from './pages/Videos';
import { Settings } from './pages/Settings';
import { Users } from './pages/Users';
import { Audit } from './pages/Audit';
import { Account } from './pages/Account';

export function App() {
  if (!isConfigured) return <SetupNotice />;
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

interface NavItem { path: string; label: string; icon: string; show: boolean; }

function Shell() {
  const auth = useAuth();
  const route = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navTick, setNavTick] = useState(0);
  useEffect(() => { setMenuOpen(false); setNavTick((t) => t + 1); }, [route]);

  if (auth.loading) return <div className="center-screen"><Spinner label="جارٍ التحميل…" /></div>;
  if (!auth.session || !auth.profile) return <Login profileError={auth.session ? auth.profileError : null} />;

  const nav: NavItem[] = [
    { path: '/', label: 'الرئيسية', icon: '⌂', show: true },
    { path: '/schedule', label: 'جدول المهام', icon: '☰', show: true },
    { path: '/templates', label: 'القوالب', icon: '❐', show: true },
    { path: '/videos', label: 'الفيديوهات', icon: '▶', show: true },
    { path: '/settings', label: 'إعدادات الشاشة', icon: '⚙', show: true },
    { path: '/users', label: 'المستخدمون', icon: '👥', show: auth.isAdmin },
    { path: '/audit', label: 'سجل التدقيق', icon: '🧾', show: auth.isAdmin },
    { path: '/account', label: 'حسابي', icon: '👤', show: true },
  ];

  let page: ReactNode;
  switch (route.path) {
    case '/schedule': page = <Schedule date={route.query.get('date') || undefined} />; break;
    case '/templates': page = <Templates />; break;
    case '/videos': page = <Videos />; break;
    case '/settings': page = <Settings />; break;
    case '/users': page = auth.isAdmin ? <Users /> : <Forbidden />; break;
    case '/audit': page = auth.isAdmin ? <Audit /> : <Forbidden />; break;
    case '/account': page = <Account />; break;
    default: page = <Dashboard />;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <button className="icon-btn menu-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="القائمة">☰</button>
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <div className="brand-title">لوحة إدارة الشاشة</div>
            <div className="brand-sub"><LastUpdate compact refreshKey={navTick} /></div>
          </div>
        </div>
        <div className="topbar-actions">
          <a className="btn btn-ghost hide-sm" href={displayUrl()} target="_blank" rel="noopener">فتح شاشة العرض ↗</a>
          <div className="user-chip">
            <b>{auth.profile.full_name || auth.profile.email}</b>
            <span>{ROLE_LABEL[auth.profile.role]}</span>
          </div>
          <button className="btn btn-ghost" onClick={() => auth.signOut()}>خروج</button>
        </div>
      </header>
      <div className="body">
        <nav className={'sidenav' + (menuOpen ? ' open' : '')}>
          {nav.filter((n) => n.show).map((n) => (
            <a
              key={n.path}
              href={'#' + n.path}
              className={route.path === n.path || (n.path === '/' && !nav.some((x) => x.path === route.path)) ? 'active' : ''}
            >
              <span className="nav-ic" aria-hidden>{n.icon}</span>{n.label}
            </a>
          ))}
        </nav>
        {menuOpen && <div className="nav-back" onClick={() => setMenuOpen(false)} />}
        <main className="content">{page}</main>
      </div>
    </div>
  );
}

function Forbidden() {
  return (
    <div className="card">
      <h2>غير مصرح</h2>
      <p className="muted">هذه الصفحة متاحة للمدير العام فقط.</p>
      <button className="btn btn-primary" onClick={() => navigate('/')}>العودة للرئيسية</button>
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="center-screen">
      <div className="card setup">
        <h2>لم يتم ربط قاعدة البيانات بعد</h2>
        <p>لتشغيل لوحة الإدارة أضف المتغيرين التاليين ثم أعد البناء والنشر:</p>
        <pre dir="ltr">VITE_SUPABASE_URL{'\n'}VITE_SUPABASE_ANON_KEY</pre>
        <p className="muted">على GitHub: Settings ← Secrets and variables ← Actions ← Variables. التفاصيل في ملف README.</p>
      </div>
    </div>
  );
}
