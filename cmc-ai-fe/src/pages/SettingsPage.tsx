import { NavLink, Navigate, useParams } from 'react-router-dom';
import { Cctv, SlidersHorizontal, Users } from 'lucide-react';
import { RulesTab } from './settings/RulesTab';
import { CamerasTab } from './settings/CamerasTab';
import { UsersTab } from './settings/UsersTab';

const TABS = [
  { k: 'quy-tac', label: 'Cấu hình quy tắc', icon: SlidersHorizontal },
  { k: 'camera', label: 'Quản lý camera', icon: Cctv },
  { k: 'nguoi-dung', label: 'Quản lý người dùng', icon: Users },
];

export default function SettingsPage() {
  const { tab } = useParams();
  if (!TABS.some((t) => t.k === tab)) return <Navigate to="/cai-dat/quy-tac" replace />;
  return (
    <div className="page">
      <div className="tabs page-tabs">
        {TABS.map((t) => (
          <NavLink key={t.k} to={`/cai-dat/${t.k}`} className={({ isActive }) => (isActive ? 'active' : '')}>
            <t.icon size={16} /> {t.label}
          </NavLink>
        ))}
      </div>
      {tab === 'quy-tac' && <RulesTab />}
      {tab === 'camera' && <CamerasTab />}
      {tab === 'nguoi-dung' && <UsersTab />}
    </div>
  );
}
