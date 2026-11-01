export type RunnerFolder = { id: string; name: string };
export type RunnerItem = { id: string; file: string; folderId?: string };
export type RunnerState = { folders: RunnerFolder[]; items: RunnerItem[] };

export type JournalStatus = 'running' | 'completed' | 'stopped' | 'failed';
export type JournalEntry = {
  id: string;
  file: string;
  startedAt: string;
  status: JournalStatus;
  rating?: 'up' | 'down' | undefined;
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
  return { runner: { folders, items }, journal: journal.map((entry) => (entry.status === 'running' ? { ...entry, status: 'stopped' } : entry)) };
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
