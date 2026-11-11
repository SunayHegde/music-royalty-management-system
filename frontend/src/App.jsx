import { Navigate, Route, Routes } from 'react-router-dom';
import { homeFor, useAuth } from './auth';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import Tracks from './pages/Tracks';
import Contributors from './pages/Contributors';
import Splits from './pages/Splits';
import Sampling from './pages/Sampling';
import Advances from './pages/Advances';
import Reports from './pages/Reports';
import Unmatched from './pages/Unmatched';
import Royalties from './pages/Royalties';
import FinanceDashboard from './pages/FinanceDashboard';
import PaymentHistory from './pages/PaymentHistory';
import ContributorDashboard from './pages/ContributorDashboard';
import Statement from './pages/Statement';

function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen"><Spinner label="Starting…" /></div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={homeFor(user.role)} replace /> : <Login />} />
      <Route element={<RequireRole><Layout /></RequireRole>}>
        <Route path="/admin" element={<RequireRole roles={['ADMIN']}><AdminDashboard /></RequireRole>} />
        <Route path="/admin/tracks" element={<RequireRole roles={['ADMIN']}><Tracks /></RequireRole>} />
        <Route path="/admin/contributors" element={<RequireRole roles={['ADMIN']}><Contributors /></RequireRole>} />
        <Route path="/admin/splits" element={<RequireRole roles={['ADMIN']}><Splits /></RequireRole>} />
        <Route path="/admin/sampling" element={<RequireRole roles={['ADMIN']}><Sampling /></RequireRole>} />
        <Route path="/admin/advances" element={<RequireRole roles={['ADMIN']}><Advances /></RequireRole>} />
        <Route path="/admin/reports" element={<RequireRole roles={['ADMIN']}><Reports /></RequireRole>} />
        <Route path="/admin/unmatched" element={<RequireRole roles={['ADMIN']}><Unmatched /></RequireRole>} />
        <Route path="/admin/royalties" element={<RequireRole roles={['ADMIN']}><Royalties /></RequireRole>} />
        <Route path="/finance" element={<RequireRole roles={['FINANCE']}><FinanceDashboard /></RequireRole>} />
        <Route path="/finance/payments" element={<RequireRole roles={['FINANCE']}><PaymentHistory /></RequireRole>} />
        <Route path="/me" element={<RequireRole roles={['CONTRIBUTOR']}><ContributorDashboard /></RequireRole>} />
        <Route path="/me/statement" element={<RequireRole roles={['CONTRIBUTOR']}><Statement own /></RequireRole>} />
        <Route path="/statements" element={<RequireRole roles={['ADMIN', 'FINANCE']}><Statement /></RequireRole>} />
      </Route>
      <Route path="*" element={<Navigate to={user ? homeFor(user.role) : '/login'} replace />} />
    </Routes>
  );
}
