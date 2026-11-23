import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireRole, HomeRedirect } from './components/layout/Guards';
import { AppLayout } from './components/layout/AppLayout';
import LoginPage from './pages/LoginPage';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DetectionPage = lazy(() => import('./pages/DetectionPage'));
const LiveSinglePage = lazy(() => import('./pages/LiveSinglePage'));
const LiveGridPage = lazy(() => import('./pages/LiveGridPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const ModelsPage = lazy(() => import('./pages/ModelsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const PhonePushPage = lazy(() => import('./pages/PhonePushPage'));

function PageLoading() {
  return (
    <div className="page-loading">
      <span className="spinner" /> Đang tải…
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/dang-nhap" element={<LoginPage />} />
        <Route path="/dt" element={<PhonePushPage />} />
        <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="/phan-tich" element={<DetectionPage />} />
          <Route path="/giam-sat" element={<Navigate to="/giam-sat/he-thong" replace />} />
          <Route path="/giam-sat/camera/:id?" element={<LiveSinglePage />} />
          <Route path="/giam-sat/he-thong" element={<LiveGridPage />} />
          <Route path="/lich-su" element={<HistoryPage />} />
          <Route element={<RequireRole roles={['admin']} />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/mo-hinh" element={<ModelsPage />} />
            <Route path="/cai-dat" element={<Navigate to="/cai-dat/quy-tac" replace />} />
            <Route path="/cai-dat/:tab" element={<SettingsPage />} />
          </Route>
        </Route>
        </Route>
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </Suspense>
  );
}
