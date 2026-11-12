'use client';

import { Suspense } from 'react';
import RequireRole from '../../../../components/RequireRole';
import Splits from '../../../../screens/Splits';

export default function Page() {
  return <RequireRole roles={['ADMIN']}><Suspense><Splits /></Suspense></RequireRole>;
}
