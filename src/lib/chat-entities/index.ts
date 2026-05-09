/**
 * Bootstrap: registers every built-in EntitySpec. Call once from ChatView
 * mount. Idempotent — re-bootstrap is a no-op after the first call.
 */
import { registry } from './registry';
import { observationSpec } from './observation';
import { speciesSpec } from './species';
import { projectSpec } from './project';
import { cameraStationSpec } from './camera-station';
import { observerSpec } from './observer';
import { selfProfileSpec } from './self-profile';

export { registry } from './registry';
export type { EntityCard, EntityKind, EntitySpec } from './types';

let bootstrapped = false;

export function bootstrapChatEntities(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  registry.register(observationSpec);
  registry.register(speciesSpec);
  registry.register(projectSpec);
  registry.register(cameraStationSpec);
  registry.register(observerSpec);
  registry.register(selfProfileSpec);
}
