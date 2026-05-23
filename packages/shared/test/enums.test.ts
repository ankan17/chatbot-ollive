import { describe, it, expect } from 'vitest';
import { messageStatus } from '../src/enums';

describe('messageStatus enum', () => {
  it('exposes the three message statuses', () => {
    expect(messageStatus.options).toEqual(['complete', 'partial', 'error']);
  });

  it('rejects an unknown status', () => {
    expect(() => messageStatus.parse('deleted')).toThrow();
  });
});
