let mockTime: Date | null = null;

export const clock = {
  now(): Date {
    if (mockTime) {
      const current = new Date(mockTime.getTime());
      mockTime = new Date(mockTime.getTime() + 1); // Auto-advance 1ms to simulate time progression
      return current;
    }
    return new Date();
  },
  setNow(date: Date | string | number | null) {
    if (date === null) {
      mockTime = null;
    } else {
      mockTime = new Date(date);
    }
  },
  resetNow() {
    mockTime = null;
  },
};

export const now = (): Date => clock.now();
