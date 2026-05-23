import type { LLMProvider } from './types.js';

export type ProviderFactory = () => LLMProvider;

/**
 * Registry mapping provider names to their factory functions.
 * Adding a provider = one adapter + one registry entry (FR14/PA3/PA4).
 */
export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();

  /** Register a factory under a name; chainable. */
  register(name: string, factory: ProviderFactory): this {
    this.factories.set(name, factory);
    return this;
  }

  /** Returns true if a provider is registered under this name. */
  has(name: string): boolean {
    return this.factories.has(name);
  }

  /** Creates a provider by name; throws if not registered. */
  create(name: string): LLMProvider {
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(`No LLM provider registered for "${name}"`);
    }
    return factory();
  }

  /** Returns all registered provider names (in insertion order). */
  names(): string[] {
    return Array.from(this.factories.keys());
  }
}
