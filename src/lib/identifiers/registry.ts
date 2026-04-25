/**
 * Singleton registry. Plugins register themselves on import; the cascade
 * engine and the UI both query this list.
 */
import type { Identifier, IdentifierRegistry, MediaKind, Runtime } from './types';

class Registry implements IdentifierRegistry {
  private plugins = new Map<string, Identifier>();

  register(p: Identifier): void {
    if (this.plugins.has(p.id)) {
      throw new Error(`Identifier id collision: ${p.id}`);
    }
    this.plugins.set(p.id, p);
  }

  get(id: string): Identifier | undefined {
    return this.plugins.get(id);
  }

  list(): Identifier[] {
    return Array.from(this.plugins.values());
  }

  findFor(opts: { media: MediaKind; taxa?: string; runtime?: Runtime }): Identifier[] {
    const wantedKingdom = opts.taxa?.split('.')?.[0];
    return this.list().filter(p => {
      if (!p.capabilities.media.includes(opts.media)) return false;
      if (opts.runtime && p.capabilities.runtime !== opts.runtime) return false;
      if (wantedKingdom) {
        const accepts = p.capabilities.taxa.some(t => t === '*' || t === opts.taxa || t === wantedKingdom);
        if (!accepts) return false;
      }
      return true;
    });
  }
}

export const registry: IdentifierRegistry = new Registry();
