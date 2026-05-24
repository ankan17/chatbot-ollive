import {
  withLogging,
  createRoutingProvider,
  googleProviderFactory,
  anthropicProviderFactory,
} from '@ollive/llm-sdk';
import type { LLMProvider, LogSink, InferenceLoggerConfig } from '@ollive/llm-sdk';
import type { AppConfig } from '../config.js';
import { availableModels } from '../models/catalog.js';

export function buildChatProvider(config: AppConfig, sink: LogSink): LLMProvider {
  const cfg: InferenceLoggerConfig = {
    ingestionUrl: `http://localhost:${config.port}/v1/logs`,
    apiKey: config.ingestionApiKey,
    redaction: config.piiRedaction,
  };

  const wrap = (p: LLMProvider) => withLogging(p, cfg, sink);

  const byName: Record<string, LLMProvider> = {
    google: wrap(googleProviderFactory()),
  };

  if (config.anthropicApiKey) {
    byName.anthropic = wrap(anthropicProviderFactory());
  }

  const modelToProvider = new Map(
    availableModels(config).map((m) => [m.id, m.provider]),
  );

  return createRoutingProvider((model) => {
    const name = modelToProvider.get(model);
    return name ? byName[name] : undefined;
  });
}
