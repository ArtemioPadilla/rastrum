/**
 * Built-in identifier registration. Importing this module side-effect
 * registers every shipped plugin into the singleton registry.
 *
 * Adding a new built-in identifier: write the plugin file, then add an
 * import + register() call below.
 *
 * Adding a community / third-party identifier: import this module, then
 * call `registry.register(yourPlugin)` from your own bootstrap. The
 * registry has runtime collision detection, so duplicate ids fail loud.
 */
import { registry } from './registry';
import { plantNetIdentifier } from './plantnet';
import { claudeIdentifier } from './claude';
import { phiVisionIdentifier } from './phi-vision';
import { birdnetIdentifier } from './birdnet';
import { onnxBaseIdentifier } from './onnx-base';

let booted = false;
export function bootstrapIdentifiers() {
  if (booted) return registry;
  registry.register(plantNetIdentifier);
  registry.register(claudeIdentifier);
  registry.register(phiVisionIdentifier);
  registry.register(birdnetIdentifier);
  registry.register(onnxBaseIdentifier);
  booted = true;
  return registry;
}

export { registry } from './registry';
export { runCascade, ACCEPT_THRESHOLD } from './cascade';
export type {
  Identifier, IdentifierRegistry, IdentifierAvailability, IdentifierCapabilities,
  IDResult, IdentifyInput, MediaKind, Runtime, LicenseKind,
} from './types';
