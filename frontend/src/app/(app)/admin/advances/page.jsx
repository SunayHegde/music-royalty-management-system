'use client';

import RequireRole from '../../../../components/RequireRole';
import Advances from '../../../../screens/Advances';

export default function Page() {
  return <RequireRole roles={['ADMIN']}><Advances /></RequireRole>;
}
