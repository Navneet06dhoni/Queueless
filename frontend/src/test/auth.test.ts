import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerSchema } from '../pages/RegisterPage';
import { setAccessToken, getAccessToken } from '../api/client';

describe('Auth Security & Register Validation', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(Storage.prototype, 'setItem');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the access token is never written to localStorage or sessionStorage', () => {
    const fakeToken = 'header.payload.signature-test-token';
    setAccessToken(fakeToken);

    expect(getAccessToken()).toBe(fakeToken);

    // Verify localStorage & sessionStorage were never called with the token
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('accessToken')).toBeNull();

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      expect(localStorage.getItem(key)).not.toContain(fakeToken);
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)!;
      expect(sessionStorage.getItem(key)).not.toContain(fakeToken);
    }
  });

  describe('Register form validation rules', () => {
    it('accepts valid customer registration input', () => {
      const result = registerSchema.safeParse({
        name: 'Aarav Sharma',
        email: 'aarav@example.com',
        password: 'Password123',
        role: 'customer',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid owner registration input', () => {
      const result = registerSchema.safeParse({
        name: 'Dr. Sunita Rao',
        email: 'sunita@clinic.in',
        password: 'SecurePass2026',
        role: 'owner',
      });
      expect(result.success).toBe(true);
    });

    it('rejects names shorter than 2 characters', () => {
      const result = registerSchema.safeParse({
        name: 'A',
        email: 'a@example.com',
        password: 'Password123',
        role: 'customer',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('at least 2 characters');
      }
    });

    it('rejects invalid email formats', () => {
      const result = registerSchema.safeParse({
        name: 'Valid Name',
        email: 'not-an-email',
        password: 'Password123',
        role: 'customer',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('valid email');
      }
    });

    it('rejects weak passwords (< 8 characters or only letters or only numbers)', () => {
      // < 8 characters
      const shortPass = registerSchema.safeParse({
        name: 'Valid Name',
        email: 'valid@example.com',
        password: 'Pass1',
        role: 'customer',
      });
      expect(shortPass.success).toBe(false);

      // Only letters
      const onlyLetters = registerSchema.safeParse({
        name: 'Valid Name',
        email: 'valid@example.com',
        password: 'OnlyLettersPass',
        role: 'customer',
      });
      expect(onlyLetters.success).toBe(false);

      // Only numbers
      const onlyNumbers = registerSchema.safeParse({
        name: 'Valid Name',
        email: 'valid@example.com',
        password: '1234567890',
        role: 'customer',
      });
      expect(onlyNumbers.success).toBe(false);
    });

    it('rejects admin role on registration (only customer or owner allowed)', () => {
      const result = registerSchema.safeParse({
        name: 'Hacker Admin',
        email: 'hacker@test.com',
        password: 'Password123',
        role: 'admin' as any,
      });
      expect(result.success).toBe(false);
    });
  });
});
