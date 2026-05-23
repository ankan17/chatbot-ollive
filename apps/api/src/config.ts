import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  INGESTION_API_KEY: z.string().min(1),
  INGESTION_STREAM_MAXLEN: z.coerce.number().default(100000),
  // Auth / JWT
  JWT_SECRET: z.string().min(1),
  AUTH_MODE: z.enum(['dev', 'google']).default('dev'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  API_BASE_URL: z.string().optional(),
  // CORS / guest
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  GUEST_MESSAGE_LIMIT: z.coerce.number().int().positive().default(2),
  GUEST_SESSION_TTL: z.coerce.number().int().positive().default(86400),
  // Model
  DEFAULT_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  // Chat (Plan 5)
  // GEMINI_API_KEY is required at startup even though tests supply a dummy value + inject a fake
  // provider — the production wiring reads it to construct googleProviderFactory().
  GEMINI_API_KEY: z.string().min(1),
  CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(4000),
  PII_REDACTION: z.enum(['off', 'pattern', 'llm']).default('pattern'),
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export interface AppConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  ingestionApiKey: string;
  ingestionStreamMaxLen: number;
  jwtSecret: string;
  authMode: 'dev' | 'google';
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri: string;
  webOrigin: string;
  guestMessageLimit: number;
  guestSessionTtl: number;
  /** A10 — default 'gemini-2.5-flash'; new conversations use provider='google' + this model. Plan 5 READS this; never re-adds it. */
  defaultModel: string;
  /** GEMINI_API_KEY — required at startup; production wiring reads it to construct googleProviderFactory(). Tests supply a dummy + inject a fake provider. */
  geminiApiKey: string;
  /** CONTEXT_TOKEN_BUDGET — max prompt tokens for the context window (A3/BE5); default 4000. */
  contextTokenBudget: number;
  /** PII_REDACTION — SDK redaction strategy; default 'pattern'. */
  piiRedaction: 'off' | 'pattern' | 'llm';
  nodeEnv: 'development' | 'production' | 'test';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(`Invalid configuration: ${messages}`);
  }
  const data = result.data;

  // Conditional refinement: AUTH_MODE=google requires both Google credentials
  if (data.AUTH_MODE === 'google') {
    const missing: string[] = [];
    if (!data.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
    if (!data.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
    if (missing.length > 0) {
      throw new Error(
        `Invalid configuration: AUTH_MODE=google requires ${missing.join(' and ')} to be set`,
      );
    }
  }

  // Derive googleRedirectUri from explicit value, or from API_BASE_URL, or from port default
  const apiBaseUrl = data.API_BASE_URL ?? `http://localhost:${data.PORT}`;
  const googleRedirectUri = data.GOOGLE_REDIRECT_URI ?? `${apiBaseUrl}/auth/google/callback`;

  return {
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    redisUrl: data.REDIS_URL,
    ingestionApiKey: data.INGESTION_API_KEY,
    ingestionStreamMaxLen: data.INGESTION_STREAM_MAXLEN,
    jwtSecret: data.JWT_SECRET,
    authMode: data.AUTH_MODE,
    googleClientId: data.GOOGLE_CLIENT_ID,
    googleClientSecret: data.GOOGLE_CLIENT_SECRET,
    googleRedirectUri,
    webOrigin: data.WEB_ORIGIN,
    guestMessageLimit: data.GUEST_MESSAGE_LIMIT,
    guestSessionTtl: data.GUEST_SESSION_TTL,
    defaultModel: data.DEFAULT_MODEL,
    geminiApiKey: data.GEMINI_API_KEY,
    contextTokenBudget: data.CONTEXT_TOKEN_BUDGET,
    piiRedaction: data.PII_REDACTION,
    nodeEnv: data.NODE_ENV,
  };
}
