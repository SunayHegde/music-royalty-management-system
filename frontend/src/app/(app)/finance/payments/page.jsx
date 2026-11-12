'use client';

import RequireRole from '../../../../components/RequireRole';
import PaymentHistory from '../../../../screens/PaymentHistory';

export default function Page() {
  return <RequireRole roles={['FINANCE']}><PaymentHistory /></RequireRole>;
}
