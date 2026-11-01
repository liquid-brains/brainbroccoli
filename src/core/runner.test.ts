import { describe, expect, it } from 'vitest';
import {
  addRunnerFolder,
  addRunnerSequence,
  updateRunnerSequence,
  addToRunner,
  formatClock,
  isUnrated,
  moveRunnerItem,
  removeUnratedEntries,
  sortJournal,
  toggleRunnerFolder,
  nextThumbCount,
  summarizeProtocol,
  moveRunnerItemTo,
  moveRunnerItemToFolderEnd,
  parseRunnerData,
  removeFromRunner,
  removeRunnerItem,
  removeRunnerFolder,
  renameRunnerFile,
  setRunnerItemFolder,
} from './runner';
import type { JournalEntry, RunnerState } from './runner';

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

describe('runner drag and drop', () => {
  const base: RunnerState = {
    folders: [{ id: 'f', name: 'F' }],
    items: [{ id: '1', file: 'a' }, { id: '2', file: 'b' }, { id: '3', file: 'c', folderId: 'f' }],
  };

  it('drops before or after a target and adopts its folder', () => {
    expect(files(moveRunnerItemTo(base, '1', '2', true))).toEqual(['b', 'a', 'c']);
    const into = moveRunnerItemTo(base, '1', '3', false);
    expect(files(into)).toEqual(['b', 'a', 'c']);
    expect(into.items[1]?.folderId).toBe('f');
  });

  it('drops at the end of a folder or the unfiled list', () => {
    const inFolder = moveRunnerItemToFolderEnd(base, '1', 'f');
    expect(files(inFolder)).toEqual(['b', 'c', 'a']);
    expect(inFolder.items[2]?.folderId).toBe('f');
    expect(moveRunnerItemToFolderEnd(base, '3', undefined).items[2]?.folderId).toBeUndefined();
  });
});

describe('journal ratings and summaries', () => {
  it('cycles thumbs from zero to five and back', () => {
    expect(nextThumbCount(undefined)).toBe(1);
    expect(nextThumbCount(4)).toBe(5);
    expect(nextThumbCount(5)).toBe(0);
  });

  it('clamps stored thumb counts', () => {
    const data = parseRunnerData({ journal: [{ id: 'j', file: 'a', startedAt: '', status: 'completed', note: '', up: 9, down: 2 }] });
    expect(data.journal[0]?.up).toBeUndefined();
    expect(data.journal[0]?.down).toBeUndefined();
    const single = parseRunnerData({ journal: [{ id: 'j', file: 'a', startedAt: '', status: 'completed', note: '', up: 9 }] });
    expect(single.journal[0]?.up).toBe(5);
  });

  it('keeps the protocol snapshot stored with a journal entry', () => {
    const data = parseRunnerData({ journal: [{ id: 'j', file: 'a', startedAt: '', status: 'completed', note: '', protocol: { filename: 'a' }, stages: { s: { filename: 's' } } }] });
    expect(data.journal[0]?.protocol).toEqual({ filename: 'a' });
    expect(data.journal[0]?.stages).toEqual({ s: { filename: 's' } });
  });

  it('summarizes a protocol', () => {
    const summary = summarizeProtocol({
      modules: [
        { module_no: 1, active: true, activeRunTime: 20, freq: 40, power: 100 },
        { module_no: 2, active: true, activeRunTime: 20, freq: 10, power: 50 },
        { module_no: 3, active: false, freq: 99, power: 1 },
      ],
    });
    expect(summary).toBe('2 active module(s) · 10–40 Hz · 50–100% power · 20 min');
  });
});

describe('journal sorting and cleanup', () => {
  const entry = (id: string, startedAt: string, extra: Partial<JournalEntry> = {}): JournalEntry => ({ id, file: id, startedAt, status: 'completed', note: '', ...extra });
  const journal = [entry('a', '2026-01-02'), entry('b', '2026-01-01', { up: 3 }), entry('c', '2026-01-03', { down: 2 })];
  const ids = (list: JournalEntry[]) => list.map((item) => item.id);

  it('sorts by date and by rating', () => {
    expect(ids(sortJournal(journal, 'date-desc'))).toEqual(['c', 'a', 'b']);
    expect(ids(sortJournal(journal, 'date-asc'))).toEqual(['b', 'a', 'c']);
    expect(ids(sortJournal(journal, 'rating-desc'))).toEqual(['b', 'a', 'c']);
    expect(ids(sortJournal(journal, 'rating-asc'))).toEqual(['c', 'a', 'b']);
  });

  it('removes only unrated records', () => {
    expect(isUnrated(entry('x', 'd', { up: 0, down: 0 }))).toBe(true);
    expect(ids(removeUnratedEntries(journal))).toEqual(['b', 'c']);
  });
});

describe('folder collapsing', () => {
  it('toggles a folder open and closed', () => {
    const state = addRunnerFolder({ folders: [], items: [] }, 'F');
    const id = state.folders[0]?.id ?? '';
    const closed = toggleRunnerFolder(state, id);
    expect(closed.folders[0]?.collapsed).toBe(true);
    expect(toggleRunnerFolder(closed, id).folders[0]?.collapsed).toBeUndefined();
  });
});

describe('sequences', () => {
  const empty: RunnerState = { folders: [], items: [] };
  const step = (file: string) => ({ file });

  it('adds, edits and ignores sequences without protocols', () => {
    const added = addRunnerSequence(empty, ' Night ', [step('a.vnp0'), { rest: 60 }, step('a.vnp0')], ' notes ');
    expect(added.items[0]).toMatchObject({ file: 'Night', description: 'notes', sequence: [step('a.vnp0'), { rest: 60 }, step('a.vnp0')] });
    expect(addRunnerSequence(empty, 'x', [{ rest: 5 }])).toBe(empty);
    const id = added.items[0]?.id as string;
    const edited = updateRunnerSequence(added, id, 'Day', [step('c.vnp0')]);
    expect(edited.items[0]).toMatchObject({ file: 'Day', sequence: [step('c.vnp0')] });
    expect(edited.items[0]?.description).toBeUndefined();
  });

  it('keeps sequence contents when moved and does not treat them as protocol files', () => {
    let state = addToRunner(empty, 'a.vnp0');
    state = addRunnerSequence(state, 'a.vnp0', [step('a.vnp0')]);
    state = addRunnerFolder(state, 'F');
    const sequence = state.items[1]?.id as string;
    const moved = moveRunnerItemToFolderEnd(state, sequence, state.folders[0]?.id);
    expect(moved.items.find((item) => item.id === sequence)?.sequence).toEqual([step('a.vnp0')]);
    expect(removeFromRunner(state, 'a.vnp0').items).toHaveLength(1);
    expect(removeRunnerItem(state, sequence).items.map((item) => item.file)).toEqual(['a.vnp0']);
  });

  it('renames protocols inside sequences and survives parsing', () => {
    const state = addRunnerSequence(empty, 'S', [step('a.vnp0'), { rest: 30 }, step('b.vnp0')]);
    const renamed = renameRunnerFile(state, 'a.vnp0', 'z.vnp0');
    expect(renamed.items[0]?.sequence).toEqual([step('z.vnp0'), { rest: 30 }, step('b.vnp0')]);
    expect(parseRunnerData({ runner: renamed, journal: [] }).runner.items[0]?.sequence).toEqual([step('z.vnp0'), { rest: 30 }, step('b.vnp0')]);
  });
});
