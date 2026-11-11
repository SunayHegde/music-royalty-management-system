import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { get, post, getToken, setToken } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    get('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('mrms:logout', onLogout);
    return () => window.removeEventListener('mrms:logout', onLogout);
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await post('/auth/login', { username, password });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => { setToken(null); setUser(null); }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export const homeFor = (role) => ({ ADMIN: '/admin', FINANCE: '/finance', CONTRIBUTOR: '/me' }[role] || '/login');
