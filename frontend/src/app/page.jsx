'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useAuth } from '../auth';
import { Spinner } from '../components/ui';

/** "/" sends users to their role's home page, or to the login page. */
export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) router.replace(user ? homeFor(user.role) : '/login');
  }, [loading, user, router]);

  return <div className="center-screen"><Spinner label="Starting…" /></div>;
}
