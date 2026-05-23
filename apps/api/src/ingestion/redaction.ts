import { PatternRedactor } from '@ollive/llm-sdk';
import type { InferenceLog } from '@ollive/shared';

// One shared stateless instance — PatternRedactor has no mutable state.
const redactor = new PatternRedactor();

function redactString(s: string): string {
  return redactor.redact(s).text;
}

/**
 * Re-applies PII redaction to preview fields and top-level string metadata
 * as a defense-in-depth backstop (IN9). Returns a new InferenceLog; never
 * mutates the input.
 */
export function redactInferenceLog(log: InferenceLog): InferenceLog {
  const preview: InferenceLog['preview'] = {
    ...(log.preview.input !== undefined ? { input: redactString(log.preview.input) } : {}),
    ...(log.preview.output !== undefined ? { output: redactString(log.preview.output) } : {}),
  };

  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(log.metadata)) {
    metadata[key] = typeof value === 'string' ? redactString(value) : value;
  }

  return { ...log, preview, metadata };
}
