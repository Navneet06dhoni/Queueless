let lastOutageToastTime = 0;

export function notifyQueueOutageThrottled(toast: { error: (msg: string) => void }): boolean {
  const now = Date.now();
  if (now - lastOutageToastTime >= 60000) {
    lastOutageToastTime = now;
    toast.error('The queue service is temporarily unavailable, retrying');
    return true;
  }
  return false;
}

export function resetQueueOutageToastThrottleForTesting(): void {
  lastOutageToastTime = 0;
}
