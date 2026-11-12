'use client';

import { Suspense } from 'react';
import RequireRole from '../../../../components/RequireRole';
import Statement from '../../../../screens/Statement';

export default function Page() {
  return <RequireRole roles={['CONTRIBUTOR']}><Suspense><Statement own /></Suspense></RequireRole>;
}
