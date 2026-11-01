import JSZip from 'jszip';

import { isProtocolFile, parseProtocolJSON } from './protocol';
import type { Protocol } from './protocol';

export type ProtocolFile = { name: string; protocol: Protocol };

function normalizeArchivePath(path: string): string {
  return path.replace(/\\/g, '/')
    .replace(/^[a-z]:/i, '')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/:/g, '_'))
    .join('/');
}

function validateArchivePaths(contents: Uint8Array): void {
  const view = new DataView(contents.buffer, contents.byteOffset, contents.byteLength);
  const eocdSignature = 0x06054b50;
  const centralFileSignature = 0x02014b50;
  const searchStart = Math.max(0, contents.length - 22 - 0xffff);
  let eocdOffset = -1;

  for (let offset = contents.length - 22; offset >= searchStart; offset -= 1) {
    if (
      view.getUint32(offset, true) === eocdSignature
      && offset + 22 + view.getUint16(offset + 20, true) === contents.length
    ) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid ZIP archive.');
  }

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0) {
    throw new Error('Multi-disk ZIP archives are not supported.');
  }
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported.');
  }

  let offset = centralDirectoryOffset;
  const prefixedBytes = eocdOffset - centralDirectorySize - centralDirectoryOffset;
  if (prefixedBytes > 0) {
    offset += prefixedBytes;
  }
  const names = new Set<string>();

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > contents.length || view.getUint32(offset, true) !== centralFileSignature) {
      throw new Error('Invalid ZIP archive.');
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameEnd = offset + 46 + nameLength;
    const nextOffset = nameEnd + extraLength + commentLength;
    if (nextOffset > contents.length) {
      throw new Error('Invalid ZIP archive.');
    }

    const originalName = new TextDecoder().decode(contents.subarray(offset + 46, nameEnd));
    if (originalName.replace(/\\/g, '/').split('/').includes('..')) {
      throw new Error('ZIP archive contains an unsafe file path.');
    }
    const name = normalizeArchivePath(originalName);
    if (names.has(name.toLowerCase())) {
      throw new Error('ZIP archive contains colliding file paths.');
    }
    names.add(name.toLowerCase());
    offset = nextOffset;
  }
}

function archiveFileName(path: string, existingNames: Set<string>): string {
  const name = normalizeArchivePath(path);
  const extension = name.match(/\.[^/.]+$/)?.[0] ?? '';
  const stem = extension === '' ? name : name.slice(0, -extension.length);
  let candidate = name;
  let suffix = 2;
  while (existingNames.has(candidate.toLowerCase())) {
    candidate = `${stem}__${suffix}${extension}`;
    suffix += 1;
  }
  existingNames.add(candidate.toLowerCase());
  return candidate;
}

export async function readProtocolArchive(contents: ArrayBuffer | Uint8Array): Promise<ProtocolFile[]> {
  validateArchivePaths(contents instanceof Uint8Array ? contents : new Uint8Array(contents));
  const archive = await JSZip.loadAsync(contents);
  const protocols: ProtocolFile[] = [];
  const names = new Set<string>();

  for (const [path, entry] of Object.entries(archive.files)) {
    const originalName = entry.unsafeOriginalName ?? path;
    if (originalName.replace(/\\/g, '/').split('/').includes('..')) {
      throw new Error('ZIP archive contains an unsafe file path.');
    }
    const name = archiveFileName(originalName, names);
    if (!entry.dir && isProtocolFile(name)) {
      protocols.push({ name, protocol: parseProtocolJSON(await entry.async('string')) });
    }
  }

  return protocols;
}
