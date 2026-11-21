import { createId } from './runner';

// Folders only organize the sidebar; file names (and what is uploaded to the controller) are unchanged.
export type FileFolder = { id: string; name: string; extension: string; collapsed?: boolean };
export type FileFolderState = { folders: FileFolder[]; assignments: Record<string, string> };

export const emptyFileFolders: FileFolderState = { folders: [], assignments: {} };

export function addFileFolder(state: FileFolderState, extension: string, name: string): FileFolderState {
  const trimmed = name.trim();
  if (trimmed === '') {
    return state;
  }
  return { ...state, folders: [...state.folders, { id: createId('folder'), name: trimmed, extension }] };
}

export function renameFileFolder(state: FileFolderState, id: string, name: string): FileFolderState {
  return { ...state, folders: state.folders.map((folder) => (folder.id === id ? { ...folder, name } : folder)) };
}

export function toggleFileFolder(state: FileFolderState, id: string): FileFolderState {
  return { ...state, folders: state.folders.map((folder) => (folder.id === id ? { ...folder, collapsed: folder.collapsed !== true } : folder)) };
}

// Files in a removed folder return to the top level of their section.
export function removeFileFolder(state: FileFolderState, id: string): FileFolderState {
  return {
    folders: state.folders.filter((folder) => folder.id !== id),
    assignments: Object.fromEntries(Object.entries(state.assignments).filter(([, folderId]) => folderId !== id)),
  };
}

export function moveFileToFolder(state: FileFolderState, file: string, folderId: string | undefined): FileFolderState {
  const { [file]: removed, ...rest } = state.assignments;
  void removed;
  if (folderId === undefined) {
    return { ...state, assignments: rest };
  }
  const folder = state.folders.find((candidate) => candidate.id === folderId);
  if (!folder || !file.toLowerCase().endsWith(folder.extension)) {
    return state;
  }
  return { ...state, assignments: { ...rest, [file]: folderId } };
}

export function renameFolderFile(state: FileFolderState, oldName: string, newName: string): FileFolderState {
  const folderId = state.assignments[oldName];
  if (folderId === undefined) {
    return state;
  }
  const { [oldName]: removed, ...rest } = state.assignments;
  void removed;
  return { ...state, assignments: { ...rest, [newName]: folderId } };
}

export function removeFolderFile(state: FileFolderState, file: string): FileFolderState {
  return moveFileToFolder(state, file, undefined);
}

// A file shows inside its folder only when that folder still exists in the file's section.
export function folderOfFile(state: FileFolderState, file: string, extension: string): FileFolder | undefined {
  const folderId = state.assignments[file];
  return state.folders.find((folder) => folder.id === folderId && folder.extension === extension);
}

export function parseFileFolders(value: unknown): FileFolderState {
  if (typeof value !== 'object' || value === null) {
    return emptyFileFolders;
  }
  const { folders, assignments } = value as { folders?: unknown; assignments?: unknown };
  const validFolders = Array.isArray(folders)
    ? folders.flatMap((folder: unknown): FileFolder[] => {
        const candidate = folder as Partial<FileFolder> | null;
        return candidate && typeof candidate.id === 'string' && typeof candidate.name === 'string' && typeof candidate.extension === 'string'
          ? [{ id: candidate.id, name: candidate.name, extension: candidate.extension, ...(candidate.collapsed === true ? { collapsed: true } : {}) }]
          : [];
      })
    : [];
  const validAssignments: Record<string, string> = {};
  if (typeof assignments === 'object' && assignments !== null) {
    for (const [file, folderId] of Object.entries(assignments)) {
      if (typeof folderId === 'string') {
        validAssignments[file] = folderId;
      }
    }
  }
  return { folders: validFolders, assignments: validAssignments };
}
