import { describe, it, expect } from 'vitest';
import {
  PatternRedactor,
  NoopRedactor,
  LlmRedactor,
  createRedactor,
} from '../src/redaction/redactor.js';

describe('PatternRedactor', () => {
  const r = new PatternRedactor();

  describe('table-driven detection', () => {
    it('detects email', () => {
      const { text, counts } = r.redact('reach me at ankan@hyperverge.co please');
      expect(text).toContain('[EMAIL]');
      expect(text).not.toContain('ankan@hyperverge.co');
      expect(counts.email).toBeGreaterThanOrEqual(1);
    });

    it('detects phone', () => {
      const { text, counts } = r.redact('call +1 (415) 555-2671 tomorrow');
      expect(text).toContain('[PHONE]');
      expect(text).not.toContain('555-2671');
      expect(counts.phone).toBeGreaterThanOrEqual(1);
    });

    it('detects credit card (Luhn passing)', () => {
      const { text, counts } = r.redact('card 4111 1111 1111 1111 expires soon');
      expect(text).toContain('[CREDIT_CARD]');
      expect(text).not.toContain('4111 1111 1111 1111');
      expect(counts.credit_card).toBeGreaterThanOrEqual(1);
    });

    it('detects SSN', () => {
      const { text, counts } = r.redact('ssn 123-45-6789 on file');
      expect(text).toContain('[SSN]');
      expect(text).not.toContain('123-45-6789');
      expect(counts.ssn).toBeGreaterThanOrEqual(1);
    });

    it('detects IPv4', () => {
      const { text, counts } = r.redact('origin 192.168.1.254 logged');
      expect(text).toContain('[IP]');
      expect(text).not.toContain('192.168.1.254');
      expect(counts.ip).toBeGreaterThanOrEqual(1);
    });

    it('detects IBAN', () => {
      const { text, counts } = r.redact('pay GB82WEST12345698765432 now');
      expect(text).toContain('[IBAN]');
      expect(text).not.toContain('GB82WEST12345698765432');
      expect(counts.iban).toBeGreaterThanOrEqual(1);
    });

    it('detects api_key with known prefix (sk-)', () => {
      const { text, counts } = r.redact('token sk-ABCDEFGHIJKLMNOPQRSTUVWX leaked');
      expect(text).toContain('[API_KEY]');
      expect(text).not.toContain('sk-ABCDEFGHIJKLMNOPQRSTUVWX');
      expect(counts.api_key).toBeGreaterThanOrEqual(1);
    });
  });

  it('Luhn negative: non-Luhn number not tagged as credit card', () => {
    const { text, counts } = r.redact('order 1234567812345678 shipped');
    expect(text).not.toContain('[CREDIT_CARD]');
    expect(counts.credit_card).toBe(0);
  });

  it('detects high-entropy secret', () => {
    const { text, counts } = r.redact('Authorization: Bearer aZ9kQ2wXp7Lm4Rt8Yv1Bn6Cd3Ef0Gh5Ij');
    expect(text).toContain('[API_KEY]');
    expect(counts.api_key).toBeGreaterThanOrEqual(1);
  });

  it('detects multiple occurrences of one type', () => {
    const { text, counts } = r.redact('a@b.com and c@d.org');
    expect(counts.email).toBe(2);
    // both raw values gone
    expect(text).not.toContain('a@b.com');
    expect(text).not.toContain('c@d.org');
    // two placeholders present
    expect(text.split('[EMAIL]').length - 1).toBe(2);
  });

  it('clean text returns unchanged with zero counts', () => {
    const { text, counts } = r.redact('the quick brown fox jumps over the lazy dog');
    expect(text).toBe('the quick brown fox jumps over the lazy dog');
    expect(Object.values(counts).every((v) => v === 0)).toBe(true);
  });

  it('all count keys present even for clean text', () => {
    const { counts } = r.redact('hello world');
    expect(Object.keys(counts)).toEqual(
      expect.arrayContaining(['email', 'phone', 'credit_card', 'ssn', 'ip', 'iban', 'api_key']),
    );
  });
});

describe('NoopRedactor', () => {
  it('returns text unchanged with empty counts', () => {
    const nr = new NoopRedactor();
    const result = nr.redact('ankan@hyperverge.co');
    expect(result.text).toBe('ankan@hyperverge.co');
    expect(result.counts).toEqual({});
  });
});

describe('createRedactor', () => {
  it("'off' returns NoopRedactor", () => {
    expect(createRedactor('off')).toBeInstanceOf(NoopRedactor);
  });

  it("'pattern' returns PatternRedactor", () => {
    expect(createRedactor('pattern')).toBeInstanceOf(PatternRedactor);
  });

  it("'llm' without override returns LlmRedactor (degrades to pattern behavior at runtime)", () => {
    expect(createRedactor('llm')).toBeInstanceOf(LlmRedactor);
  });

  it('with override, returns exact custom instance', () => {
    const custom = new PatternRedactor();
    expect(createRedactor('pattern', custom)).toBe(custom);
  });
});

describe('LlmRedactor with classify function', () => {
  it('runs classify on pattern-redacted text, merges counts from both passes, and raw PII is absent', () => {
    // A classify fn that replaces a magic token "<<JOHN>>" with [NAME]
    const classify = (text: string): { text: string; counts: Record<string, number> } => {
      let count = 0;
      const replaced = text.replace(/<<JOHN>>/g, () => {
        count++;
        return '[NAME]';
      });
      return { text: replaced, counts: count > 0 ? { name: count } : {} };
    };

    const redactor = new LlmRedactor(new PatternRedactor(), classify);

    // Input contains an email (caught by pattern pass) and the magic token (caught by classify pass)
    const input = 'Contact ankan@hyperverge.co or <<JOHN>> for details';
    const { text, counts } = redactor.redact(input);

    // Pattern pass replaced the email; classify pass replaced the token
    expect(counts.email).toBe(1);
    expect(counts.name).toBe(1);

    // Raw PII is gone
    expect(text).not.toContain('ankan@hyperverge.co');
    expect(text).not.toContain('<<JOHN>>');

    // Placeholders are present
    expect(text).toContain('[EMAIL]');
    expect(text).toContain('[NAME]');
  });
});
