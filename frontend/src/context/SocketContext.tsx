import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getAccessToken } from '../api/client';
import { useAuth } from './AuthContext';

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
});

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!user || !token) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setIsConnected(false);
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
    });

    s.on('connect', () => {
      setIsConnected(true);
    });

    s.on('disconnect', () => {
      setIsConnected(false);
    });

    s.on('connect_error', (err) => {
      console.warn('[Socket] Connection error:', err.message);
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
        socket.connect();
      }
    }
  }, [socket]);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = (): SocketContextValue => useContext(SocketContext);
