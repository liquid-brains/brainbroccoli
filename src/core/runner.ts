import { calculateTotalDuration } from './protocol';
import type { Protocol } from './protocol';

export type RunnerFolder = { id: string; name: string };
export type RunnerItem = { id: string; file: string; folderId?: string };
export type RunnerState = { folders: RunnerFolder[]; items: RunnerItem[] };

export type JournalStatus = 'running' | 'completed' | 'stopped' | 'failed';
export type JournalEntry = {
  id: string;
  file: string;
  startedAt: string;
  status: JournalStatus;
  up?: number;
  down?: number;
  summary?: string;
  note: string;
};

export type RunnerData = { runner: RunnerState; journal: JournalEntry[] };

export const emptyRunnerData: RunnerData = { runner: { folders: [], items: [] }, journal: [] };

let counter = 0;
export function createId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function addToRunner(state: RunnerState, file: string): RunnerState {
  if (state.items.some((item) => item.file === file)) {
    return state;
  }
  return { ...state, items: [...state.items, { id: createId('item'), file }] };
}

export function removeFromRunner(state: RunnerState, file: string): RunnerState {
  return { ...state, items: state.items.filter((item) => item.file !== file) };
}

export function renameRunnerFile(state: RunnerState, oldName: string, newName: string): RunnerState {
  return { ...state, items: state.items.map((item) => (item.file === oldName ? { ...item, file: newName } : item)) };
}

// Moves an item past its neighbor inside the same folder (or the unfiled list).
export function moveRunnerItem(state: RunnerState, id: string, direction: -1 | 1): RunnerState {
  const index = state.items.findIndex((item) => item.id === id);
  const item = state.items[index];
  if (!item) {
    return state;
  }
  let target = index + direction;
  while (state.items[target] && state.items[target]?.folderId !== item.folderId) {
    target += direction;
  }
  if (!state.items[target]) {
    return state;
  }
  const items = [...state.items];
  items[index] = items[target] as RunnerItem;
  items[target] = item;
  return { ...state, items };
}

// Drops an item before or after a target item, joining the target's folder.
export function moveRunnerItemTo(state: RunnerState, id: string, targetId: string, after: boolean): RunnerState {
  const item = state.items.find((candidate) => candidate.id === id);
  const target = state.items.find((candidate) => candidate.id === targetId);
  if (!item || !target || id === targetId) {
    return state;
  }
  const moved: RunnerItem = { id: item.id, file: item.file, ...(target.folderId === undefined ? {} : { folderId: target.folderId }) };
  const items = state.items.filter((candidate) => candidate.id !== id);
  const index = items.findIndex((candidate) => candidate.id === targetId);
  items.splice(after ? index + 1 : index, 0, moved);
  return { ...state, items };
}

// Drops an item at the end of a folder, or of the unfiled list when folderId is undefined.
export function moveRunnerItemToFolderEnd(state: RunnerState, id: string, folderId: string | undefined): RunnerState {
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item || (folderId !== undefined && !state.folders.some((folder) => folder.id === folderId))) {
    return state;
  }
  const moved: RunnerItem = { id: item.id, file: item.file, ...(folderId === undefined ? {} : { folderId }) };
  return { ...state, items: [...state.items.filter((candidate) => candidate.id !== id), moved] };
}

export function setRunnerItemFolder(state: RunnerState, id: string, folderId: string | undefined): RunnerState {
  const known = folderId === undefined || state.folders.some((folder) => folder.id === folderId);
  if (!known) {
    return state;
  }
  return {
    ...state,
    items: state.items.map((item) => {
      if (item.id !== id) {
        return item;
      }
      const { folderId: _previous, ...rest } = item;
      return folderId === undefined ? rest : { ...rest, folderId };
    }),
  };
}

export function addRunnerFolder(state: RunnerState, name: string): RunnerState {
  const trimmed = name.trim();
  return trimmed === '' ? state : { ...state, folders: [...state.folders, { id: createId('folder'), name: trimmed }] };
}

