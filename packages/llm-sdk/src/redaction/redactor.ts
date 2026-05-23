import type { Redactor } from '../types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Standard Luhn check. Returns true if the digit string is Luhn-valid. */
function luhnValid(digits: string): boolean {
  const s = digits.replace(/\D/g, '');
  if (s.length < 13 || s.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = parseInt(s[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Shannon entropy in bits/char. Used by the high-entropy API key guard. */
function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq: Record<string, number> = {};
  for (const ch of s) {
    freq[ch] = (freq[ch] ?? 0) + 1;
  }
  let h = 0;
  for (const count of Object.values(freq)) {
    const p = count / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Detector pipeline
// ---------------------------------------------------------------------------

interface Detector {
  key: keyof typeof ZERO_COUNTS;
  pattern: RegExp;
  placeholder: string;
  guard?: (match: string) => boolean;
}

const ZERO_COUNTS = {
  email: 0,
  phone: 0,
  credit_card: 0,
  ssn: 0,
  ip: 0,
  iban: 0,
  api_key: 0,
};

type CountKey = keyof typeof ZERO_COUNTS;

// Detectors in deliberate order: specific/structured before generic.
const DETECTORS: Detector[] = [
  // 1. Email — local-part @ domain . tld
  {
    key: 'email',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    placeholder: '[EMAIL]',
  },

  // 2. IBAN — 2 letters + 2 digits + 10-30 alphanumerics (no spaces)
  {
    key: 'iban',
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
    placeholder: '[IBAN]',
  },

  // 3. Credit card — 13-19 digits with optional single space/dash separators, Luhn-guarded
  {
    key: 'credit_card',
    pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
    placeholder: '[CREDIT_CARD]',
    guard: (match: string) => {
      const digits = match.replace(/[ -]/g, '');
      if (digits.length < 13 || digits.length > 19) return false;
      return luhnValid(digits);
    },
  },

  // 4. SSN — US format DDD-DD-DDDD
  {
    key: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    placeholder: '[SSN]',
  },

  // 5. IPv4 dotted quad, each octet 0-255
  {
    key: 'ip',
    pattern:
      /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    placeholder: '[IP]',
  },

  // 6. Phone — runs after card/ssn/ip; guarded: 7-15 stripped digits
  {
    key: 'phone',
    pattern: /(?:\+\d)?[\d\s().+-]{7,25}(?<![.\s])/g,
    placeholder: '[PHONE]',
    guard: (match: string) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15;
    },
  },

  // 7. API key: known prefixes
  {
    key: 'api_key',
    pattern:
      /(?:sk-|pk-|rk-)[A-Za-z0-9]{16,}|(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|(?:xoxb-|xoxa-|xoxp-|xoxr-|xoxs-)[A-Za-z0-9-]{10,}/g,
    placeholder: '[API_KEY]',
  },

  // 8. API key: high-entropy generic token ≥24 chars from [A-Za-z0-9_-]
  //    Requires mixed case + a digit + Shannon entropy > 3.5
  {
    key: 'api_key',
    pattern: /[A-Za-z0-9_-]{24,}/g,
    placeholder: '[API_KEY]',
    guard: (match: string) => {
      const hasUpper = /[A-Z]/.test(match);
      const hasLower = /[a-z]/.test(match);
      const hasDigit = /\d/.test(match);
      return hasUpper && hasLower && hasDigit && shannonEntropy(match) > 3.5;
    },
  },
];

// ---------------------------------------------------------------------------
// PatternRedactor
// ---------------------------------------------------------------------------

export class PatternRedactor implements Redactor {
  redact(text: string): { text: string; counts: Record<string, number> } {
    const counts: Record<CountKey, number> = { ...ZERO_COUNTS };
    let result = text;

    for (const detector of DETECTORS) {
      const regex = new RegExp(detector.pattern.source, detector.pattern.flags);
      result = result.replace(regex, (match) => {
        if (detector.guard && !detector.guard(match)) {
          return match;
        }
        counts[detector.key] += 1;
        return detector.placeholder;
      });
    }

    return { text: result, counts };
  }
}

// ---------------------------------------------------------------------------
// NoopRedactor
// ---------------------------------------------------------------------------

export class NoopRedactor implements Redactor {
  redact(text: string): { text: string; counts: Record<string, number> } {
    return { text, counts: {} };
  }
}

// ---------------------------------------------------------------------------
// LlmRedactor
// ---------------------------------------------------------------------------

export class LlmRedactor implements Redactor {
  private readonly base: Redactor;
  private readonly classify?: (text: string) => { text: string; counts: Record<string, number> };

  constructor(
    base?: Redactor,
    classify?: (text: string) => { text: string; counts: Record<string, number> },
  ) {
    this.base = base ?? new PatternRedactor();
    this.classify = classify;
  }

  redact(text: string): { text: string; counts: Record<string, number> } {
    const baseResult = this.base.redact(text);
    if (!this.classify) {
      return baseResult;
    }
    const classifyResult = this.classify(baseResult.text);
    // Merge counts
    const counts = { ...baseResult.counts };
    for (const [k, v] of Object.entries(classifyResult.counts)) {
      counts[k] = (counts[k] ?? 0) + v;
    }
    return { text: classifyResult.text, counts };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRedactor(
  mode: 'off' | 'pattern' | 'llm',
  override?: Redactor,
): Redactor {
  if (override !== undefined) return override;
  if (mode === 'off') return new NoopRedactor();
  if (mode === 'pattern') return new PatternRedactor();
  // 'llm' without override — LlmRedactor with no classify fn degrades to pure pattern behavior
  return new LlmRedactor();
}
