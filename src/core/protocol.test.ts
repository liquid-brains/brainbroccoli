import { describe, expect, it } from 'vitest';
import {
  calculateSweepDuration,
  calculateTotalDuration,
  createUniqueImportedFileName,
  createUniqueProtocolFileName,
  createEmptyProtocol,
  getProtocolModule,
  isProtocolFile,
  normalizePhase,
  parseProtocolJSON,
  prepareProtocolForSave,
  protocolDiagramRows,
  toUserProtocolFile,
} from './protocol';
import JSZip from 'jszip';
import { readProtocolArchive } from './protocol-archive';

describe('protocol helpers', () => {
  it('keeps the editor diagram in the supplied anatomical LED rows', () => {
    expect(protocolDiagramRows).toEqual([
      ['NL', 'NR'],
      ['L1', 'C1', 'R1'],
      ['L2', 'C2', 'R2'],
      ['L3', 'C3', 'R3'],
      ['C4'],
    ]);
  });

  it('creates the editor defaults with the NeuroPro module layout', () => {
    const protocol = createEmptyProtocol('example');

    expect(protocol.filename).toBe('example');
    expect(protocol.modules).toHaveLength(12);
    expect(protocol.modules?.[0]).toMatchObject({
      module_no: 1,
      active: false,
      moduleControl: { phase: 0, dutyCycle: 5 },
      freq: 40,
      power: 100,
      applyCross: false,
    });
  });

  it('parses JSON protocol objects and rejects non-object JSON', () => {
    expect(parseProtocolJSON('{"filename":"test"}').filename).toBe('test');
    expect(() => parseProtocolJSON('[]')).toThrow('JSON object');
    expect(() => parseProtocolJSON('null')).toThrow('JSON object');
    expect(() => parseProtocolJSON('{"modules":[null]}')).toThrow('module number');
  });

  it('normalizes legacy module controls to the device protocol format', () => {
    const protocol = parseProtocolJSON(JSON.stringify({
      modules: [{
        module_no: 7,
        moduleControl: { phase: 'B', freq: 50, power: 80 },
      }],
    }));

    expect(protocol.modules?.[0]).toMatchObject({
      moduleControl: { phase: 1, dutyCycle: 5 },
      freq: 50,
      power: 80,
      applyCross: false,
    });
  });

  it('accepts supported Vielight protocol file extensions', () => {
    expect(isProtocolFile('PROGRAM.VNP2')).toBe(true);
    expect(isProtocolFile('protocol.json')).toBe(true);
    expect(isProtocolFile('notes.txt')).toBe(false);
  });

  it('creates new protocol names without overwriting existing files', () => {
    expect(createUniqueProtocolFileName('new_protocol', '.vnp0', [
      'new_protocol_1.vnp0',
      'NEW_PROTOCOL_3.VNP0',
    ])).toBe('new_protocol_2.vnp0');
  });

  it('disambiguates imported files without changing unique names', () => {
    expect(createUniqueImportedFileName('folder/session.vnp0', [])).toBe('folder/session.vnp0');
    expect(createUniqueImportedFileName('session.vnp0', ['SESSION.VNP0', 'session__2.vnp0']))
      .toBe('session__3.vnp0');
  });

  it('returns an inactive default for modules omitted by older files', () => {
    expect(getProtocolModule({ modules: [] }, 4)).toMatchObject({
      module_no: 4,
      active: false,
      moduleControl: { phase: 0, dutyCycle: 5 },
      freq: 0,
      power: 0,
    });
  });

  it('calculates the longest configured protocol or module duration', () => {
    const protocol = createEmptyProtocol();
    protocol.frequency = { active: true, startFreq: 40, endFreq: 60, freqStepSize: 10, stepDuration: 60 };
    protocol.modules = [{ module_no: 1, active: true, activeRunTime: 3 }];

    expect(calculateTotalDuration(protocol)).toBe(3);
    expect(calculateTotalDuration(createEmptyProtocol())).toBeUndefined();
  });

  it('normalizes numeric and textual phase values', () => {
    expect(normalizePhase(1)).toBe('B');
    expect(normalizePhase('phase b')).toBe('B');
    expect(normalizePhase('0')).toBe('A');
  });

  it('loads supported protocol files from a ZIP archive', async () => {
    const archive = new JSZip();
    archive.file('folder-a/session.vnp0', '{"filename":"first"}');
    archive.file('folder-b/session.vnp0', '{"filename":"second"}');
    archive.file('C:/folder-c/session.vnp0', '{"filename":"third"}');
    archive.file('readme.txt', 'ignored');
    const contents = await archive.generateAsync({ type: 'uint8array' });

    await expect(readProtocolArchive(contents)).resolves.toEqual([
      { name: 'folder-a/session.vnp0', protocol: { filename: 'first' } },
      { name: 'folder-b/session.vnp0', protocol: { filename: 'second' } },
      { name: 'folder-c/session.vnp0', protocol: { filename: 'third' } },
    ]);
  });

  it('rejects ZIP entries with parent-directory paths', async () => {
    const archive = new JSZip();
    archive.file('../unsafe.vnp0', '{"filename":"unsafe"}');
    const contents = await archive.generateAsync({ type: 'uint8array' });

    await expect(readProtocolArchive(contents)).rejects.toThrow('unsafe file path');
  });

  it('rejects colliding ZIP paths before JSZip normalizes them', async () => {
    const archive = new JSZip();
    archive.file('../session.vnp0', '{"filename":"unsafe"}');
    archive.file('session.vnp0', '{"filename":"safe"}');
    const contents = await archive.generateAsync({ type: 'uint8array' });

    await expect(readProtocolArchive(contents)).rejects.toThrow('unsafe file path');
  });
});

