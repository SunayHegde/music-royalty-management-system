'use client';

import RequireRole from '../../../../components/RequireRole';
import Reports from '../../../../screens/Reports';

export default function Page() {
  return <RequireRole roles={['ADMIN']}><Reports /></RequireRole>;
}
