/**
 * Single chokepoint for the persisted identification `source`. A machine
 * identification ALWAYS carries its plugin source and must NEVER be
 * coerced to 'human' — that would launder an AI guess into a human
 * validation and corrupt expert-weighted consensus (#1128 R1). 'human'
 * is correct ONLY when the identification is the observer's own (no
 * machine result, i.e. manual taxon entry).
 */
export function resolveIdentificationSource(input: {
  machineSource: string | null | undefined;
  hasMachineResult: boolean;
}): string {
  if (input.hasMachineResult) {
    const s = (input.machineSource ?? '').trim();
    if (!s) {
      throw new Error(
        'identification has a machine result but no source — refusing to write it as human (consensus-integrity guard, #1128 R1)',
      );
    }
    return s;
  }
  return 'human';
}
