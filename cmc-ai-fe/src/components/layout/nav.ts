import { BarChart3, Boxes, Cctv, History, LayoutDashboard, ScanSearch, Settings, type LucideIcon } from 'lucide-react';
import type { Role } from '../../types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  children?: { to: string; label: string }[];
  match?: string;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Tổng quan',
    items: [{ to: '/dashboard', label: 'Bảng điều khiển', icon: LayoutDashboard, roles: ['admin'] }],
  },
  {
    group: 'Giám sát',
    items: [
      { to: '/phan-tich', label: 'Phân tích', icon: ScanSearch, roles: ['admin', 'giam_thi'] },
      {
        to: '/giam-sat/he-thong',
        match: '/giam-sat',
        label: 'Giám sát',
        icon: Cctv,
        roles: ['admin', 'giam_thi'],
        children: [
          { to: '/giam-sat/camera', label: 'Camera đơn' },
          { to: '/giam-sat/he-thong', label: 'Hệ thống camera' },
        ],
      },
      { to: '/lich-su', label: 'Lịch sử', icon: History, roles: ['admin', 'giam_thi'] },
    ],
  },
  {
    group: 'Hệ thống',
    items: [
      { to: '/mo-hinh', label: 'Mô hình', icon: Boxes, roles: ['admin'] },
      { to: '/cai-dat/quy-tac', match: '/cai-dat', label: 'Cài đặt', icon: Settings, roles: ['admin'] },
    ],
  },
];

export const PAGE_TITLES: [string, string, string][] = [
  ['/dashboard', 'Bảng điều khiển', 'Tổng quan hệ thống giám sát'],
  ['/phan-tich', 'Phân tích', 'Tải ảnh/video lên để mô hình phát hiện hành vi nghi vấn'],
  ['/giam-sat/camera', 'Camera đơn', 'Giám sát trực tiếp một camera'],
  ['/giam-sat/he-thong', 'Hệ thống camera', 'Toàn bộ camera trong các phòng thi'],
  ['/lich-su', 'Lịch sử cảnh báo', 'Tra cứu và xử lý các cảnh báo nghi vấn'],
  ['/mo-hinh', 'Mô hình', 'Thông tin mô hình YOLO & YOLO Pose'],
  ['/cai-dat', 'Cài đặt', 'Quy tắc, camera và người dùng'],
];

export { BarChart3 };
