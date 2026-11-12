'use client';

import RequireRole from '../../../../components/RequireRole';
import Sampling from '../../../../screens/Sampling';

export default function Page() {
  return <RequireRole roles={['ADMIN']}><Sampling /></RequireRole>;
}