describe('toUserProtocolFile', () => {
  it.each([['a/x.vnp1', 'a/x.vnp0'], ['x.vnp2', 'x.vnp0'], ['x.vnp3', 'x.vnp4']])('converts %s to %s', (from, to) => {
    const result = toUserProtocolFile(from, { ...createEmptyProtocol('x'), secretFile: true, defaultFile: true });
    expect(result.name).toBe(to);
    expect(result.protocol).toMatchObject({ secretFile: false, defaultFile: false, filename: 'x' });
  });

  it('leaves user files unchanged', () => {
    const protocol = { ...createEmptyProtocol('x'), secretFile: true };
    expect(toUserProtocolFile('x.vnp0', protocol)).toEqual({ name: 'x.vnp0', protocol });
  });
});

describe('calculateSweepDuration', () => {
  const base = createEmptyProtocol();
  it('derives minutes from an upward frequency sweep', () => {
    const protocol = { ...base, frequency: { active: true, startFreq: 10, endFreq: 20, freqStepSize: 5, stepDuration: 60 }, power: { active: false } };
    expect(calculateSweepDuration(protocol)).toBe(3);
  });
  it('ignores backward sweeps and inactive sweeps', () => {
    const backward = { ...base, frequency: { active: true, startFreq: 20, endFreq: 10, freqStepSize: 5, stepDuration: 60 }, power: { active: false } };
    expect(calculateSweepDuration(backward)).toBeUndefined();
    const negativeStep = { ...base, frequency: { active: true, startFreq: 10, endFreq: 20, freqStepSize: -5, stepDuration: 60 }, power: { active: false } };
    expect(calculateSweepDuration(negativeStep)).toBeUndefined();
    const off = { ...base, frequency: { active: false, startFreq: 10, endFreq: 20, freqStepSize: 5, stepDuration: 60 }, power: { active: false } };
    expect(calculateSweepDuration(off)).toBeUndefined();
  });
});

describe('prepareProtocolForSave', () => {
  const base = { ...createEmptyProtocol('x'), secretFile: true, defaultFile: true, usedByBatch: 5 };
  it('converts vnp1/vnp2 to vnp0 and vnp3 to vnp4 with cleared flags', () => {
    expect(prepareProtocolForSave('a.vnp1', base, []).name).toBe('a.vnp0');
    expect(prepareProtocolForSave('a.vnp2', base, []).name).toBe('a.vnp0');
    const batch = prepareProtocolForSave('b.vnp3', { ...base, filenames: ['a.vnp0'] }, []);
    expect(batch.name).toBe('b.vnp4');
    expect(batch.protocol).toMatchObject({ secretFile: false, defaultFile: false, usedByBatch: 0 });
  });
  it('sets usedByBatch only for stage files referenced by a batch', () => {
    const batch = { name: 'b.vnp4', protocol: { ...base, filenames: ['a.vnp0'] } };
    expect(prepareProtocolForSave('a.vnp0', base, [batch]).protocol.usedByBatch).toBe(1);
    expect(prepareProtocolForSave('c.vnp0', base, [batch]).protocol.usedByBatch).toBe(0);
  });
});

describe('prepareProtocolForSave batch references', () => {
  it('points converted stage references at the new vnp0 files', () => {
    const batch = { ...createEmptyProtocol('b'), filenames: ['a.vnp2', 'c.vnp0', 'd.vnp1'] };
    expect(prepareProtocolForSave('b.vnp3', batch, []).protocol.filenames).toEqual(['a.vnp0', 'c.vnp0', 'd.vnp0']);
  });
});
