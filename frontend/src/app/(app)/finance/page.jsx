'use client';

import RequireRole from '../../../components/RequireRole';
import FinanceDashboard from '../../../screens/FinanceDashboard';

export default function Page() {
  return <RequireRole roles={['FINANCE']}><FinanceDashboard /></RequireRole>;
}
