'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useAuth } from '../../auth';
import { Spinner } from '../../components/ui';
import Login from '../../screens/Login';

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // already signed in -> straight to the role's home page
  useEffect(() => {
    if (!loading && user) router.replace(homeFor(user.role));
  }, [loading, user, router]);

  if (loading || user) return <div className="center-screen"><Spinner label="Starting…" /></div>;
  return <Login />;
}