export function renameRunnerFolder(state: RunnerState, id: string, name: string): RunnerState {
  return { ...state, folders: state.folders.map((folder) => (folder.id === id ? { ...folder, name } : folder)) };
}

// Protocols in a removed folder go back to the unfiled list.
export function removeRunnerFolder(state: RunnerState, id: string): RunnerState {
  return {
    folders: state.folders.filter((folder) => folder.id !== id),
    items: state.items.map((item) => {
      const { folderId, ...rest } = item;
      return folderId === id ? rest : item;
    }),
  };
}

export function parseRunnerData(raw: unknown): RunnerData {
  if (raw === null || typeof raw !== 'object') {
    return emptyRunnerData;
  }
  const data = raw as Partial<RunnerData>;
  const folders = Array.isArray(data.runner?.folders)
    ? data.runner.folders.filter((folder) => typeof folder?.id === 'string' && typeof folder.name === 'string')
    : [];
  const items = Array.isArray(data.runner?.items)
    ? data.runner.items.filter((item) => typeof item?.id === 'string' && typeof item.file === 'string')
    : [];
  const journal = Array.isArray(data.journal)
    ? data.journal.filter((entry) => typeof entry?.id === 'string' && typeof entry.file === 'string')
    : [];
  return { runner: { folders, items }, journal: journal.map((entry) => {
    const { up, down, ...rest } = entry;
    const upCount = clampThumbs(up) ?? 0;
    const downCount = clampThumbs(down) ?? 0;
    const counts = upCount > 0 && downCount > 0 ? {} : { ...(upCount > 0 ? { up: upCount } : {}), ...(downCount > 0 ? { down: downCount } : {}) };
    return { ...rest, ...counts, ...(entry.status === 'running' ? { status: 'stopped' as const } : {}) };
  }) };
}

export const maxThumbs = 5;

// Each press adds one thumb; pressing at the maximum starts over at zero.
export function nextThumbCount(count: number | undefined): number {
  const current = count ?? 0;
  return current >= maxThumbs ? 0 : current + 1;
}

function clampThumbs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(maxThumbs, Math.max(0, Math.round(value))) : undefined;
}

function span(values: number[], unit: string): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? `${low}${unit}` : `${low}–${high}${unit}`;
}

export function summarizeProtocol(protocol: Protocol, stages: Protocol[] = []): string {
  const parts: string[] = [];
  if (protocol.filenames !== undefined) {
    const names = protocol.filenames.filter((name) => name !== '');
    parts.push(`Batch of ${names.length} protocol(s): ${names.join(', ')}`);
    const total = stages.reduce((sum, stage) => sum + (calculateTotalDuration(stage) ?? 0), 0);
    if (total > 0) {
      parts.push(`${Math.round(total * 10) / 10} min`);
    }
    return parts.join(' · ');
  }
  const modules = (Array.isArray(protocol.modules) ? protocol.modules : []).filter((module) => module.active !== false);
  parts.push(`${modules.length} active module(s)`);
  const freqs = modules.map((module) => Number(module.freq)).filter(Number.isFinite);
  const powers = modules.map((module) => Number(module.power)).filter(Number.isFinite);
  if (freqs.length > 0) {
    parts.push(span(freqs, ' Hz'));
  }
  if (powers.length > 0) {
    parts.push(`${span(powers, '%')} power`);
  }
  if (protocol.frequency?.active === true) {
    parts.push(`frequency sweep ${Number(protocol.frequency.startFreq)}–${Number(protocol.frequency.endFreq)} Hz`);
  }
  if (protocol.power?.active === true) {
    parts.push(`power sweep ${Number(protocol.power.startPower)}–${Number(protocol.power.endPower)}%`);
  }
  if (protocol.cross?.active === true) {
    parts.push('cross-coupling');
  }
  const minutes = calculateTotalDuration(protocol);
  if (minutes !== undefined) {
    parts.push(`${minutes} min`);
  }
  return parts.join(' · ');
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
