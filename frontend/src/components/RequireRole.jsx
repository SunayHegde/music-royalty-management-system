'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useAuth } from '../auth';
import { Spinner } from './ui';

/** Shows the page only to signed-in users with one of `roles`; everyone else is sent to their home page. */
export default function RequireRole({ roles, children }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const roleKey = roles?.join(',');
  const allowed = user && (!roles || roles.includes(user.role));

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (roleKey && !roleKey.split(',').includes(user.role)) router.replace(homeFor(user.role));
  }, [loading, user, roleKey, router]);

  if (loading || !allowed) return <div className="center-screen"><Spinner label="Starting…" /></div>;
  return children;
}
