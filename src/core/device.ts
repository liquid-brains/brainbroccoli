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
): Promise<ProtocolFile[]> {
  onProgress('Requesting the file list from the controller…');
  const names = await device.listFiles(['vnp0', 'vnp2', 'vnp3']);
  const files: ProtocolFile[] = [];
  for (const [index, name] of names.entries()) {
    onProgress(`Downloading ${name} (${index + 1} of ${names.length})…`);
    files.push({ name, protocol: parseProtocolJSON(JSON.stringify(await device.getFile(name))) });
  }
  return files;
}

// Uploads user protocol files; a batch is uploaded after the stage files it uses.
export async function saveControllerFiles(
  device: VielightDevice,
  files: ProtocolFile[],
  onProgress: (message: string) => void = () => undefined,
): Promise<void> {
  for (const [index, { name, protocol }] of files.entries()) {
    onProgress(`Saving ${name} to the controller (${index + 1} of ${files.length})…`);
    await device.saveFile(name, JSON.parse(JSON.stringify(protocol)) as unknown, true);
  }
}
