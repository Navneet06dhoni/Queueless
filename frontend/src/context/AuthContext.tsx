import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, LoginInput, RegisterInput } from '../api/types';
import { authApi } from '../api';
import { setAccessToken, setLogoutHandler } from '../api/client';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isBlocked: boolean;
  blockedReason: string | null;
  login: (data: LoginInput) => Promise<User>;
  register: (data: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  const handleLogout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore error on logout
    } finally {
      setAccessToken(null);
      setUser(null);
      setIsBlocked(false);
      setBlockedReason(null);
    }
  }, []);

  useEffect(() => {
    // Register interceptor callback for failed refresh token
    setLogoutHandler(() => {
      setAccessToken(null);
      setUser(null);
      setIsBlocked(false);
      setBlockedReason(null);
    });

    // Silent session restore on app load
    let isMounted = true;
    authApi
      .refresh()
      .then((res) => {
        if (!isMounted) return;
        setAccessToken(res.accessToken);
        setUser(res.user);
        if (res.user.is_blocked) {
          setIsBlocked(true);
          setBlockedReason(res.user.blocked_reason || 'Account has been suspended.');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setAccessToken(null);
        setUser(null);
        if (err.response?.status === 403 && err.response?.data?.error?.code === 'USER_BLOCKED') {
          setIsBlocked(true);
          setBlockedReason(err.response?.data?.error?.message || 'Your account is suspended.');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const login = async (data: LoginInput): Promise<User> => {
    try {
      const res = await authApi.login(data);
      setAccessToken(res.accessToken);
      setUser(res.user);
      if (res.user.is_blocked) {
        setIsBlocked(true);
        setBlockedReason(res.user.blocked_reason || 'Account has been suspended.');
      } else {
        setIsBlocked(false);
        setBlockedReason(null);
      }
      return res.user;
    } catch (err: any) {
      if (err.response?.status === 403 && err.response?.data?.error?.code === 'USER_BLOCKED') {
        setIsBlocked(true);
        setBlockedReason(err.response?.data?.error?.message || 'Your account has been suspended.');
      }
      throw err;
    }
  };

  const register = async (data: RegisterInput): Promise<User> => {
    const res = await authApi.register(data);
    setAccessToken(res.accessToken);
    setUser(res.user);
    setIsBlocked(false);
    setBlockedReason(null);
    return res.user;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isBlocked,
        blockedReason,
        login,
        register,
        logout: handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
