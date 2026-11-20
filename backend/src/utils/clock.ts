import { Settings } from 'luxon';

const envFake = process.env.CLOCK_FAKED_TIME ? new Date(process.env.CLOCK_FAKED_TIME) : null;
let mockTime: Date | null = envFake ? new Date(envFake.getTime()) : null;

// Synchronize Luxon's DateTime.now() with our mock clock
Settings.now = () => (mockTime ? mockTime.getTime() : Date.now());

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
      mockTime = envFake ? new Date(envFake.getTime()) : null;
    } else {
      mockTime = new Date(date);
    }
  },
  resetNow() {
    mockTime = envFake ? new Date(envFake.getTime()) : null;
  },
};

export const now = (): Date => clock.now();
