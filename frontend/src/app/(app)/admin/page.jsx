'use client';

import RequireRole from '../../../components/RequireRole';
import AdminDashboard from '../../../screens/AdminDashboard';

export default function Page() {
  return <RequireRole roles={['ADMIN']}><AdminDashboard /></RequireRole>;
}
