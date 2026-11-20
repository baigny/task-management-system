import { describe, expect, it } from 'vitest';
import { registration, resetInput, changeInput } from '../src/auth/validation.js';

describe('registration validation', () => {
  const valid = { email: ' Developer@Example.com ', name: ' Developer ', password: 'strong-password-123', confirmPassword: 'strong-password-123' };
  it('normalizes identity fields without altering password characters', () => {
    expect(registration.parse(valid)).toMatchObject({ email: 'developer@example.com', name: 'Developer', password: valid.password });
  });
  it('requires matching confirmation and rejects protected or invalid fields', () => {
    expect(() => registration.parse({ ...valid, confirmPassword: 'different-password' })).toThrow('Passwords must match');
    expect(() => registration.parse({ ...valid, confirmPassword: undefined })).toThrow();
    expect(() => registration.parse({ ...valid, password: 'short', confirmPassword: 'short' })).toThrow();
    expect(() => registration.parse({ ...valid, role: 'admin' })).toThrow();
  });
  it('requires confirmation and a valid token/current password for password replacement', () => {
    const input = { password: 'replacement-password-123', confirmPassword: 'replacement-password-123' };
    expect(() => resetInput.parse({ ...input, token: 'a'.repeat(64) })).not.toThrow();
    expect(() => resetInput.parse({ ...input, token: 'invalid' })).toThrow();
    expect(() => resetInput.parse({ ...input, token: 'a'.repeat(64), confirmPassword: 'different-password' })).toThrow('Passwords must match');
    expect(() => changeInput.parse({ ...input, currentPassword: '' })).toThrow();
    expect(() => changeInput.parse({ ...input, currentPassword: 'old', confirmPassword: 'different-password' })).toThrow('Passwords must match');
  });
});
