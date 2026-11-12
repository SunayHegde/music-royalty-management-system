'use client';

import { Suspense } from 'react';
import RequireRole from '../../../components/RequireRole';
import Statement from '../../../screens/Statement';

export default function Page() {
  return <RequireRole roles={['ADMIN', 'FINANCE']}><Suspense><Statement /></Suspense></RequireRole>;
}
