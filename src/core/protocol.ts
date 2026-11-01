export const protocolModules = [
  { name: 'C1', number: 7 },
  { name: 'C2', number: 5 },
  { name: 'C3', number: 3 },
  { name: 'C4', number: 12 },
  { name: 'L1', number: 8 },
  { name: 'L2', number: 9 },
  { name: 'L3', number: 10 },
  { name: 'R1', number: 6 },
  { name: 'R2', number: 4 },
  { name: 'R3', number: 1 },
  { name: 'NR', number: 2 },
  { name: 'NL', number: 11 },
] as const;

export type ProtocolSection = Record<string, unknown> & { active?: boolean };

export type ProtocolModule = Record<string, unknown> & {
  module_no: number;
  active?: boolean;
  activeRunTime?: number;
  delayStartTime?: number;
  moduleControl?: Record<string, unknown> & {
    phase?: string | number;
    dutyCycle?: number;
  };
  freq?: number;
  power?: number;
  applyCross?: boolean;
};

export type Protocol = Record<string, unknown> & {
  filename?: string;
  notes?: string;
  frequency?: ProtocolSection;
  power?: ProtocolSection;
  cross?: ProtocolSection;
  modules?: ProtocolModule[];
  filenames?: string[];
};

export function createEmptyProtocol(filename = 'custom'): Protocol {
  return {
    defaultFile: false,
    secretFile: false,
    usedByBatch: 0,
    single: true,
    updateExisting: true,
    saveNew: false,
    filename,
    notes: '',
    frequency: { active: false, startFreq: 0, endFreq: 0, freqStepSize: 0, stepDuration: 0 },
    power: { active: false, startPower: 0, endPower: 0, powerStepSize: 0, stepDuration: 0 },
    cross: { active: false, freq: 0, couplingDelay: 0, stopCoupling: 0 },
    modules: Array.from({ length: 12 }, (_, index) => ({
      module_no: index + 1,
      active: false,
      activeRunTime: 0,
      delayStartTime: 0,
      moduleControl: { phase: 0, dutyCycle: 5 },
      freq: 40,
      power: 100,
      applyCross: false,
    })),
  };
}

export function parseProtocolJSON(contents: string): Protocol {
  const parsed: unknown = JSON.parse(contents);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Protocol file must contain a JSON object.');
  }
  const protocol = parsed as Record<string, unknown>;
  if (protocol.modules !== undefined && !Array.isArray(protocol.modules)) {
    throw new Error('Protocol modules must be a JSON array.');
  }
  if (Array.isArray(protocol.modules) && protocol.modules.some((module) => (
    typeof module !== 'object' || module === null || typeof module.module_no !== 'number'
  ))) {
    throw new Error('Each protocol module must have a module number.');
  }
  const modules = Array.isArray(protocol.modules)
    ? protocol.modules.map((module: ProtocolModule) => {
        const control = isRecord(module.moduleControl) ? module.moduleControl : {};
        const { freq: legacyFrequency, power: legacyPower, ...moduleControl } = control;
        return {
          ...module,
          moduleControl: {
            ...moduleControl,
            phase: normalizePhase(control.phase ?? module.phase) === 'B' ? 1 : 0,
            dutyCycle: numericValue(control.dutyCycle, 5),
          },
          freq: numericValue(module.freq ?? legacyFrequency, 40),
          power: numericValue(module.power ?? legacyPower, 100),
          applyCross: module.applyCross === true,
        };
      })
    : undefined;
  return { ...protocol, ...(modules === undefined ? {} : { modules }) } as Protocol;
}

export function isProtocolFile(filename: string): boolean {
  return /\.(vnp[0-4]|json)$/i.test(filename);
}

export function createUniqueProtocolFileName(prefix: string, extension: string, existingFileNames: string[]): string {
  const existing = new Set(existingFileNames.map((name) => name.toLowerCase()));
  let index = 1;
  while (existing.has(`${prefix}_${index}${extension}`.toLowerCase())) {
    index += 1;
  }
  return `${prefix}_${index}${extension}`;
}

export function createUniqueImportedFileName(filename: string, existingFileNames: Iterable<string>): string {
  const existing = new Set(Array.from(existingFileNames, (name) => name.toLowerCase()));
  if (!existing.has(filename.toLowerCase())) {
    return filename;
  }
  const extension = filename.match(/\.[^/.]+$/)?.[0] ?? '';
  const stem = extension === '' ? filename : filename.slice(0, -extension.length);
  let suffix = 2;
  let candidate = `${stem}__${suffix}${extension}`;
  while (existing.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${stem}__${suffix}${extension}`;
  }
  return candidate;
}

export function getProtocolModule(protocol: Protocol, moduleNumber: number): ProtocolModule {
  const modules = Array.isArray(protocol.modules) ? protocol.modules : [];
  return modules.find((module) => module.module_no === moduleNumber) ?? {
    module_no: moduleNumber,
    active: false,
    activeRunTime: 0,
    delayStartTime: 0,
    moduleControl: { phase: 0, dutyCycle: 5 },
    freq: 0,
    power: 0,
    applyCross: false,
  };
}

export function normalizePhase(phase: unknown): 'A' | 'B' {
  const normalized = String(phase ?? 'A').trim().toUpperCase();
  return normalized === '1' || normalized === 'B' || normalized.includes('B') ? 'B' : 'A';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numericValue(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function calculateTotalDuration(protocol: Protocol): number | undefined {
  let durationMinutes = 0;
  const frequency = protocol.frequency ?? {};
  const power = protocol.power ?? {};

  if (frequency.active !== false) {
    const start = Number(frequency.startFreq);
    const end = Number(frequency.endFreq);
    const step = Number(frequency.freqStepSize);
    const stepDuration = Number(frequency.stepDuration);
    if (start > 0 && end > 0 && step > 0 && stepDuration > 0) {
      durationMinutes = Math.max(durationMinutes, (Math.floor(Math.abs(end - start) / step) + 1) * stepDuration / 60);
    }
  }

  if (power.active !== false) {
    const start = Number(power.startPower);
    const end = Number(power.endPower);
    const step = Number(power.powerStepSize);
    const stepDuration = Number(power.stepDuration || frequency.stepDuration);
    if (start > 0 && end > 0 && step > 0 && stepDuration > 0) {
      durationMinutes = Math.max(durationMinutes, (Math.floor(Math.abs(end - start) / step) + 1) * stepDuration / 60);
    }
  }

  for (const module of Array.isArray(protocol.modules) ? protocol.modules : []) {
    if (module.active !== false) {
      durationMinutes = Math.max(
        durationMinutes,
        Number(module.activeRunTime || module.runTime || 0),
      );
    }
  }

  return durationMinutes > 0 ? Math.round(durationMinutes * 10) / 10 : undefined;
}
