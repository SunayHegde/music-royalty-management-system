'use client';

import RequireRole from '../../../../components/RequireRole';
import Contributors from '../../../../screens/Contributors';

export default function Page() {
  return <RequireRole roles={['ADMIN']}><Contributors /></RequireRole>;
}
