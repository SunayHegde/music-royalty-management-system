'use client';

import RequireRole from '../../../../components/RequireRole';
import Unmatched from '../../../../screens/Unmatched';

export default function Page() {
  return <RequireRole roles={['ADMIN']}><Unmatched /></RequireRole>;
}
