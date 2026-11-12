'use client';

import RequireRole from '../../../../components/RequireRole';
import Royalties from '../../../../screens/Royalties';

export default function Page() {
  return <RequireRole roles={['ADMIN']}><Royalties /></RequireRole>;
}
