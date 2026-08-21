import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  LayoutDashboard,
  Megaphone,
  MonitorPlay,
  Users,
  LogOut,
  Menu,
  X,
  Settings,
  Search,
  Clock,
  Image,
  User,
  Shield,
  ServerCog,
  Tag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: '/', label: 'דשבורד', icon: LayoutDashboard },
  { path: '/campaigns', label: 'פרויקטים', icon: Megaphone },
  { path: '/assets', label: 'נכסים', icon: Image },

  { path: '/channels', label: 'פורמטים', icon: MonitorPlay, adminOnly: true },
  { path: '/tags', label: 'ניהול תגיות', icon: Tag, adminOnly: true },
  { path: '/users', label: 'משתמשים', icon: Users, adminOnly: true },
  { path: '/settings', label: 'הגדרות', icon: Settings, adminOnly: true },
  { path: '/settings/profile', label: 'הפרופיל שלי', icon: User },
];

export default function AppLayout({ children }: AppLayoutProps) {
  const { user, profile, isAdmin, signOut } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOpen) {
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen]);
  const visibleNav = navItems.filter((n) => !n.adminOnly || isAdmin);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-40 w-64 bg-card border-e border-border flex flex-col transition-transform lg:translate-x-0 lg:static',
          mobileOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        )}
      >
        <div className="py-6 flex flex-col items-center justify-center border-b border-border px-6 relative bg-card">
          <Link to="/" className="flex flex-col items-center gap-2.5 group text-center">
            <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-md group-hover:scale-105 transition-transform duration-200">
              <img src="/logo.png" alt="Budget Lens" className="w-full h-full object-cover" />
            </div>
            <div className="flex flex-col items-center">
              <span className="font-extrabold text-xl tracking-tight text-[#3C71C5]">Budget Lens</span>
              <span className="text-[11px] text-muted-foreground font-medium mt-0.5">ניהול תקציב חכם</span>
            </div>
          </Link>
          <button className="lg:hidden absolute top-4 end-4 text-muted-foreground hover:text-foreground" onClick={() => setMobileOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {(() => {
            const activeItem = [...visibleNav]
              .sort((a, b) => b.path.length - a.path.length)
              .find(item =>
                location.pathname === item.path ||
                (item.path !== '/' && location.pathname.startsWith(item.path))
              );

            return visibleNav.map((item) => {
              const active = activeItem?.path === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-accent'
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </Link>
              );
            });
          })()}
        </nav>


        {/* User */}
        <div className="p-3 border-t border-border">
          {user ? (
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-primary text-sm font-bold">
                  {profile?.full_name?.[0] || profile?.email?.[0] || '?'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{profile?.full_name || profile?.email}</p>
                <p className="text-xs text-muted-foreground">{isAdmin ? 'מנהל' : 'משתמש'}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={signOut} title="התנתק">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="px-3 py-2">
              <Link to="/login">
                <Button className="w-full" size="sm">
                  התחברות
                </Button>
              </Link>
            </div>
          )}
        </div>
      </aside>

      {/* Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-foreground/20 z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
      <main className="flex-1 min-w-0 pb-20 lg:pb-0">
        {/* Floating hamburger for mobile */}
        {!mobileOpen && (
          <button
            className="lg:hidden fixed top-3 start-3 z-50 bg-card border border-border rounded-full w-10 h-10 flex items-center justify-center shadow-md"
            onClick={() => setMobileOpen(true)}
            aria-label="פתיחת תפריט"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <div className="p-4 lg:p-6 animate-fade-in">
          {children}
        </div>
      </main>

      {/* Bottom Tabs — Mobile only */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-card border-t border-border flex items-stretch justify-around shadow-[0_-2px_8px_rgba(0,0,0,0.04)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="ניווט ראשי"
      >
        {(() => {
          const bottomTabs = [
            { path: '/', label: 'בית', icon: LayoutDashboard },
            { path: '/campaigns', label: 'פרויקטים', icon: Megaphone },
            { path: '/assets', label: 'נכסים', icon: Image },

            { path: '/settings/profile', label: 'פרופיל', icon: User },
          ];
          const activeTab = [...bottomTabs]
            .sort((a, b) => b.path.length - a.path.length)
            .find(t =>
              location.pathname === t.path ||
              (t.path !== '/' && location.pathname.startsWith(t.path))
            );
          return bottomTabs.map((tab) => {
            const active = activeTab?.path === tab.path;
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] text-[11px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
                aria-label={tab.label}
                aria-current={active ? 'page' : undefined}
              >
                <tab.icon className={cn('w-5 h-5', active && 'stroke-[2.5]')} />
                <span>{tab.label}</span>
              </Link>
            );
          });
        })()}
      </nav>
    </div>
  );
}
