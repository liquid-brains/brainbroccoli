import { describe, expect, it } from 'vitest';
import { normalizeErrorMessage } from './error-message';

describe('normalizeErrorMessage', () => {
  it('corrects the controller file error grammar', () => {
    expect(normalizeErrorMessage('File does not exists')).toBe('File does not exist');
  });

  it('leaves other error text unchanged', () => {
    expect(normalizeErrorMessage('Device offline')).toBe('Device offline');
  });
});
