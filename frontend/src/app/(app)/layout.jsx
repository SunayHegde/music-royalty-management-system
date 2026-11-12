'use client';

import Layout from '../../components/Layout';
import RequireRole from '../../components/RequireRole';

/** Every signed-in page shares the sidebar layout. */
export default function AppLayout({ children }) {
  return (
    <RequireRole>
      <Layout>{children}</Layout>
    </RequireRole>
  );
}
