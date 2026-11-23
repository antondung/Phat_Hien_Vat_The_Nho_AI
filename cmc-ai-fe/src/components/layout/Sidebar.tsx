import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Brand } from '../ui/Logo';
import { NAV } from './nav';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABEL } from '../../lib/labels';
import { useLocalState } from '../../hooks/useLocalState';

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const parts = name.trim().split(/\s+/);
  const initials = (parts.length > 1 ? parts[parts.length - 2][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </span>
  );
}

export function Sidebar({ open, onNavigate, onLogout }: { open: boolean; onNavigate(): void; onLogout(): void }) {
  const { user } = useAuth();
  const loc = useLocation();
  const [subOpen, setSubOpen] = useState(true);
  const [railExpanded, setRailExpanded] = useLocalState('sidebar.expanded', false);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1200);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1199px)');
    const fn = () => setNarrow(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  if (!user) return null;
  const rail = narrow && !railExpanded;
  return (
    <aside className={`sidebar ${open ? 'open' : ''} ${rail ? 'is-rail' : ''} ${narrow && railExpanded ? 'is-expanded' : ''}`}>
      <div className="sidebar-brand">
        <Brand compact={rail} />
      </div>
      <nav className="sidebar-nav" aria-label="Điều hướng chính">
        {NAV.map((g) => {
          const items = g.items.filter((i) => i.roles.includes(user.role));
          if (!items.length) return null;
          return (
            <div key={g.group} className="nav-group">
              <div className="nav-group-title">{g.group}</div>
              {items.map((it) => {
                const Icon = it.icon;
                const active = loc.pathname.startsWith(it.match ?? it.to);
                if (it.children) {
                  return (
                    <div key={it.to} className="nav-fly">
                      <button
                        className={`nav-item ${active ? 'active' : ''}`}
                        onClick={() => setSubOpen((v) => !v)}
                        aria-expanded={subOpen}
                        title={it.label}
                        aria-label={it.label}
                      >
                        <Icon size={18} />
                        <span>{it.label}</span>
                        <ChevronDown size={14} className={`chev ${subOpen ? 'up' : ''}`} />
                      </button>
                      <div className={`nav-sub ${subOpen ? 'is-open' : ''}`}>
                        {it.children.map((c) => (
                          <NavLink
                            key={c.to}
                            to={c.to}
                            onClick={onNavigate}
                            title={c.label}
                            className={() => (loc.pathname.startsWith(c.to) ? 'nav-subitem active' : 'nav-subitem')}
                          >
                            <i />
                            {c.label}
                          </NavLink>
                        ))}
                      </div>
                    </div>
                  );
                }
                return (
                  <NavLink key={it.to} to={it.to} onClick={onNavigate} title={it.label} className={() => `nav-item ${active ? 'active' : ''}`}>
                    <Icon size={18} />
                    <span>{it.label}</span>
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <div className="user-card" title={`${user.name} · ${ROLE_LABEL[user.role]}`}>
          <Avatar name={user.name} size={rail ? 28 : 32} />
          <div className="user-meta">
            <strong>{user.name}</strong>
            <span>{ROLE_LABEL[user.role]}</span>
          </div>
        </div>
        <button className="nav-item logout" onClick={onLogout} title="Đăng xuất" aria-label="Đăng xuất">
          <LogOut size={16} />
          <span>Đăng xuất</span>
        </button>
        {narrow && (
          <button
            className="nav-item sidebar-expand-btn"
            onClick={() => setRailExpanded(!railExpanded)}
            title={railExpanded ? 'Thu menu còn icon' : 'Mở rộng menu có chữ'}
            aria-label={railExpanded ? 'Thu menu còn icon' : 'Mở rộng menu có chữ'}
          >
            {railExpanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            <span>{railExpanded ? 'Thu gọn' : 'Mở rộng'}</span>
          </button>
        )}
      </div>
    </aside>
  );
}
