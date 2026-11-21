import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getAccessToken } from '../api/client';
import { useAuth } from './AuthContext';

export type SocketConnectionStatus = 'connected' | 'reconnecting' | 'offline';

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  status: SocketConnectionStatus;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
  status: 'offline',
});

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<SocketConnectionStatus>('offline');

  useEffect(() => {
    const token = getAccessToken();
    if (!user || !token) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setStatus('offline');
      }
      return;
    }

    // Single shared socket
    const s = io({
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    s.on('connect', () => {
      setStatus('connected');
    });

    s.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') {
        setStatus('offline');
      } else {
        setStatus('reconnecting');
      }
    });

    s.on('connect_error', () => {
      setStatus('reconnecting');
    });

    s.io.on('reconnect_attempt', () => {
      setStatus('reconnecting');
    });

    s.io.on('reconnect_failed', () => {
      setStatus('offline');
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
    // Re-initialize if user ID changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // If token changes while user remains the same (e.g. token refresh)
  useEffect(() => {
    const token = getAccessToken();
    if (socket && token) {
      socket.auth = { token };
      if (!socket.connected) {
        setStatus('reconnecting');
        socket.connect();
      }
    }
  }, [socket]);

  return (
    <SocketContext.Provider value={{ socket, isConnected: status === 'connected', status }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = (): SocketContextValue => useContext(SocketContext);
