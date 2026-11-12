'use client';

import RequireRole from '../../../../components/RequireRole';
import Tracks from '../../../../screens/Tracks';

export default function Page() {
  return <RequireRole roles={['ADMIN']}><Tracks /></RequireRole>;
}
