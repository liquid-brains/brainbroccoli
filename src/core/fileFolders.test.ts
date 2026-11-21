import { describe, expect, it } from 'vitest';
import {
  addFileFolder,
  emptyFileFolders,
  folderOfFile,
  moveFileToFolder,
  parseFileFolders,
  removeFileFolder,
  renameFolderFile,
} from './fileFolders';

describe('file folders', () => {
  const withFolder = addFileFolder(emptyFileFolders, '.vnp0', ' Client A ');
  const folder = withFolder.folders[0]!;

  it('creates trimmed folders and ignores blank names', () => {
    expect(folder.name).toBe('Client A');
    expect(addFileFolder(emptyFileFolders, '.vnp0', '  ')).toBe(emptyFileFolders);
  });

  it('only accepts files whose type matches the folder section', () => {
    expect(moveFileToFolder(withFolder, 'a.vnp4', folder.id)).toBe(withFolder);
    const moved = moveFileToFolder(withFolder, 'a.vnp0', folder.id);
    expect(folderOfFile(moved, 'a.vnp0', '.vnp0')?.id).toBe(folder.id);
    expect(folderOfFile(moveFileToFolder(moved, 'a.vnp0', undefined), 'a.vnp0', '.vnp0')).toBeUndefined();
  });

  it('follows renames and releases files when a folder is removed', () => {
    const moved = moveFileToFolder(withFolder, 'a.vnp0', folder.id);
    expect(renameFolderFile(moved, 'a.vnp0', 'b.vnp0').assignments).toEqual({ 'b.vnp0': folder.id });
    expect(removeFileFolder(moved, folder.id)).toEqual(emptyFileFolders);
  });

  it('tolerates malformed stored data', () => {
    expect(parseFileFolders('nope')).toEqual(emptyFileFolders);
    expect(parseFileFolders({ folders: [{ id: 1 }, { id: 'f', name: 'N', extension: '.vnp0' }], assignments: { a: 'f', b: 2 } })).toEqual({
      folders: [{ id: 'f', name: 'N', extension: '.vnp0' }],
      assignments: { a: 'f' },
    });
  });
});
