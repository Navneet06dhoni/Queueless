import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useQueueSocket } from '../hooks/useQueueSocket';
import * as SocketContextModule from '../context/SocketContext';

describe('useQueueSocket hook', () => {
  let queryClient: QueryClient;
  let mockSocket: any;
  let socketState: { isConnected: boolean; status: 'connected' | 'reconnecting' | 'offline' };

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const handlers: Record<string, ((...args: any[]) => void)[]> = {};
    mockSocket = {
      connected: true,
      on: vi.fn((event: string, fn: any) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(fn);
      }),
      off: vi.fn((event: string, fn: any) => {
        if (handlers[event]) {
          handlers[event] = handlers[event].filter((h) => h !== fn);
        }
      }),
      emit: vi.fn((_event: string, _data: any, ack?: any) => {
        if (ack) ack({});
      }),
      trigger: (event: string, ...args: any[]) => {
        const fns = handlers[event] || [];
        fns.forEach((fn) => fn(...args));
      },
    };

    socketState = { isConnected: true, status: 'connected' };

    vi.spyOn(SocketContextModule, 'useSocket').mockImplementation(() => ({
      socket: mockSocket,
      isConnected: socketState.isConnected,
      status: socketState.status,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('subscribes with queue:watch on mount, polls every 15s when disconnected, and re-subscribes + refetches on reconnect', async () => {
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries');

    const { rerender } = renderHook(
      () => useQueueSocket('biz-1', { owner: false }),
      { wrapper }
    );

    // Initial subscription
    expect(mockSocket.emit).toHaveBeenCalledWith('queue:watch', { businessId: 'biz-1' }, expect.any(Function));

    // 1. Simulate disconnect -> status becomes 'offline'
    socketState.status = 'offline';
    socketState.isConnected = false;
    mockSocket.connected = false;
    rerender();

    // Advance 15 seconds -> fallback polling triggers
    act(() => {
      vi.advanceTimersByTime(15000);
    });

    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['queue', 'status', 'biz-1'] });
    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['queue', 'me'] });
    const callCountAfterFirstPoll = refetchSpy.mock.calls.length;

    // Advance another 15 seconds -> another poll
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    expect(refetchSpy.mock.calls.length).toBeGreaterThan(callCountAfterFirstPoll);

    // 2. Simulate reconnect
    socketState.status = 'connected';
    socketState.isConnected = true;
    mockSocket.connected = true;
    rerender();

    // Trigger socket connect event
    act(() => {
      mockSocket.trigger('connect');
    });

    // Re-subscribes with queue:watch
    expect(mockSocket.emit).toHaveBeenCalledWith('queue:watch', { businessId: 'biz-1' }, expect.any(Function));
    // Refetches once on reconnect
    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['queue', 'status', 'biz-1'] });

    const callCountAfterReconnect = refetchSpy.mock.calls.length;

    // 3. While connected, polling is stopped: advance 30 seconds -> no new interval polls
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(refetchSpy.mock.calls.length).toBe(callCountAfterReconnect);
  });
});
