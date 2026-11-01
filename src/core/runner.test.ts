import { describe, expect, it } from 'vitest';
import {
  addRunnerFolder,
  addToRunner,
  formatClock,
  moveRunnerItem,
  parseRunnerData,
  removeFromRunner,
  removeRunnerFolder,
  renameRunnerFile,
  setRunnerItemFolder,
} from './runner';
import type { RunnerState } from './runner';

const files = (state: RunnerState) => state.items.map((item) => item.file);

describe('runner state', () => {
  it('adds each protocol once and removes it', () => {
    let state = addToRunner({ folders: [], items: [] }, 'a.vnp0');
    state = addToRunner(addToRunner(state, 'a.vnp0'), 'b.vnp0');
    expect(files(state)).toEqual(['a.vnp0', 'b.vnp0']);
    expect(files(removeFromRunner(state, 'a.vnp0'))).toEqual(['b.vnp0']);
  });

  it('reorders within a folder and tracks renames', () => {
    let state = addRunnerFolder({ folders: [], items: [] }, 'Sequences');
    const folderId = state.folders[0]!.id;
    for (const name of ['a', 'b', 'c', 'd']) {
      state = addToRunner(state, `${name}.vnp0`);
    }
    state = setRunnerItemFolder(state, state.items[1]!.id, folderId);
    state = setRunnerItemFolder(state, state.items[3]!.id, folderId);
    expect(moveRunnerItem(state, state.items[3]!.id, -1).items.map((item) => item.file)).toEqual(['a.vnp0', 'd.vnp0', 'c.vnp0', 'b.vnp0']);
    expect(files(moveRunnerItem(state, state.items[0]!.id, -1))).toEqual(files(state));
    expect(files(renameRunnerFile(state, 'a.vnp0', 'z.vnp0'))[0]).toBe('z.vnp0');
  });

  it('empties a removed folder and ignores unknown folders', () => {
    let state = addRunnerFolder({ folders: [], items: [] }, ' Scramblers ');
    const folderId = state.folders[0]!.id;
    expect(state.folders[0]!.name).toBe('Scramblers');
    state = addToRunner(state, 'a.vnp0');
    state = setRunnerItemFolder(state, state.items[0]!.id, folderId);
    expect(setRunnerItemFolder(state, state.items[0]!.id, 'nope')).toBe(state);
    state = removeRunnerFolder(state, folderId);
    expect(state.folders).toEqual([]);
    expect(state.items[0]!.folderId).toBeUndefined();
  });

  it('parses stored data defensively and marks interrupted runs stopped', () => {
    expect(parseRunnerData('nope').runner.items).toEqual([]);
    const data = parseRunnerData({ runner: { folders: [], items: [{ id: '1', file: 'a.vnp0' }, { bad: true }] }, journal: [{ id: 'j', file: 'a.vnp0', status: 'running', note: '', startedAt: 'x' }] });
    expect(data.runner.items).toHaveLength(1);
    expect(data.journal[0]?.status).toBe('stopped');
  });

  it('formats a clock', () => {
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(-3)).toBe('0:00');
  });
});
