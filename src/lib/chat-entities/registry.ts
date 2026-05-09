import type { ChatEntityRegistry, EntityKind, EntitySpec } from './types';

class Registry implements ChatEntityRegistry {
  private specs = new Map<EntityKind, EntitySpec>();

  register(spec: EntitySpec): void {
    if (this.specs.has(spec.kind)) {
      throw new Error(`Chat entity kind collision: ${spec.kind}`);
    }
    this.specs.set(spec.kind, spec);
  }

  get(kind: EntityKind): EntitySpec | undefined {
    return this.specs.get(kind);
  }

  list(): EntitySpec[] {
    return Array.from(this.specs.values());
  }

  _resetForTests(): void {
    this.specs.clear();
  }
}

export const registry: ChatEntityRegistry = new Registry();
