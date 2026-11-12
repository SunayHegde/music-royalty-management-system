'use client';

import RequireRole from '../../../components/RequireRole';
import ContributorDashboard from '../../../screens/ContributorDashboard';

export default function Page() {
  return <RequireRole roles={['CONTRIBUTOR']}><ContributorDashboard /></RequireRole>;
}
