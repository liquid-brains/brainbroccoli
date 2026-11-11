import { VielightDevice } from '@liquid-brains/brainlight/lib/neuropro/index.js';

import { parseProtocolJSON } from './protocol';
import type { ProtocolFile } from './protocol-archive';

type DeviceOptions = Omit<ConstructorParameters<typeof VielightDevice>[0], 'ip'>;

function isValidAddress(address: string): boolean {
  const labels = address.split('.');
  if (/^[\d.]+$/.test(address)) {
    return labels.length === 4 && labels.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255);
  }
  return labels.every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) && /[a-z]/i.test(labels[labels.length - 1] ?? '');
}

export function createNeuroPro2Device(ip: string, options: DeviceOptions = {}): VielightDevice {
  const address = ip.trim();
  if (!isValidAddress(address)) {
    throw new Error('Enter a valid NeuroPro2 IPv4 address or host name.');
  }

  return new VielightDevice({ ip: address, requestTimeout: 10_000, ...options });
}

export async function downloadControllerFiles(
  device: VielightDevice,
  onProgress: (message: string) => void = () => undefined,
  skipNames: Iterable<string> = [],
  includeExtended = false,
  extendedOnly = false,
): Promise<ProtocolFile[]> {
  onProgress('Requesting the file list from the controller…');
  const skip = new Set(Array.from(skipNames, (name) => name.toLowerCase()));
  const names = (await device.listFiles(extendedOnly ? ['vnp2'] : includeExtended ? ['vnp0', 'vnp2', 'vnp3'] : ['vnp0', 'vnp3'])).filter((name) => !skip.has(name.toLowerCase()));
  const files: ProtocolFile[] = [];
  for (const [index, name] of names.entries()) {
    onProgress(`Downloading ${name} (${index + 1} of ${names.length})…`);
    files.push({ name, protocol: parseProtocolJSON(JSON.stringify(await device.getFile(name))) });
  }
  return files;
}

export async function downloadControllerFile(device: VielightDevice, name: string): Promise<ProtocolFile> {
  return { name, protocol: parseProtocolJSON(JSON.stringify(await device.getFile(name))) };
}

// Uploads user protocol files; a batch is uploaded after the stage files it uses.
// The controller rejects an update of a missing file, so updateExisting follows what it already has.
export async function saveControllerFiles(
  device: VielightDevice,
  files: ProtocolFile[],
  onProgress: (message: string) => void = () => undefined,
): Promise<void> {
  const existing = new Set<string>();
  for (const extension of ['vnp0', 'vnp4'] as const) {
    if (files.some(({ name }) => name.toLowerCase().endsWith(`.${extension}`))) {
      const listed = await device.listFiles(extension === 'vnp4' ? 'vnp3' : extension);
      listed.forEach((name) => existing.add(name.toLowerCase()));
    }
  }
  for (const [index, { name, protocol }] of files.entries()) {
    onProgress(`Saving ${name} to the controller (${index + 1} of ${files.length})…`);
    const exists = existing.has(name.toLowerCase());
    const data = { ...(JSON.parse(JSON.stringify(protocol)) as Record<string, unknown>), updateExisting: exists };
    try {
      await device.saveFile(name, data, exists);
    } catch (reason) {
      if (!exists) {
        throw reason;
      }
      onProgress(`Replacing ${name} on the controller…`);
      await device.deleteFile(name);
      await device.saveFile(name, { ...data, updateExisting: false }, false);
    }
  }
}

// Makes sure user protocols are on the controller, then runs one until it finishes or is aborted.
// The controller normally reports when a protocol ends, but if that never arrives we stop it once its scheduled time has passed.
const END_GRACE_MS = 10_000;

export async function runControllerProtocol(
  device: VielightDevice,
  name: string,
  signal: AbortSignal,
  onProgress: (message: string) => void = () => undefined,
  onStart: () => void = () => undefined,
  expectedMinutes?: number,
): Promise<void> {
  onProgress(`Starting ${name}…`);
  onStart();
  if (expectedMinutes === undefined || expectedMinutes <= 0) {
    await device.runFile(name, { signal, waitForCompletion: true });
    return;
  }
  const inner = new AbortController();
  const forwardAbort = (): void => inner.abort();
  signal.addEventListener('abort', forwardAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    inner.abort();
  }, expectedMinutes * 60_000 + END_GRACE_MS);
  try {
    await device.runFile(name, { signal: inner.signal, waitForCompletion: true });
  } catch (error) {
    if (!timedOut || signal.aborted) {
      throw error;
    }
    onProgress(`${name} did not report finishing; stopping it`);
    await device.stop().catch(() => undefined);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', forwardAbort);
  }
}
