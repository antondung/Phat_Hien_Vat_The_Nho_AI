import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Role, User } from '../types';
import { api } from '../services';
import { UNAUTHORIZED_EVENT } from '../services/http/config';

interface AuthCtx {
  user: User | null;
  token: string | null;
  loading: boolean;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  hasRole(...roles: Role[]): boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.auth.me().then((s) => {
      setUser(s?.user ?? null);
      setToken(s?.token ?? null);
      setLoading(false);
    });
  }, []);

  // Phiên hết hạn / token bị từ chối (REST 401 hoặc WebSocket) -> đăng xuất, Guards đưa về trang đăng nhập
  useEffect(() => {
    const onUnauth = () => {
      setUser(null);
      setToken(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauth);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauth);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const s = await api.auth.login(email, password);
    setUser(s.user);
    setToken(s.token);
    return s.user;
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout();
    setUser(null);
    setToken(null);
  }, []);

  const hasRole = useCallback((...roles: Role[]) => !!user && roles.includes(user.role), [user]);

  return <Ctx.Provider value={{ user, token, loading, login, logout, hasRole }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth ngoài AuthProvider');
  return c;
}
