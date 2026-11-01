import { createContext, createElement, Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import JSZip from 'jszip';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

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
  protocolDiagramRows,
  protocolModules,
  toUserProtocolFile,
  userCopyExtension,
} from './src/core/protocol';
import type { Protocol, ProtocolModule, ProtocolSection } from './src/core/protocol';
import { createNeuroPro2Device, downloadControllerFiles, runControllerProtocol, saveControllerFiles } from './src/core/device';
import {
  addRunnerFolder,
  addRunnerSequence,
  describeStep,
  isRestStep,
  sequenceFiles,
  updateRunnerSequence,
  addToRunner,
  createId,
  emptyRunnerData,
  formatClock,
  moveRunnerItemTo,
  nextThumbCount,
  removeUnratedEntries,
  isUnrated,
  sortJournal,
  summarizeProtocol,
  moveRunnerItemToFolderEnd,
  parseRunnerData,
  removeFromRunner,
  removeRunnerItem,
  removeRunnerFolder,
  renameRunnerFile,
  renameRunnerFolder,
  toggleRunnerFolder,
} from './src/core/runner';
import type { JournalEntry, JournalSort, JournalStatus, RunnerData, RunnerItem, RunnerState, SequenceStep } from './src/core/runner';
import { readProtocolArchive } from './src/core/protocol-archive';
import type { ProtocolFile } from './src/core/protocol-archive';

type EditorMode = 'global' | 'module' | 'all';
type SectionName = 'frequency' | 'power' | 'cross';
const fileGroups = [
  { extension: '.vnp0', label: 'User Protocols' },
  { extension: '.vnp4', label: 'User Batch Protocols' },
  { extension: '.vnp1', label: 'Vielight Basic Protocols' },
  { extension: '.vnp3', label: 'Gracefire Protocols' },
  { extension: '.vnp2', label: 'Extended Gracefire Protocols' },
  { extension: '.json', label: 'Legacy JSON' },
];
const batchStageCount = 8;

export default function App() {
  const { width } = useWindowDimensions();
  const wideSidebar = width >= 980;
  const wideEditor = width - (wideSidebar ? 300 : 0) >= 860;
  const [protocol, setProtocol] = useState<Protocol>(() => createEmptyProtocol());
  const [files, setFiles] = useState<Record<string, Protocol>>({});
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [currentFileName, setCurrentFileName] = useState('');
  const [mode, setMode] = useState<EditorMode>('global');
  const [selectedModule, setSelectedModule] = useState<number>(protocolModules[0].number);
  const [activeBatchStage, setActiveBatchStage] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ '.vnp0': true });
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchDraftName, setBatchDraftName] = useState('My_Batch');
  const [batchDraftStages, setBatchDraftStages] = useState<string[]>(Array(batchStageCount).fill(''));
  const [jsonExpanded, setJsonExpanded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  const [filenameDraft, setFilenameDraft] = useState('');
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloadPromptOpen, setDownloadPromptOpen] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState<string | null>(null);
  const [runnerData, setRunnerData] = useState<RunnerData>(emptyRunnerData);
  const [runnerLoaded, setRunnerLoaded] = useState(false);
  const dragId = useRef<string | undefined>(undefined);
  const [dropHint, setDropHint] = useState<{ id: string; after: boolean } | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderPromptOpen, setFolderPromptOpen] = useState(false);
  const [sequenceDraft, setSequenceDraft] = useState<{ id?: string; name: string; description: string; steps: SequenceStep[]; next: string; rest: string } | null>(null);
  const [journalExpanded, setJournalExpanded] = useState(false);
  const [journalSort, setJournalSort] = useState<JournalSort>('date-desc');
  const [confirmUnrated, setConfirmUnrated] = useState(false);
  const [journalView, setJournalView] = useState<{ id: string; kind: 'json' | 'diagram' } | null>(null);
  const [journalStage, setJournalStage] = useState(0);
  const [session, setSession] = useState<RunSession | null>(null);
  const [clock, setClock] = useState(Date.now());
  const runAbort = useRef<AbortController | null>(null);
  const systemScheme = useColorScheme();
  const scheme: Scheme = settings.useSystemColors ? (systemScheme === 'dark' ? 'dark' : 'light') : 'brand';
  const theme = useMemo(() => buildTheme(scheme), [scheme]);
  const { styles } = theme;

  const running = session !== null;
  useEffect(() => {
    if (!running) {
      return undefined;
    }
    void activateKeepAwakeAsync('protocol-run').catch(() => undefined);
    return () => { void deactivateKeepAwake('protocol-run').catch(() => undefined); };
  }, [running]);

  useEffect(() => {
    setFilenameDraft(splitFileName(currentFileName).base);
  }, [currentFileName]);

  useEffect(() => {
    void loadSettings().then(setSettings);
    void loadStoredFiles().then((saved) => {
      setFiles((current) => ({ ...saved, ...current }));
      setFilesLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!filesLoaded) {
      return undefined;
    }
    const timer = setTimeout(() => void persistFiles(files), 400);
    return () => clearTimeout(timer);
  }, [files, filesLoaded]);

  useEffect(() => {
    void loadStoredRunner().then((saved) => {
      setRunnerData((current) => (current.runner.items.length > 0 || current.journal.length > 0 ? current : saved));
      setRunnerLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!runnerLoaded) {
      return undefined;
    }
    const timer = setTimeout(() => void persistRunner(runnerData), 400);
    return () => clearTimeout(timer);
  }, [runnerData, runnerLoaded]);

  useEffect(() => {
    if (!session) {
      return undefined;
    }
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session !== null]);

  const appMode = settings.appMode;
  const setAppMode = (mode: AppMode): void => updateSettings({ appMode: mode });

  function updateSettings(change: Partial<Settings>): void {
    const next = { ...settings, ...change };
    setSettings(next);
    void persistSettings(next);
  }

  const isBatch = currentFileName.toLowerCase().endsWith('.vnp4') || protocol.filenames !== undefined;
  const stageFileName = isBatch ? protocol.filenames?.[activeBatchStage] : undefined;
  const displayedProtocol = useMemo(() => {
    if (!isBatch) {
      return protocol;
    }
    if (stageFileName && files[stageFileName]) {
      return files[stageFileName];
    }
    return createEmptyProtocol(stageFileName || `stage_${activeBatchStage + 1}`);
  }, [activeBatchStage, files, isBatch, protocol, stageFileName]);

  const fileReadOnly = isReadOnlyFile(currentFileName);
  const readOnly = fileReadOnly || (isBatch && stageFileName !== undefined && isReadOnlyFile(stageFileName));

  function updateDisplayedProtocol(update: (value: Protocol) => Protocol): void {
    if (readOnly) {
      return;
    }
    if (isBatch) {
      if (!stageFileName || !files[stageFileName]) {
        return;
      }
      const currentStage = files[stageFileName];
      setFiles((current) => ({ ...current, [stageFileName]: update(current[stageFileName] ?? currentStage) }));
      return;
    }
    setProtocol(update);
    if (currentFileName) {
      setFiles((current) => ({ ...current, [currentFileName]: update(current[currentFileName] ?? protocol) }));
    }
  }

  function loadProtocol(name: string, value: Protocol, keepSidebarOpen = false): void {
    setCurrentFileName(name);
    setProtocol(value);
    setMode('global');
    setSelectedModule(protocolModules[0].number);
    setActiveBatchStage(0);
    if (!keepSidebarOpen) {
      setSidebarOpen(false);
    }
    setError('');
  }

  function updateSection(sectionName: SectionName, key: string, value: unknown): void {
    updateDisplayedProtocol((current) => {
      const section = current[sectionName] as ProtocolSection | undefined;
      return { ...current, [sectionName]: { ...section, [key]: value } };
    });
  }

  function toggleSection(sectionName: SectionName): void {
    const section = displayedProtocol[sectionName] as ProtocolSection | undefined;
    const other = sectionName === 'frequency' ? displayedProtocol.power : sectionName === 'power' ? displayedProtocol.frequency : undefined;
    if (section?.active === false && other !== undefined && (other as ProtocolSection).active !== false) {
      return;
    }
    updateSection(sectionName, 'active', section?.active === false);
  }

  function keepSweepUpward(sectionName: 'frequency' | 'power', editedKey: string): void {
    const startKey = sectionName === 'frequency' ? 'startFreq' : 'startPower';
    const endKey = sectionName === 'frequency' ? 'endFreq' : 'endPower';
    updateDisplayedProtocol((current) => {
      const section = (current[sectionName] as ProtocolSection | undefined) ?? {};
      const start = Number(section[startKey]) || 0;
      const end = Number(section[endKey]) || 0;
      if (end >= start) {
        return current;
      }
      const fixed = editedKey === startKey ? { [startKey]: end } : { [endKey]: start };
      return { ...current, [sectionName]: { ...section, ...fixed } };
    });
  }

  function updateModule(moduleNumber: number, patch: Partial<ProtocolModule>): void {
    updateDisplayedProtocol((current) => {
      const module = getProtocolModule(current, moduleNumber);
      const modules = current.modules ?? [];
      const exists = modules.some((item) => item.module_no === moduleNumber);
      return {
        ...current,
        modules: exists
          ? modules.map((item) => item.module_no === moduleNumber ? { ...item, ...patch } : item)
          : [...modules, { ...module, ...patch }],
      };
    });
  }

  function updateModuleControl(moduleNumber: number, key: string, value: unknown): void {
    if (key === 'freq' || key === 'power') {
      updateModule(moduleNumber, { [key]: value } as Partial<ProtocolModule>);
      return;
    }
    const module = getProtocolModule(displayedProtocol, moduleNumber);
    updateModule(moduleNumber, {
      moduleControl: { ...module.moduleControl, [key]: value },
    });
  }

  function setBatchFile(stage: number, name: string): void {
    if (fileReadOnly) {
      return;
    }
    const filenames = [...(protocol.filenames ?? Array(batchStageCount).fill(''))];
    filenames[stage] = name;
    const updated = { ...protocol, filenames };
    setProtocol(updated);
    if (currentFileName) {
      setFiles((current) => ({ ...current, [currentFileName]: updated }));
    }
  }

  function createNewProtocol(): void {
    const name = createUniqueProtocolFileName('new_protocol', '.vnp0', Object.keys(files));
    const fresh = createEmptyProtocol(name.replace(/\.[^.]+$/, ''));
    setFiles((current) => ({ ...current, [name]: fresh }));
    loadProtocol(name, fresh);
  }

  function openBatchDialog(): void {
    setBatchDraftName('My_Batch');
    setBatchDraftStages(Array(batchStageCount).fill(''));
    setBatchDialogOpen(true);
  }

  function createBatch(): void {
    const base = stripFileNameChars(batchDraftName.trim().replace(/\.vnp4$/i, '')) || 'My_Batch';
    const name = createUniqueImportedFileName(`${base}.vnp4`, Object.keys(files));
    const fresh: Protocol = {
      ...createEmptyProtocol(name.replace(/\.vnp4$/i, '')),
      single: false,
      filenames: batchDraftStages,
    };
    setFiles((current) => ({ ...current, [name]: fresh }));
    setBatchDialogOpen(false);
    loadProtocol(name, fresh);
  }

  function splitFileName(name: string): { directory: string; base: string; extension: string } {
    const leafStart = name.lastIndexOf('/') + 1;
    const leaf = name.slice(leafStart);
    const dot = leaf.lastIndexOf('.');
    return { directory: name.slice(0, leafStart), base: dot > 0 ? leaf.slice(0, dot) : leaf, extension: dot > 0 ? leaf.slice(dot) : '' };
  }

  function copyToEditable(name: string): void {
    const source = files[name];
    if (!source || !userCopyExtension(name)) {
      return;
    }
    const converted = toUserProtocolFile(name, JSON.parse(JSON.stringify(source)) as Protocol);
    const copyName = createUniqueImportedFileName(converted.name, Object.keys(files));
    const copy = copyName === converted.name ? converted.protocol : { ...converted.protocol, filename: splitFileName(copyName).base };
    setFiles((current) => ({ ...current, [copyName]: copy }));
    setExpandedGroups((current) => ({ ...current, [splitFileName(copyName).extension]: true }));
    loadProtocol(copyName, copy, true);
  }

  function copyUserFile(name: string): void {
    const source = files[name];
    if (!source || isReadOnlyFile(name)) {
      return;
    }
    const copyName = createUniqueImportedFileName(name, Object.keys(files));
    const copy = { ...(JSON.parse(JSON.stringify(source)) as Protocol), filename: splitFileName(copyName).base };
    setFiles((current) => ({ ...current, [copyName]: copy }));
    setExpandedGroups((current) => ({ ...current, [splitFileName(copyName).extension]: true }));
    loadProtocol(copyName, copy, true);
  }

  function renameFile(text: string): void {
    if (!currentFileName || fileReadOnly) {
      return;
    }
    const { directory, extension } = splitFileName(currentFileName);
    let base = text.trim();
    if (extension && base.toLowerCase().endsWith(extension.toLowerCase())) {
      base = base.slice(0, -extension.length);
    }
    base = stripFileNameChars(base);
    const name = `${directory}${base}${extension}`;
    if (base === '' || name === currentFileName) {
      return;
    }
    const others = Object.keys(files).filter((existing) => existing !== currentFileName);
    const unique = createUniqueImportedFileName(name, others);
    const original = files[currentFileName] ?? protocol;
    const renamed = original.filename !== undefined || isBatch ? { ...original, filename: splitFileName(unique).base } : original;
    const oldName = currentFileName;
    setFiles((current) => {
      const next: Record<string, Protocol> = {};
      for (const [fileName, value] of Object.entries(current)) {
        if (fileName === oldName) {
          continue;
        }
        const stages = value.filenames;
        next[fileName] = stages?.includes(oldName) ? { ...value, filenames: stages.map((stage) => (stage === oldName ? unique : stage)) } : value;
      }
      next[unique] = renamed;
      return next;
    });
    setCurrentFileName(unique);
    setProtocol(renamed);
    setRunnerData((current) => ({ ...current, runner: renameRunnerFile(current.runner, oldName, unique) }));
  }

  async function readAssetBytes(asset: DocumentPicker.DocumentPickerAsset): Promise<Uint8Array> {
    if (asset.file) {
      return new Uint8Array(await asset.file.arrayBuffer());
    }
    const encoded = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const binary = atob(encoded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function readAssetText(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
    if (asset.file) {
      return asset.file.text();
    }
    const bytes = await readAssetBytes(asset);
    return decodeUtf8(bytes);
  }

  async function importAsset(asset: DocumentPicker.DocumentPickerAsset): Promise<ProtocolFile[]> {
    if (/\.zip$/i.test(asset.name)) {
      return (await readProtocolArchive(await readAssetBytes(asset))).map(({ name, protocol: value }) => toUserProtocolFile(name, value));
    }
    if (!isProtocolFile(asset.name)) {
      return [];
    }
    return [toUserProtocolFile(asset.name, parseProtocolJSON(await readAssetText(asset)))];
  }

  async function importFiles(): Promise<void> {
    setError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: Platform.OS === 'web' ? ['.vnp0', '.vnp1', '.vnp2', '.vnp3', '.vnp4', '.zip'] : '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }
      setBusy(true);
      const imported: ProtocolFile[] = [];
      for (const [index, asset] of result.assets.entries()) {
        setStatus(`Reading ${asset.name} (${index + 1} of ${result.assets.length})…`);
        imported.push(...await importAsset(asset));
        setStatus(`Read ${asset.name}: ${imported.length} protocol file${imported.length === 1 ? '' : 's'} found so far`);
      }
      setStatus(`Adding ${imported.length} file${imported.length === 1 ? '' : 's'} to the editor…`);
      if (imported.length === 0) {
        setError('No supported .vnp or JSON protocol files were found.');
        return;
      }
      const firstImported = imported[0];
      if (!firstImported) {
        return;
      }
      const importedNames = new Set(Object.keys(files).map((name) => name.toLowerCase()));
      const uniquelyNamedFiles = imported.map(({ name, protocol: value }) => {
        const uniqueName = createUniqueImportedFileName(name, importedNames);
        importedNames.add(uniqueName.toLowerCase());
        return { name: uniqueName, protocol: value };
      });
      const firstUniqueFile = uniquelyNamedFiles[0];
      if (!firstUniqueFile) {
        return;
      }
      const nextFiles = Object.fromEntries(uniquelyNamedFiles.map(({ name, protocol: value }) => [name, value]));
      setFiles((current) => ({ ...current, ...nextFiles }));
      setExpandedGroups((current) => {
        const next = { ...current };
        uniquelyNamedFiles.forEach(({ name }) => {
          const group = fileGroups.find(({ extension }) => name.toLowerCase().endsWith(extension));
          if (group) {
            next[group.extension] = true;
          }
        });
        return next;
      });
      loadProtocol(firstUniqueFile.name, firstUniqueFile.protocol, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to import the selected files.');
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  async function saveProtocol(): Promise<void> {
    setError('');
    try {
      const batch = isBatch;
      const importedName = currentFileName.split('/').pop() ?? '';
      const baseName = stripFileNameChars(importedName.replace(/\.[^.]+$/, '') || String(protocol.filename || 'protocol'));
      const outputName = `${baseName}${splitFileName(currentFileName).extension || (batch ? '.vnp4' : '.vnp0')}`;
      const contents = JSON.stringify(batch ? protocol : displayedProtocol, null, 2);
      const stageNames = batch
        ? Array.from(new Set((protocol.filenames ?? []).filter((stage) => stage !== '' && stage !== currentFileName && files[stage] !== undefined)))
        : [];
      if (stageNames.length > 0) {
        const archive = new JSZip();
        archive.file(outputName, contents);
        stageNames.forEach((stage) => archive.file(stage, JSON.stringify(files[stage], null, 2)));
        await shareArchive(archive, `${baseName}.zip`, 'Save batch protocol');
        return;
      }
      if (Platform.OS === 'web') {
        downloadBlob(new Blob([contents], { type: 'application/json' }), outputName);
        return;
      }
      if (!FileSystem.cacheDirectory) {
        throw new Error('Temporary file storage is unavailable on this device.');
      }
      const uri = `${FileSystem.cacheDirectory}${outputName}`;
      await FileSystem.writeAsStringAsync(uri, contents, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Save protocol' });
      } else {
        throw new Error('File sharing is not available on this device.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save this protocol.');
    }
  }

  async function saveToController(): Promise<void> {
    const name = currentFileName;
    if (!/\.vnp[04]$/i.test(name)) {
      return;
    }
    const stages = isBatch
      ? Array.from(new Set((protocol.filenames ?? []).filter((stage) => /\.vnp0$/i.test(stage) && files[stage] !== undefined)))
      : [];
    const uploads = [
      ...stages.map((stage) => ({ name: stage, protocol: files[stage] as Protocol })),
      { name, protocol: isBatch ? protocol : displayedProtocol },
    ];
    setError('');
    setBusy(true);
    try {
      setStatus(`Connecting to ${settings.deviceAddress}…`);
      await saveControllerFiles(connectToController(), uploads, setStatus);
      setStatus(`Saved ${uploads.length === 1 ? name : `${name} and ${uploads.length - 1} stage file${uploads.length === 2 ? '' : 's'}`} to the controller.`);
    } catch (reason) {
      setError(`Unable to save to ${settings.deviceAddress}: ${reason instanceof Error ? reason.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  function connectToController(): ReturnType<typeof createNeuroPro2Device> {
    const bridge = (globalThis as { brainBroccoliDevice?: { request: (url: string) => Promise<{ ok: boolean; status: number; body: string }> } }).brainBroccoliDevice;
    return createNeuroPro2Device(settings.deviceAddress, bridge ? {
      fetch: async (url: URL) => {
        const { ok, status, body } = await bridge.request(String(url));
        return { ok, status, text: async () => body, json: async () => JSON.parse(body) as unknown };
      },
    } : {});
  }

  async function removeFromController(name: string): Promise<boolean> {
    setError('');
    setBusy(true);
    try {
      setStatus(`Deleting ${name} from ${settings.deviceAddress}…`);
      await connectToController().deleteFile(name);
      setStatus(`Deleted ${name} from the controller.`);
      return true;
    } catch (reason) {
      setError(`Unable to delete ${name} from ${settings.deviceAddress}: ${reason instanceof Error ? reason.message : 'unknown error'}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function downloadFromController(wipe: boolean): Promise<void> {
    setDownloadPromptOpen(false);
    setError('');
    setBusy(true);
    try {
      const device = connectToController();
      setStatus(`Connecting to ${settings.deviceAddress}…`);
      const downloaded = await downloadControllerFiles(device, setStatus, wipe ? [] : Object.keys(files));
      if (downloaded.length === 0) {
        setError(wipe ? 'No protocol files were found on the controller; your files were kept.' : 'No new protocol files were found on the controller.');
        return;
      }
      const nextFiles = Object.fromEntries(downloaded.map(({ name, protocol: value }) => [name, value]));
      setFiles((current) => (wipe ? nextFiles : { ...current, ...nextFiles }));
      setExpandedGroups((current) => {
        const next = { ...current };
        downloaded.forEach(({ name }) => {
          const group = fileGroups.find(({ extension }) => name.toLowerCase().endsWith(extension));
          if (group) {
            next[group.extension] = true;
          }
        });
        return next;
      });
      const first = downloaded[0];
      if (first) {
        loadProtocol(first.name, first.protocol, true);
      }
    } catch (reason) {
      setError(`Unable to download files from ${settings.deviceAddress}: ${reason instanceof Error ? reason.message : 'unknown error'}`);
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  async function shareArchive(archive: JSZip, archiveName: string, dialogTitle: string): Promise<void> {
    if (Platform.OS === 'web') {
      downloadBlob(await archive.generateAsync({ type: 'blob' }), archiveName);
      return;
    }
    if (!FileSystem.cacheDirectory) {
      throw new Error('Temporary file storage is unavailable on this device.');
    }
    const encoded = await archive.generateAsync({ type: 'base64' });
    const uri = `${FileSystem.cacheDirectory}${archiveName}`;
    await FileSystem.writeAsStringAsync(uri, encoded, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/zip', dialogTitle });
    } else {
      throw new Error('File sharing is not available on this device.');
    }
  }

  async function exportZip(): Promise<void> {
    setError('');
    try {
      const archive = new JSZip();
      const entries = { ...files };
      if (currentFileName) {
        entries[currentFileName] = protocol;
      }
      Object.entries(entries).forEach(([name, value]) => {
        archive.file(name, JSON.stringify(value, null, 2));
      });
      await shareArchive(archive, 'brain-broccoli-protocols.zip', 'Export protocols');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to export the protocol archive.');
    }
  }

  function requestDelete(name: string): void {
    if (isReadOnlyFile(name)) {
      return;
    }
    setDeletePrompt(name);
  }

  async function deleteFile(name: string, alsoOnController: boolean): Promise<void> {
    setDeletePrompt(null);
    if (isReadOnlyFile(name)) {
      return;
    }
    if (alsoOnController && !(await removeFromController(name))) {
      return;
    }
    setFiles((current) => {
      const remaining = { ...current };
      delete remaining[name];
      return remaining;
    });
    setRunnerData((current) => ({ ...current, runner: removeFromRunner(current.runner, name) }));
    if (currentFileName === name) {
      setCurrentFileName('');
      setProtocol(createEmptyProtocol());
    }
  }

  function updateRunner(change: (state: RunnerState) => RunnerState): void {
    setRunnerData((current) => ({ ...current, runner: change(current.runner) }));
  }

  function updateJournalEntry(id: string, change: Partial<JournalEntry>): void {
    setRunnerData((current) => ({ ...current, journal: current.journal.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)) }));
  }

  function runnerDurationMinutes(name: string): number | undefined {
    const value = files[name];
    return value ? calculateTotalDuration(value) : undefined;
  }

  function itemFiles(item: RunnerItem): string[] {
    return item.sequence === undefined ? [item.file] : sequenceFiles(item.sequence);
  }

  function itemMinutes(item: RunnerItem): number | undefined {
    const steps: SequenceStep[] = item.sequence ?? [{ file: item.file }];
    const total = steps.reduce((sum, step) => sum + (isRestStep(step) ? step.rest / 60 : runnerDurationMinutes(step.file) ?? 0), 0);
    return total > 0 ? total : undefined;
  }

  function itemProblem(item: RunnerItem): string | undefined {
    for (const name of itemFiles(item)) {
      const value = files[name];
      if (!value) {
        return `${name} is not in the app.`;
      }
      if (value.filenames !== undefined) {
        return `${name} is a batch. Batches cannot be run directly; add its protocols to a sequence instead.`;
      }
    }
    return undefined;
  }

  function runnerSummary(item: RunnerItem): string {
    if (item.sequence !== undefined) {
      const minutes = itemMinutes(item);
      return [`Sequence of ${item.sequence.length} step(s): ${item.sequence.map(describeStep).join(', ')}`, ...(minutes === undefined ? [] : [`${Math.round(minutes * 10) / 10} min`])].join(' · ');
    }
    const value = files[item.file];
    return value ? summarizeProtocol(value) : '';
  }

  function runnerSnapshot(item: RunnerItem): { protocol?: Protocol; stages?: Record<string, Protocol> } {
    if (item.sequence === undefined) {
      const value = files[item.file];
      return value ? { protocol: structuredClone(value) } : {};
    }
    const stages: Record<string, Protocol> = {};
    for (const name of sequenceFiles(item.sequence)) {
      const stageProtocol = files[name];
      if (stageProtocol !== undefined) {
        stages[name] = stageProtocol;
      }
    }
    return { protocol: { ...createEmptyProtocol(item.file), filenames: sequenceFiles(item.sequence) }, stages: structuredClone(stages) };
  }

  function waitWhileResting(seconds: number, signal: AbortSignal, onTick: (secondsLeft: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const end = Date.now() + seconds * 1000;
      const timer = setInterval(() => {
        const left = Math.ceil((end - Date.now()) / 1000);
        if (signal.aborted || left <= 0) {
          clearInterval(timer);
          resolve();
          return;
        }
        onTick(left);
      }, 250);
    });
  }

  async function startRun(item: RunnerItem): Promise<void> {
    const steps: SequenceStep[] = item.sequence ?? [{ file: item.file }];
    const problem = itemProblem(item);
    if (session) {
      return;
    }
    if (problem !== undefined) {
      setError(problem);
      return;
    }
    const label = item.file;
    const entryId = createId('journal');
    const minutes = itemMinutes(item);
    const controller = new AbortController();
    runAbort.current = controller;
    setError('');
    setClock(Date.now());
    setSession({ file: label, entryId, message: `Connecting to ${settings.deviceAddress}…`, totalSeconds: minutes === undefined ? undefined : minutes * 60 });
    setRunnerData((current) => ({
      ...current,
      journal: [{ id: entryId, file: label, startedAt: new Date().toISOString(), status: 'running', note: '', summary: runnerSummary(item), ...runnerSnapshot(item) }, ...current.journal],
    }));
    let outcome: JournalStatus = 'completed';
    const device = connectToController();
    let current = '';
    try {
      for (const [index, step] of steps.entries()) {
        if (controller.signal.aborted) {
          throw new Error('stopped');
        }
        const prefix = item.sequence === undefined ? '' : `Step ${index + 1} of ${steps.length}: ${describeStep(step)} · `;
        if (isRestStep(step)) {
          current = 'rest interval';
          setSession((state) => (state ? { ...state, startedAt: state.startedAt ?? Date.now(), message: `${prefix}Resting` } : state));
          await waitWhileResting(step.rest, controller.signal, (left) => setSession((state) => (state ? { ...state, message: `${prefix}${left}s left` } : state)));
          continue;
        }
        const name = step.file;
        current = name;
        await runControllerProtocol(
          device,
          name,
          controller.signal,
          (message) => setSession((state) => (state ? { ...state, message: `${prefix}${message}` } : state)),
          () => {
            setSession((state) => (state ? { ...state, startedAt: state.startedAt ?? Date.now(), message: `${prefix}Protocol running` } : state));
          },
        );
      }
    } catch (reason) {
      if (controller.signal.aborted) {
        outcome = 'stopped';
      } else {
        outcome = 'failed';
        setError(`Unable to run ${current || label} on ${settings.deviceAddress}: ${reason instanceof Error ? reason.message : 'unknown error'}`);
      }
    } finally {
      runAbort.current = null;
      setSession(null);
      updateJournalEntry(entryId, { status: outcome });
    }
  }

  function stopRun(): void {
    runAbort.current?.abort();
    setSession((current) => (current ? { ...current, message: 'Stopping…' } : current));
    void connectToController().stop().catch(() => undefined);
  }

  function renderRunStatus(): React.JSX.Element | null {
    if (!session) {
      return null;
    }
    const elapsed = session.startedAt === undefined ? 0 : (clock - session.startedAt) / 1000;
    const progress = session.totalSeconds ? Math.min(1, elapsed / session.totalSeconds) : undefined;
    return (
      <View accessibilityLiveRegion="polite" style={styles.panel}>
        <Text style={styles.panelTitle}>Running</Text>
        <Text style={styles.runnerTitle}>{session.file}</Text>
        <View style={styles.runnerButtons}>
          <ActivityIndicator color="#f9a01b" />
          <Text style={styles.statusText}>{session.message}</Text>
        </View>
        {session.startedAt !== undefined && (
          <>
            {progress !== undefined && (
              <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} /></View>
            )}
            <Text style={styles.runnerMeta}>
              Elapsed {formatClock(elapsed)}{session.totalSeconds ? ` of ${formatClock(session.totalSeconds)} · ${formatClock(session.totalSeconds - elapsed)} remaining` : ''}
            </Text>
          </>
        )}
        <ActionButton title="⏹ STOP" onPress={stopRun} />
      </View>
    );
  }

  function describeRunnerItem(item: RunnerItem): string {
    const problem = itemProblem(item);
    if (problem !== undefined) {
      return problem;
    }
    const minutes = itemMinutes(item);
    const length = minutes === undefined ? '' : `${Math.round(minutes * 10) / 10} minute(s)`;
    if (item.sequence !== undefined) {
      return `Sequence · ${item.sequence.length} step(s)${length ? ` · ${length}` : ''}\n${item.description ? `${item.description}\n` : ''}${item.sequence.map(describeStep).join(' → ')}`;
    }
    return length || 'Duration not set';
  }

  function renderRunnerItem(item: RunnerItem): React.JSX.Element {
    const canRun = !session && itemProblem(item) === undefined;
    const hint = dropHint?.id === item.id ? dropHint.after : undefined;
    const row = (
      <View style={[styles.runnerRow, hint === false && styles.dropBefore, hint === true && styles.dropAfter]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.file} from the runner`} onPress={() => updateRunner((state) => removeRunnerItem(state, item.id))} style={styles.cardClose}>
          <Text style={styles.cardCloseText}>✕</Text>
        </Pressable>
        <Text style={styles.runnerTitle}>{Platform.OS === 'web' ? '⠿ ' : ''}{item.file}</Text>
        <Text style={styles.runnerMeta}>{describeRunnerItem(item)}</Text>
        <View style={styles.runnerButtons}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Run ${item.file}`} disabled={!canRun} onPress={() => { void startRun(item); }} style={[styles.actionButton, !canRun && styles.fieldDisabled]}>
            <Text style={styles.actionText}>▶ RUN</Text>
          </Pressable>
          {item.sequence !== undefined && (
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit sequence ${item.file}`} disabled={!!session} onPress={() => setSequenceDraft({ id: item.id, name: item.file, description: item.description ?? '', steps: [...(item.sequence ?? [])], next: '', rest: '60' })} style={[styles.actionButton, !!session && styles.fieldDisabled]}>
              <Text style={styles.actionText}>EDIT</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
    if (Platform.OS !== 'web') {
      return <Fragment key={item.id}>{row}</Fragment>;
    }
    return createElement(
      'div',
      {
        key: item.id,
        draggable: true,
        style: { cursor: 'grab' },
        onDragStart: (event: DragEvent) => {
          event.stopPropagation();
          event.dataTransfer?.setData('text/plain', item.id);
          dragId.current = item.id;
        },
        onDragEnd: () => { dragId.current = undefined; setDropHint(undefined); },
        onDragOver: (event: DragEvent) => {
          if (dragId.current === undefined) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
          const after = event.clientY > box.top + box.height / 2;
          setDropHint((current) => (current?.id === item.id && current.after === after ? current : { id: item.id, after }));
        },
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          event.stopPropagation();
          const moving = dragId.current;
          const after = dropHint?.id === item.id ? dropHint.after : false;
          dragId.current = undefined;
          setDropHint(undefined);
          if (moving) {
            updateRunner((state) => moveRunnerItemTo(state, moving, item.id, after));
          }
        },
      },
      row,
    );
  }

  function folderDropProps(folderId: string | undefined): Record<string, unknown> {
    if (Platform.OS !== 'web') {
      return {};
    }
    return {
      onDragOver: (event: DragEvent) => { if (dragId.current !== undefined) { event.preventDefault(); } },
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        const moving = dragId.current;
        dragId.current = undefined;
        setDropHint(undefined);
        if (moving) {
          updateRunner((state) => moveRunnerItemToFolderEnd(state, moving, folderId));
        }
      },
    };
  }

  function renderRunner(): React.JSX.Element {
    const { runner, journal } = runnerData;
    const runnerWide = width >= 860;
    const knownFolder = (item: RunnerItem) => item.folderId !== undefined && runner.folders.some((folder) => folder.id === item.folderId);
    const shownJournal = journalExpanded ? sortJournal(journal, journalSort) : journal.slice(0, 3);
    const unratedCount = journal.filter(isUnrated).length;
    const sortOption = (kind: 'date' | 'rating', label: string) => {
      const active = journalSort.startsWith(kind);
      const descending = journalSort === `${kind}-desc`;
      return (
        <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setJournalSort(active && descending ? `${kind}-asc` : `${kind}-desc`)} style={[styles.thumbButton, active && styles.thumbUp]}>
          <Text style={styles.runnerButtonText}>{label}{active ? (descending ? ' ▼' : ' ▲') : ''}</Text>
        </Pressable>
      );
    };
    return (
      <ScrollView contentContainerStyle={styles.workspace}>
        {!wideSidebar && <View style={styles.runnerBrand}>
          <Image accessibilityLabel="Brain Broccoli logo" source={require('./assets/brain-broccoli.png')} resizeMode="contain" style={styles.mobileLogo as ImageStyle} />
          <Text style={styles.brandCaption}>Device: {settings.deviceAddress}</Text>
        </View>}
        <View style={[styles.editorLayout, runnerWide && styles.editorLayoutWide]}>
          <View style={[styles.rightColumn, runnerWide && styles.rightColumnWide]}>
            {renderRunStatus()}
            <View style={styles.runnerPanel}>
              <Text style={styles.panelTitle}>Protocols</Text>
              <View style={styles.runnerButtons}>
                <ActionButton title="NEW FOLDER" onPress={() => { setNewFolderName(''); setFolderPromptOpen(true); }} />
                <ActionButton title="NEW SEQUENCE" onPress={() => setSequenceDraft({ name: '', description: '', steps: [], next: '', rest: '60' })} />
              </View>
              {runner.items.length === 0 && (
                <Text style={styles.runnerEmpty}>No protocols yet. Press ☆ next to a file in the file list to add it here, or create a sequence to run several protocols in order.</Text>
              )}
              {runner.folders.map((folder) => (
                <DropZone key={folder.id} props={folderDropProps(folder.id)}>
                <View style={styles.runnerFolder}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Delete folder ${folder.name}`} onPress={() => updateRunner((state) => removeRunnerFolder(state, folder.id))} style={styles.cardClose}>
                    <Text style={styles.cardCloseText}>✕</Text>
                  </Pressable>
                  <View style={[styles.runnerButtons, { paddingRight: 28 }]}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`${folder.collapsed === true ? 'Expand' : 'Collapse'} folder ${folder.name}`} accessibilityState={{ expanded: folder.collapsed !== true }} onPress={() => updateRunner((state) => toggleRunnerFolder(state, folder.id))} style={styles.thumbButton}>
                      <Text style={styles.runnerButtonText}>{folder.collapsed === true ? '▶' : '▼'}</Text>
                    </Pressable>
                    <TextInput
                      accessibilityLabel="Folder name"
                      value={folder.name}
                      onChangeText={(text) => updateRunner((state) => renameRunnerFolder(state, folder.id, text))}
                      style={[styles.textInput, styles.runnerInput]}
                    />
                  </View>
                  {folder.collapsed === true
                    ? <Text style={styles.runnerMeta}>{runner.items.filter((item) => item.folderId === folder.id).length} protocol(s) hidden</Text>
                    : runner.items.filter((item) => item.folderId === folder.id).map((item) => renderRunnerItem(item))}
                  {folder.collapsed !== true && runner.items.every((item) => item.folderId !== folder.id) && <Text style={styles.runnerMeta}>Empty folder. Drag a protocol here.</Text>}
                </View>
                </DropZone>
              ))}
              <DropZone props={folderDropProps(undefined)}>
                {runner.items.filter((item) => !knownFolder(item)).map((item) => renderRunnerItem(item))}
              </DropZone>
            </View>
          </View>
          <View style={[styles.rightColumn, runnerWide && styles.rightColumnWide]}>
            <View style={styles.runnerPanel}>
              <Text style={styles.panelTitle}>Journal</Text>
              {journal.length === 0 && <Text style={styles.runnerEmpty}>Protocols you run are recorded here so you can rate them and write down how they went.</Text>}
              {journalExpanded && journal.length > 0 && (
                <View style={styles.runnerFolder}>
                  <Text style={styles.runnerTitle}>All journal records</Text>
                  <View style={styles.runnerButtons}>
                    <Text style={styles.runnerMeta}>Sort by</Text>
                    {sortOption('date', journalSort === 'date-asc' ? 'Date (oldest first)' : 'Date (newest first)')}
                    {sortOption('rating', journalSort === 'rating-asc' ? 'Rating (lowest first)' : 'Rating (highest first)')}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={unratedCount === 0}
                    onPress={() => {
                      if (!confirmUnrated) {
                        setConfirmUnrated(true);
                        return;
                      }
                      setConfirmUnrated(false);
                      setRunnerData((current) => ({ ...current, journal: removeUnratedEntries(current.journal) }));
                    }}
                    onBlur={() => setConfirmUnrated(false)}
                    style={[styles.thumbButton, unratedCount === 0 && styles.fieldDisabled]}
                  >
                    <Text style={styles.deleteText}>{confirmUnrated ? `TAP AGAIN TO DELETE ${unratedCount} UNRATED` : `DELETE ALL UNRATED RECORDS (${unratedCount})`}</Text>
                  </Pressable>
                </View>
              )}
              {shownJournal.map((entry) => (
                <View key={entry.id} style={styles.runnerRow}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Delete journal record" onPress={() => setRunnerData((current) => ({ ...current, journal: current.journal.filter((other) => other.id !== entry.id) }))} style={styles.cardClose}>
                    <Text style={styles.cardCloseText}>✕</Text>
                  </Pressable>
                  <Text style={styles.runnerTitle}>{entry.file}</Text>
                  <Text style={styles.runnerMeta}>Started {new Date(entry.startedAt).toLocaleString()} · {entry.status}</Text>
                  {entry.summary ? <Text style={styles.runnerMeta}>{entry.summary}</Text> : null}
                  <View style={styles.runnerButtons}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Thumbs up" onPress={() => updateJournalEntry(entry.id, { up: nextThumbCount(entry.up), down: 0 })} style={[styles.thumbButton, (entry.up ?? 0) > 0 && styles.thumbUp]}>
                      <Text style={styles.runnerButtonText}>{'👍'.repeat(Math.max(1, entry.up ?? 0))}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Thumbs down" onPress={() => updateJournalEntry(entry.id, { down: nextThumbCount(entry.down), up: 0 })} style={[styles.thumbButton, (entry.down ?? 0) > 0 && styles.thumbDown]}>
                      <Text style={styles.runnerButtonText}>{'👎'.repeat(Math.max(1, entry.down ?? 0))}</Text>
                    </Pressable>
                    {entry.protocol && (
                      <Pressable accessibilityRole="button" accessibilityLabel="View diagram and protocol summary of this run" onPress={() => { setJournalStage(0); setJournalView({ id: entry.id, kind: 'diagram' }); }} style={styles.thumbButton}>
                        <Text style={styles.runnerButtonText}>VIEW PROTOCOL</Text>
                      </Pressable>
                    )}
                    {entry.protocol && settings.showJson && (
                      <Pressable accessibilityRole="button" accessibilityLabel="View the JSON code of this run" onPress={() => setJournalView({ id: entry.id, kind: 'json' })} style={styles.thumbButton}>
                        <Text style={styles.runnerButtonText}>VIEW JSON</Text>
                      </Pressable>
                    )}
                  </View>
                  <TextInput
                    accessibilityLabel="Journal entry"
                    multiline
                    placeholder="Journal entry: how did it go?"
                    placeholderTextColor="#94a3b8"
                    value={entry.note}
                    onChangeText={(text) => updateJournalEntry(entry.id, { note: text })}
                    style={[styles.textInput, styles.noteInput]}
                  />
                </View>
              ))}
              {journal.length > 3 && (
                <ActionButton title={journalExpanded ? 'SHOW RECENT RECORDS ONLY' : `VIEW ALL ${journal.length} JOURNAL RECORDS`} onPress={() => setJournalExpanded((value) => !value)} />
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    );
  }

  function renderFileList(): React.JSX.Element {
    return (
      <View style={styles.fileList}>
        {fileGroups.map((group) => {
          const names = Object.keys(files)
            .filter((name) => name.toLowerCase().endsWith(group.extension))
            .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
          if (names.length === 0) {
            return null;
          }
          const expanded = expandedGroups[group.extension] === true;
          return (
            <View key={group.extension} style={styles.fileGroup}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setExpandedGroups((current) => ({ ...current, [group.extension]: !expanded }))}
              >
                <Text style={styles.groupTitle}>{expanded ? '▼' : '▶'} {group.label}</Text>
              </Pressable>
              {expanded && names.map((name) => (
                <View key={name} style={styles.fileRow}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      if (appMode === 'runner') {
                        if (files[name]?.filenames !== undefined) {
                          return;
                        }
                        updateRunner((state) => (state.items.some((item) => item.sequence === undefined && item.file === name) ? removeFromRunner(state, name) : addToRunner(state, name)));
                        return;
                      }
                      const selected = files[name];
                      if (selected) {
                        loadProtocol(name, selected);
                      }
                    }}
                    style={[styles.fileButton, appMode === 'editor' && currentFileName === name && styles.selectedFile]}
                  >
                    <Text numberOfLines={1} style={styles.fileName}>{name}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={runnerData.runner.items.some((item) => item.sequence === undefined && item.file === name) ? `Remove ${name} from the runner` : files[name]?.filenames !== undefined ? `${name} is a batch; create a sequence to run it` : `Add ${name} to the runner`}
                    disabled={files[name]?.filenames !== undefined}
                    onPress={() => updateRunner((state) => (state.items.some((item) => item.sequence === undefined && item.file === name) ? removeFromRunner(state, name) : addToRunner(state, name)))}
                  >
                    <Text style={[styles.copyText, files[name]?.filenames !== undefined && styles.fieldDisabled]}>{runnerData.runner.items.some((item) => item.sequence === undefined && item.file === name) ? '★' : '☆'}</Text>
                  </Pressable>
                  {appMode === 'runner' ? null : isReadOnlyFile(name) ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Copy ${name} to an editable ${userCopyExtension(name)} file`} onPress={() => copyToEditable(name)}>
                      <Text style={styles.copyText}>⧉</Text>
                    </Pressable>
                  ) : (
                    <>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Copy ${name}`} onPress={() => copyUserFile(name)}>
                        <Text style={styles.copyText}>⧉</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${name}`} onPress={() => requestDelete(name)}>
                        <Text style={styles.deleteText}>✕</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              ))}
            </View>
          );
        })}
      </View>
    );
  }

  function renderActions(): React.JSX.Element {
    const run = (action: () => void) => () => {
      if (!wideSidebar) {
        setSidebarOpen(false);
      }
      action();
    };
    return (
      <View style={styles.menuItems}>
        {appMode === 'editor' && (
          <>
            <ActionButton menu title="📋 Create Batch" onPress={run(openBatchDialog)} />
            <ActionButton menu title="📄 New File" onPress={run(createNewProtocol)} />
            <ActionButton menu title="⬇️ Download Controller Files" onPress={run(() => setDownloadPromptOpen(true))} />
            <ActionButton menu title="🗜️ Export All as ZIP" onPress={run(() => { void exportZip(); })} />
          </>
        )}
        <ActionButton menu title="⚙️ Settings" onPress={run(() => setSettingsOpen(true))} />
      </View>
    );
  }

  function renderFileActions(): React.JSX.Element | null {
    if (currentFileName === '') {
      return null;
    }
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Save</Text>
        <View style={styles.fileActions}>
          <ActionButton title="💾 Save to Disk" onPress={() => { void saveProtocol(); }} />
          {!fileReadOnly && <ActionButton title="⧉ Make a Copy" onPress={() => copyUserFile(currentFileName)} />}
          {/\.vnp[04]$/i.test(currentFileName) && <ActionButton title="📥 Save to Controller" onPress={() => { void saveToController(); }} />}
          {/\.vnp[04]$/i.test(currentFileName) && <ActionButton title="🗑️ Delete" onPress={() => requestDelete(currentFileName)} />}
        </View>
      </View>
    );
  }

  function renderBrand(): React.JSX.Element {
    if (!wideSidebar) {
      return <Image accessibilityLabel="Brain Broccoli logo" source={require('./assets/brain-broccoli.png')} resizeMode="contain" style={styles.mobileLogo as ImageStyle} />;
    }
    return (
      <View style={styles.brand}>
        <Image accessibilityLabel="Brain Broccoli logo" source={require('./assets/brain-broccoli.png')} resizeMode="contain" style={styles.logo as ImageStyle} />
        <Text style={styles.brandCaption}>Vielight Neuro Pro 2 Protocol {appMode === 'runner' ? 'Runner' : 'Editor'}</Text>
      </View>
    );
  }

  const canDrop = Platform.OS === 'web' && wideSidebar;

  const sidebar = (
    <View style={styles.sidebar}>
      {wideSidebar && renderBrand()}
      <View style={styles.sidebarActions}>
        {wideSidebar && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: !menuCollapsed }}
            onPress={() => setMenuCollapsed((collapsed) => !collapsed)}
            style={styles.menuHeader}
          >
            <Text style={styles.menuHeaderText}>{menuCollapsed ? '▶' : '▼'} Menu</Text>
          </Pressable>
        )}
        {(!wideSidebar || !menuCollapsed) && renderActions()}
      </View>
      {appMode === 'editor' && (
        <Pressable accessibilityRole="button" onPress={importFiles} disabled={busy} style={styles.uploadButton}>
          <Text style={styles.uploadTitle}>{busy ? 'Importing…' : canDrop ? 'Drop Vielight JSON files or zipped JSON files' : 'Import protocol files'}</Text>
          <Text style={styles.uploadHint}>{canDrop ? 'Click to browse files' : 'Tap to choose .vnp or .zip files'}</Text>
        </Pressable>
      )}
      <ScrollView style={[styles.fileScroll, appMode === 'runner' && { paddingTop: 14 }]}>{renderFileList()}</ScrollView>
    </View>
  );

  const currentModule = getProtocolModule(displayedProtocol, selectedModule);
  const moduleControl = currentModule.moduleControl ?? {};
  const phase = normalizePhase(moduleControl.phase ?? 'A');
  const duration = calculateTotalDuration(displayedProtocol);
    const availableStageFiles = Object.keys(files).filter((name) => !name.toLowerCase().endsWith('.vnp4'));

  function renderDurationBar(): React.JSX.Element {
    return (
      <View style={styles.durationBar}>
        <Text style={styles.durationBarText}>Total Protocol Duration: {duration === undefined ? 'Not specified' : `${duration} minutes`}</Text>
      </View>
    );
  }

  function renderGlobalFields(sectionName: 'frequency' | 'power'): React.JSX.Element {
    const section = (displayedProtocol[sectionName] as ProtocolSection | undefined) ?? {};
    const isFrequency = sectionName === 'frequency';
    const label = isFrequency ? 'Frequency sweep' : 'Power sweep';
    const otherSection = (displayedProtocol[isFrequency ? 'power' : 'frequency'] as ProtocolSection | undefined) ?? {};
    const otherActive = otherSection.active !== false;
    const entries: [string, string, string][] = isFrequency
      ? [
          ['Start frequency', 'startFreq', 'Hz'],
          ['End frequency', 'endFreq', 'Hz'],
          ['Step size', 'freqStepSize', 'Hz'],
          ['Step duration', 'stepDuration', 'sec'],
        ]
      : [
          ['Start power', 'startPower', '%'],
          ['End power', 'endPower', '%'],
          ['Step size', 'powerStepSize', '%'],
          ['Step duration', 'stepDuration', 'sec'],
        ];
    return (
      <>
        <SettingRow label={label} accent>
          <ToggleButton
            active={section.active !== false}
            disabled={section.active === false && otherActive}
            title={section.active === false ? 'Activate' : 'Activated'}
            onPress={() => toggleSection(sectionName)}
          />
        </SettingRow>
        {section.active === false && otherActive && (
          <Text style={styles.helpText}>Turn off the {isFrequency ? 'power' : 'frequency'} sweep to use a {isFrequency ? 'frequency' : 'power'} sweep. Only one sweep can run at a time.</Text>
        )}
        {section.active !== false && <Text style={styles.helpText}>Sweeps only go up: the end must be at least the start, and the step size must be above zero.</Text>}
        {section.active !== false && entries.map(([title, key, unit]) => (
          <NumberField
            key={key}
            label={title}
            value={section[key]}
            unit={unit}
            onChange={(value) => updateSection(sectionName, key, value)}
            onCommit={() => keepSweepUpward(sectionName, key)}
          />
        ))}
      </>
    );
  }

  function renderBatchSettings(): React.JSX.Element {
    const stageOptions = [{ value: '', label: 'Null' }, ...availableStageFiles.map((name) => ({ value: name, label: name }))];
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Batch run settings</Text>
        <SettingRow label="Batch filename" accent>
          <TextInput
            accessibilityLabel="Batch filename"
            value={filenameDraft}
            onChangeText={(text) => setFilenameDraft(stripFileNameChars(text))}
            onBlur={() => renameFile(filenameDraft)}
            onSubmitEditing={() => renameFile(filenameDraft)}
            editable={!fileReadOnly}
            style={[styles.textInput, styles.wideInput, fileReadOnly && styles.fieldDisabled]}
          />
        </SettingRow>
        {Array.from({ length: batchStageCount }, (_, index) => {
          const stageFile = protocol.filenames?.[index] ?? '';
          const viewing = activeBatchStage === index;
          return (
            <View key={index} style={styles.settingRow}>
              <View>
                <Text style={styles.settingLabel}>Stage {index + 1}</Text>
                <Pressable accessibilityRole="button" onPress={() => setActiveBatchStage(index)} style={[styles.viewPill, viewing && styles.viewPillActive]}>
                  <Text style={[styles.viewPillText, viewing && styles.viewPillActiveText]}>{viewing ? 'VIEWING' : 'VIEW'}</Text>
                </Pressable>
              </View>
              <View style={styles.wideInput}>
                <Select label={`Stage ${index + 1}`} value={stageFile} options={stageOptions} disabled={fileReadOnly} onChange={(name) => setBatchFile(index, name)} />
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  function renderGlobalEditor(): React.JSX.Element {
    const cross = displayedProtocol.cross ?? {};
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Global settings</Text>
        {renderDurationBar()}
        {currentFileName !== '' && (
          <SettingRow label="Filename" accent={false}>
            <View style={[styles.fieldControl, styles.wideInput]}>
              <TextInput
                accessibilityLabel="Filename"
                autoCapitalize="none"
                autoCorrect={false}
                value={filenameDraft}
                onChangeText={(text) => setFilenameDraft(stripFileNameChars(text))}
                onBlur={() => renameFile(filenameDraft)}
            onSubmitEditing={() => renameFile(filenameDraft)}
                editable={!fileReadOnly}
                style={[styles.textInput, styles.filenameInput, fileReadOnly && styles.fieldDisabled]}
              />
              <Text style={styles.unit}>{splitFileName(currentFileName).extension}</Text>
            </View>
          </SettingRow>
        )}
        <SettingRow label="Protocol notes" accent={false}>
          <TextInput
            accessibilityLabel="Protocol notes"
            value={displayedProtocol.notes ?? ''}
            onChangeText={(notes) => updateDisplayedProtocol((current) => ({ ...current, notes }))}
            placeholder="Add protocol notes"
            editable={!readOnly}
            style={[styles.textInput, styles.wideInput, readOnly && styles.fieldDisabled]}
          />
        </SettingRow>
        {renderGlobalFields('frequency')}
        {renderGlobalFields('power')}
        <SettingRow label="Cross frequency coupling" accent>
          <ToggleButton active={cross.active !== false} title={cross.active === false ? 'Activate' : 'Activated'} onPress={() => toggleSection('cross')} />
        </SettingRow>
        {cross.active !== false && (
          <>
            <NumberField label="Frequency" value={cross.freq} unit="Hz" onChange={(value) => updateSection('cross', 'freq', value)} />
            <NumberField label="Coupling delay" value={cross.couplingDelay} unit="min" onChange={(value) => updateSection('cross', 'couplingDelay', value)} />
            <NumberField label="Stop coupling" value={cross.stopCoupling} unit="min" onChange={(value) => updateSection('cross', 'stopCoupling', value)} />
          </>
        )}
      </View>
    );
  }

  function updateAllModules(patch: (module: ProtocolModule) => Partial<ProtocolModule>): void {
    updateDisplayedProtocol((current) => {
      const others = (current.modules ?? []).filter((item) => !protocolModules.some(({ number }) => number === item.module_no));
      const modules = protocolModules.map(({ number }) => {
        const module = getProtocolModule(current, number);
        return { ...module, ...patch(module) };
      });
      return { ...current, modules: [...others, ...modules] };
    });
  }

  function renderModuleEditor(moduleNumber: number | 'all'): React.JSX.Element {
    const all = moduleNumber === 'all';
    const referenceNumber = all
      ? (protocolModules.find(({ number }) => getProtocolModule(displayedProtocol, number).active !== false) ?? protocolModules[0]).number
      : moduleNumber;
    const module = getProtocolModule(displayedProtocol, referenceNumber);
    const control = module.moduleControl ?? {};
    const modulePhase = normalizePhase(control.phase);
    const frequencyActive = displayedProtocol.frequency?.active !== false;
    const powerActive = displayedProtocol.power?.active !== false;
    const sweepDuration = calculateSweepDuration(displayedProtocol);
    const setModule = (patch: Partial<ProtocolModule>): void => {
      if (all) {
        updateAllModules(() => patch);
      } else {
        updateModule(moduleNumber, patch);
      }
    };
    const setControl = (key: string, value: unknown): void => {
      if (!all) {
        updateModuleControl(moduleNumber, key, value);
      } else if (key === 'freq' || key === 'power') {
        updateAllModules(() => ({ [key]: value }));
      } else {
        updateAllModules((item) => ({ moduleControl: { ...item.moduleControl, [key]: value } }));
      }
    };
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Data entry: {all ? 'all modules' : `module ${protocolModules.find((item) => item.number === moduleNumber)?.name}`}</Text>
        {renderDurationBar()}
        <SettingRow label="Module status" accent>
          <ToggleButton active={module.active !== false} title={module.active === false ? 'Activate' : 'Active'} onPress={() => setModule({ active: module.active === false })} />
        </SettingRow>
        <NumberField
          label="Active run time"
          value={sweepDuration ?? module.activeRunTime ?? module.runTime}
          unit="min"
          disabled={sweepDuration !== undefined}
          onChange={(value) => setModule({ activeRunTime: value })}
        />
        <NumberField label="Delay start time" value={module.delayStartTime} unit="min" onChange={(value) => setModule({ delayStartTime: value })} />
        <SettingRow label="Module phase" accent={false}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Phase ${modulePhase}`}
            disabled={readOnly}
            onPress={() => setControl('phase', modulePhase === 'A' ? 1 : 0)}
            style={[styles.phaseToggle, modulePhase === 'A' ? styles.phaseAButton : styles.phaseBButton, readOnly && styles.fieldDisabled]}
          >
            <Text style={styles.phaseToggleText}>{modulePhase}</Text>
          </Pressable>
        </SettingRow>
        {!frequencyActive && (
          <NumberField label="Frequency" value={module.freq ?? control.freq} unit="Hz" onChange={(value) => setControl('freq', value)} />
        )}
        {!powerActive && (
          <NumberField label="Power" value={module.power ?? control.power} unit="%" onChange={(value) => setControl('power', value)} />
        )}
        {(frequencyActive || powerActive) && (
          <Text style={styles.helpText}>Global sweeps control {frequencyActive && powerActive ? 'frequency and power' : frequencyActive ? 'frequency' : 'power'} for {all ? 'all modules' : 'this module'}.</Text>
        )}
        <SettingRow label="Apply cross frequency" accent={false}>
          <ToggleButton active={module.applyCross === true} title={module.applyCross === true ? 'Yes' : 'No'} onPress={() => setModule({ applyCross: module.applyCross !== true })} />
        </SettingRow>
      </View>
    );
  }

  function renderModuleGrid(source: Protocol, onSelect?: (number: number) => void, selectedNumber?: number): React.JSX.Element {
    const maxRun = Math.max(0, ...protocolModules.map((item) => moduleRunTime(source, getProtocolModule(source, item.number))));
    return (
      <View style={styles.moduleGrid}>
        {protocolDiagramRows.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.moduleRow}>
            {row.map((name) => {
              const moduleInfo = protocolModules.find((item) => item.name === name);
              if (!moduleInfo) return null;
              const { number } = moduleInfo;
              const module = getProtocolModule(source, number);
              const currentPhase = normalizePhase(module.moduleControl?.phase);
              const crossApplied = module.active !== false && module.applyCross === true && source.cross?.active !== false;
              const tileInactive = module.active === false || modulePower(source, module) <= 0;
              const tint = tintColor(currentPhase === 'B' ? theme.phaseB : theme.phaseA, deliveredSaturation(source, module, maxRun));
              return (
                <Pressable
                  key={number}
                  accessibilityRole={onSelect ? 'button' : 'text'}
                  accessibilityLabel={`${name}${tileInactive ? ', inactive' : ''}`}
                  disabled={!onSelect}
                  onPress={() => onSelect?.(number)}
                  style={[
                    styles.moduleTile,
                    tileInactive ? styles.inactiveTile : { backgroundColor: tint },
                    crossApplied && styles.crossTile,
                    selectedNumber === number && styles.selectedTile,
                  ]}
                >
                  <Text style={styles.moduleTitle}>{name}</Text>
                  <Text style={styles.moduleSubtitle}>{tileInactive ? 'Inactive' : describeModule(source, module)}</Text>
                  {crossApplied && <Text style={styles.crossLabel}>X:{String(source.cross?.freq ?? 0)}Hz</Text>}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    );
  }

  function renderSummaryTable(source: Protocol): React.JSX.Element {
    return (
      <View style={styles.summaryBox}>
        <View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryCell, styles.summaryHeading]} />
            {['PWR\n%', 'FREQ\nHZ', 'CROSS\nFREQ', 'PHASE', 'DELAY/\nACTIVE'].map((title) => (
              <Text key={title} style={[styles.summaryCell, styles.summaryHeading]}>{title}</Text>
            ))}
          </View>
          {protocolModules.map(({ name, number }) => {
            const module = getProtocolModule(source, number);
            const control = module.moduleControl ?? {};
            const active = module.active !== false;
            return (
              <View key={number} style={styles.summaryRow}>
                <Text style={[styles.summaryCell, styles.summaryModule]}>{name}</Text>
                <Text style={styles.summaryCell}>{String(active ? module.power ?? control.power ?? 0 : 0)}</Text>
                <Text style={styles.summaryCell}>{String(active ? module.freq ?? control.freq ?? 0 : 0)}</Text>
                <Text style={styles.summaryCell}>{active && module.applyCross ? 'on' : 'off'}</Text>
                <Text style={styles.summaryCell}>{active ? normalizePhase(control.phase) : 'A'}</Text>
                <Text style={styles.summaryCell}>{String(module.delayStartTime ?? 0)}/{String(Math.round(moduleRunTime(source, module) * 10) / 10)}</Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  function renderSummary(): React.JSX.Element {
    return (
      <View style={styles.panel}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: summaryExpanded }}
          onPress={() => setSummaryExpanded((expanded) => !expanded)}
        >
          <Text style={styles.collapseTitle}>{summaryExpanded ? '▼' : '▶'} View Protocol Summary Table</Text>
        </Pressable>
        {summaryExpanded && renderSummaryTable(displayedProtocol)}
      </View>
    );
  }

  function renderBatchDialog(): React.JSX.Element {
    const stageOptions = [{ value: '', label: 'Null' }, ...availableStageFiles.map((name) => ({ value: name, label: name }))];
    return (
      <Modal transparent animationType="fade" visible={batchDialogOpen} onRequestClose={() => setBatchDialogOpen(false)}>
        <View style={styles.dialogRoot}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Batch run creation</Text>
            <Text style={styles.dialogSubtitle}>Select a stage to add a data set to the BATCH run</Text>
            <View style={styles.dialogNameRow}>
              <Text style={styles.sectionTitle}>Batch filename</Text>
              <TextInput
                accessibilityLabel="Batch filename"
                value={batchDraftName}
                onChangeText={(text) => setBatchDraftName(stripFileNameChars(text))}
                style={[styles.textInput, styles.dialogInput]}
              />
            </View>
            <ScrollView style={styles.dialogStages}>
              {batchDraftStages.map((stageFile, index) => (
                <View key={index} style={styles.settingRow}>
                  <Text style={styles.settingLabel}>Stage {index + 1}</Text>
                  <View style={styles.wideInput}>
                    <Select
                      label={`Stage ${index + 1}`}
                      value={stageFile}
                      options={stageOptions}
                      onChange={(name) => setBatchDraftStages((current) => current.map((item, position) => position === index ? name : item))}
                    />
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={styles.dialogButtons}>
              <Pressable accessibilityRole="button" onPress={() => setBatchDialogOpen(false)} style={styles.backButton}>
                <Text style={styles.backButtonText}>BACK</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={createBatch} style={styles.addButton}>
                <Text style={styles.addButtonText}>ADD TO LIST</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function createFolder(): void {
    if (newFolderName.trim() === '') {
      return;
    }
    updateRunner((state) => addRunnerFolder(state, newFolderName));
    setFolderPromptOpen(false);
    setNewFolderName('');
  }

  function renderJournalViewDialog(): React.JSX.Element {
    const entry = journalView ? runnerData.journal.find((candidate) => candidate.id === journalView.id) : undefined;
    const stageNames = entry?.protocol?.filenames?.filter((stage) => stage !== '') ?? [];
    const isBatchRun = entry?.protocol?.filenames !== undefined;
    const shownStage = stageNames[Math.min(journalStage, Math.max(0, stageNames.length - 1))];
    const shown = isBatchRun ? (shownStage ? entry?.stages?.[shownStage] : undefined) : entry?.protocol;
    const json = entry?.protocol === undefined ? '' : JSON.stringify(entry.stages === undefined ? entry.protocol : { ...entry.protocol, stageFiles: entry.stages }, null, 2);
    return (
      <Modal transparent animationType="fade" visible={entry !== undefined && entry.protocol !== undefined} onRequestClose={() => setJournalView(null)}>
        <View style={styles.dialogRoot}>
          <View style={[styles.dialog, { maxWidth: 720 }]}>
            <ScrollView>
              <Text style={styles.dialogTitle}>{entry?.file ?? ''}</Text>
              <Text style={styles.runnerMeta}>{entry ? `Run started ${new Date(entry.startedAt).toLocaleString()}` : ''}</Text>
              {journalView?.kind === 'json' ? (
                <ScrollView style={styles.jsonBox} nestedScrollEnabled>
                  <Text selectable style={styles.jsonText}>{json}</Text>
                </ScrollView>
              ) : (
                <View style={{ gap: 10 }}>
                  {isBatchRun && (
                    <View style={styles.runnerButtons}>
                      {stageNames.map((stage, index) => (
                        <Pressable key={`${stage}-${index}`} accessibilityRole="button" onPress={() => setJournalStage(index)} style={[styles.thumbButton, index === journalStage && styles.thumbUp]}>
                          <Text style={styles.runnerButtonText}>{index + 1}. {stage}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {shown ? (
                    <>
                      <View style={[styles.legend, { justifyContent: 'center' }]}>
                        <View style={styles.legendItem}><View style={styles.phaseASwatch} /><Text style={styles.legendText}>Phase A</Text></View>
                        <View style={styles.legendItem}><View style={styles.phaseBSwatch} /><Text style={styles.legendText}>Phase B</Text></View>
                      </View>
                      <View style={{ alignItems: 'center' }}>{renderModuleGrid(shown)}</View>
                      {renderSummaryTable(shown)}
                    </>
                  ) : (
                    <Text style={styles.runnerMeta}>{isBatchRun ? 'This stage file was not in the app when the batch ran.' : 'No protocol was recorded for this run.'}</Text>
                  )}
                </View>
              )}
            </ScrollView>
            <View style={styles.deleteButtons}>
              <Pressable accessibilityRole="button" onPress={() => setJournalView(null)} style={styles.backButton}>
                <Text style={styles.backButtonText}>CLOSE</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function saveSequence(): void {
    if (!sequenceDraft || sequenceDraft.name.trim() === '' || sequenceFiles(sequenceDraft.steps).length === 0) {
      return;
    }
    const { id, name, description, steps } = sequenceDraft;
    updateRunner((state) => (id === undefined ? addRunnerSequence(state, name, steps, description) : updateRunnerSequence(state, id, name, steps, description)));
    setSequenceDraft(null);
  }

  function changeSequence(change: (draft: NonNullable<typeof sequenceDraft>) => Partial<NonNullable<typeof sequenceDraft>>): void {
    setSequenceDraft((draft) => (draft ? { ...draft, ...change(draft) } : draft));
  }

  function renderSequenceDialog(): React.JSX.Element {
    const draft = sequenceDraft;
    const available = Object.keys(files).filter((name) => files[name]?.filenames === undefined).sort((left, right) => left.localeCompare(right));
    const nextProfile = draft !== null && available.includes(draft.next) ? draft.next : available[0] ?? '';
    const restSeconds = Math.round(Number(draft?.rest));
    const restValid = Number.isFinite(restSeconds) && restSeconds > 0;
    const valid = draft !== null && draft.name.trim() !== '' && sequenceFiles(draft.steps).length > 0;
    const move = (index: number, other: number) => changeSequence((current) => {
      const next = [...current.steps];
      [next[index], next[other]] = [next[other] as SequenceStep, next[index] as SequenceStep];
      return { steps: next };
    });
    const stepButton = (label: string, onPress: () => void, options: { disabled?: boolean; danger?: boolean } = {}) => (
      <Pressable accessibilityRole="button" disabled={options.disabled === true} onPress={onPress} style={[options.danger ? styles.dangerButton : styles.actionButton, options.disabled === true && styles.fieldDisabled]}>
        <Text style={styles.actionText}>{label}</Text>
      </Pressable>
    );
    return (
      <Modal transparent animationType="fade" visible={draft !== null} onRequestClose={() => setSequenceDraft(null)}>
        <View style={styles.dialogRoot}>
          <View style={[styles.dialog, { maxWidth: 600 }]}>
            <ScrollView nestedScrollEnabled>
              <Text style={styles.dialogTitle}>{draft?.id === undefined ? 'New sequence' : 'Edit sequence'}</Text>
              <Text style={styles.fieldLabel}>Sequence name</Text>
              <TextInput accessibilityLabel="Sequence name" autoFocus placeholder="My sequence" placeholderTextColor="#94a3b8" value={draft?.name ?? ''} onChangeText={(text) => changeSequence(() => ({ name: text }))} style={styles.textInput} />
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Description (optional)</Text>
              <TextInput accessibilityLabel="Sequence description" multiline value={draft?.description ?? ''} onChangeText={(text) => changeSequence(() => ({ description: text }))} style={[styles.textInput, { minHeight: 64, textAlignVertical: 'top' }]} />
              <Text style={[styles.runnerMeta, { marginVertical: 12 }]}>
                Steps run in order, one at a time, and each protocol must finish before the next starts. Sequences are kept in the Protocol Runner only and are never saved to the controller.
              </Text>
              {draft?.steps.length === 0 && <Text style={styles.runnerMeta}>No steps yet. Add a protocol or a rest interval below.</Text>}
              {draft?.steps.map((step, index) => (
                <View key={`${describeStep(step)}-${index}`} style={styles.sequenceStep}>
                  <Text style={styles.runnerTitle}>{index + 1}. {describeStep(step)}</Text>
                  <View style={styles.runnerButtons}>
                    {stepButton('MOVE UP', () => move(index, index - 1), { disabled: index === 0 })}
                    {stepButton('MOVE DOWN', () => move(index, index + 1), { disabled: index === draft.steps.length - 1 })}
                    {stepButton('REMOVE STEP', () => changeSequence((current) => ({ steps: current.steps.filter((_, position) => position !== index) })), { danger: true })}
                  </View>
                </View>
              ))}
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Protocol for next step</Text>
              <Select label="Protocol for next step" value={nextProfile} options={available.map((name) => ({ value: name, label: name }))} onChange={(name) => changeSequence(() => ({ next: name }))} />
              <View style={{ marginTop: 10 }}>
                {stepButton('ADD STEP', () => changeSequence((current) => ({ steps: [...current.steps, { file: nextProfile }] })), { disabled: nextProfile === '' })}
              </View>
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Rest interval (seconds)</Text>
              <TextInput accessibilityLabel="Rest interval in seconds" keyboardType="numeric" value={draft?.rest ?? ''} onChangeText={(text) => changeSequence(() => ({ rest: text }))} style={styles.textInput} />
              <View style={{ marginTop: 10 }}>
                {stepButton('ADD REST INTERVAL', () => changeSequence((current) => ({ steps: [...current.steps, { rest: restSeconds }] })), { disabled: !restValid })}
              </View>
            </ScrollView>
            <View style={styles.deleteButtons}>
              <Pressable accessibilityRole="button" onPress={() => setSequenceDraft(null)} style={styles.backButton}>
                <Text style={styles.backButtonText}>CANCEL</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={!valid} onPress={saveSequence} style={[styles.backButton, !valid && styles.fieldDisabled]}>
                <Text style={styles.backButtonText}>{draft?.id === undefined ? 'SAVE SEQUENCE' : 'SAVE CHANGES'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function renderFolderDialog(): React.JSX.Element {
    return (
      <Modal transparent animationType="fade" visible={folderPromptOpen} onRequestClose={() => setFolderPromptOpen(false)}>
        <View style={styles.dialogRoot}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>New folder</Text>
            <TextInput
              accessibilityLabel="Folder name"
              autoFocus
              placeholder="Folder name"
              placeholderTextColor="#94a3b8"
              value={newFolderName}
              onChangeText={setNewFolderName}
              onSubmitEditing={createFolder}
              style={styles.textInput}
            />
            <View style={styles.deleteButtons}>
              <Pressable accessibilityRole="button" onPress={() => setFolderPromptOpen(false)} style={styles.backButton}>
                <Text style={styles.backButtonText}>CANCEL</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={newFolderName.trim() === ''} onPress={createFolder} style={[styles.backButton, newFolderName.trim() === '' && styles.fieldDisabled]}>
                <Text style={styles.backButtonText}>CREATE</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function renderDownloadDialog(): React.JSX.Element {
    return (
      <Modal transparent animationType="fade" visible={downloadPromptOpen} onRequestClose={() => setDownloadPromptOpen(false)}>
        <View style={styles.dialogRoot}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Download controller files</Text>
            <Text style={styles.settingsHint}>Download only files that aren't in the app yet, or erase everything in the app and download all files from {settings.deviceAddress} again? Erasing removes every file in the app, including files that were never saved to the controller or disk.</Text>
            <View style={styles.deleteButtons}>
              <Pressable accessibilityRole="button" onPress={() => setDownloadPromptOpen(false)} style={styles.backButton}>
                <Text style={styles.backButtonText}>CANCEL</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => { void downloadFromController(false); }} style={styles.backButton}>
                <Text style={styles.backButtonText}>NEW FILES ONLY</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => { void downloadFromController(true); }} style={styles.backButton}>
                <Text style={styles.backButtonText}>ERASE AND DOWNLOAD ALL</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function renderDeleteDialog(): React.JSX.Element {
    const name = deletePrompt ?? '';
    return (
      <Modal transparent animationType="fade" visible={deletePrompt !== null} onRequestClose={() => setDeletePrompt(null)}>
        <View style={styles.dialogRoot}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Delete {name}?</Text>
            <Text style={styles.settingsHint}>Delete it only from this app, or from both the app and the controller at {settings.deviceAddress}? Deleting from the controller cannot be undone.</Text>
            <View style={styles.deleteButtons}>
              <Pressable accessibilityRole="button" onPress={() => setDeletePrompt(null)} style={styles.backButton}>
                <Text style={styles.backButtonText}>CANCEL</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => { void deleteFile(name, false); }} style={styles.backButton}>
                <Text style={styles.backButtonText}>APP ONLY</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => { void deleteFile(name, true); }} style={styles.backButton}>
                <Text style={styles.backButtonText}>APP AND CONTROLLER</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function renderSettingsDialog(): React.JSX.Element {
    return (
      <Modal transparent animationType="fade" visible={settingsOpen} onRequestClose={() => setSettingsOpen(false)}>
        <View style={styles.dialogRoot}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Settings</Text>
            <ScrollView>
              <View style={styles.settingsSection}>
                <Text style={styles.sectionTitle}>Appearance</Text>
                <View style={styles.settingsToggleRow}>
                  <Text style={styles.moduleName}>Use system colors</Text>
                  <Switch
                    accessibilityLabel="Use system colors"
                    value={settings.useSystemColors}
                    onValueChange={(value) => updateSettings({ useSystemColors: value })}
                    trackColor={{ true: theme.accent }}
                  />
                </View>
                <Text style={styles.settingsHint}>Follow the system light or dark appearance instead of Brain Broccoli colors.</Text>
                <View style={styles.settingsToggleRow}>
                  <Text style={styles.moduleName}>Show JSON code</Text>
                  <Switch
                    accessibilityLabel="Show JSON code"
                    value={settings.showJson}
                    onValueChange={(value) => updateSettings({ showJson: value })}
                    trackColor={{ true: theme.accent }}
                  />
                </View>
                <Text style={styles.settingsHint}>Show the View Raw JSON Code section below the editor.</Text>
              </View>
              <View style={styles.settingsSection}>
                <Text style={styles.sectionTitle}>Devices</Text>
                <Text style={styles.moduleName}>IP address of Neuro Pro 2</Text>
                <TextInput
                  accessibilityLabel="IP address of Neuro Pro 2"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="np1.local"
                  placeholderTextColor="#94a3b8"
                  value={settings.deviceAddress}
                  onChangeText={(value) => updateSettings({ deviceAddress: value.trim() })}
                  style={styles.textInput}
                />
              </View>
            </ScrollView>
            <View style={styles.dialogButtons}>
              <Pressable accessibilityRole="button" onPress={() => setSettingsOpen(false)} style={styles.backButton}>
                <Text style={styles.backButtonText}>BACK</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function renderSidebarModal(): React.JSX.Element {
    return (
      <Modal transparent animationType="slide" visible={sidebarOpen} onRequestClose={() => setSidebarOpen(false)}>
        <View style={styles.modalRoot}>
          {sidebar}
          <Pressable accessibilityLabel="Close file list" onPress={() => setSidebarOpen(false)} style={styles.modalBackdrop} />
        </View>
      </Modal>
    );
  }

  return (
    <ThemeContext.Provider value={theme}>
    <ReadOnlyContext.Provider value={readOnly}>
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.appShell}>
          {wideSidebar && sidebar}
          <View style={styles.main}>
            <View style={styles.toolbar}>
              <View style={styles.toolbarHeading}>
                {!wideSidebar && (
                  <Pressable accessibilityRole="button" onPress={() => setSidebarOpen(true)} style={styles.menuButton}>
                    <Text style={styles.actionText}>☰ Files</Text>
                  </Pressable>
                )}
                <Text numberOfLines={1} style={styles.currentFile}>{appMode === 'runner' ? 'Protocol Runner' : currentFileName ? `Editing: ${currentFileName}` : 'No File Loaded'}</Text>
                <View accessibilityRole="tablist" style={styles.modeToggle}>
                  {(['editor', 'runner'] as const).map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: appMode === value }}
                      onPress={() => setAppMode(value)}
                      style={[styles.modeToggleButton, appMode === value && styles.modeToggleButtonActive]}
                    >
                      <Text style={styles.actionText}>{value === 'editor' ? (wideSidebar ? 'Protocol Editor' : 'Editor') : (wideSidebar ? 'Protocol Runner' : 'Runner')}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
            {busy && (
              <View accessibilityLiveRegion="polite" style={styles.statusBar}>
                <ActivityIndicator color="#f9a01b" />
                <Text style={styles.statusText}>{status || 'Working…'}</Text>
              </View>
            )}
            {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            {appMode === 'editor' && readOnly && (
              <View style={styles.readOnlyBanner}>
                <Text style={styles.readOnlyText}>
                  {isReadOnlyFile(currentFileName)
                    ? `${currentFileName} is a read-only system file.`
                    : `A stage file in this batch (${stageFileName}) is a read-only system file.`}
                </Text>
                {isReadOnlyFile(currentFileName) && (
                  <Pressable accessibilityRole="button" onPress={() => copyToEditable(currentFileName)} style={styles.readOnlyButton}>
                    <Text style={styles.actionText}>Copy to editable {userCopyExtension(currentFileName)} file</Text>
                  </Pressable>
                )}
              </View>
            )}
            {appMode === 'runner' ? renderRunner() : (
            <ScrollView contentContainerStyle={styles.workspace}>
              <View style={[styles.editorLayout, wideEditor && styles.editorLayoutWide]}>
                <View style={[styles.diagramPanel, wideEditor && styles.diagramPanelWide]}>
                  {!wideSidebar && mode === 'global' && renderFileActions()}
                  {!wideSidebar && renderBrand()}
                  <View style={styles.legend}>
                    <View style={styles.legendItem}><View style={styles.phaseASwatch} /><Text style={styles.legendText}>Phase A</Text></View>
                    <View style={styles.legendItem}><View style={styles.phaseBSwatch} /><Text style={styles.legendText}>Phase B</Text></View>
                  </View>
                  {renderModuleGrid(displayedProtocol, (number) => { setSelectedModule(number); setMode('module'); }, mode === 'module' ? selectedModule : undefined)}
                  <Pressable disabled={isBatch} onPress={() => setMode('all')} style={[styles.modeButton, !isBatch && mode === 'all' && styles.activeMode, isBatch && styles.disabledMode]}>
                    <Text style={[styles.modeText, isBatch && styles.disabledModeText]}>Edit all modules</Text>
                  </Pressable>
                  <Pressable disabled={isBatch} onPress={() => setMode('global')} style={[styles.modeButton, !isBatch && mode === 'global' && styles.activeMode, isBatch && styles.disabledMode]}>
                    <Text style={[styles.modeText, isBatch && styles.disabledModeText]}>Global protocol settings</Text>
                  </Pressable>
                </View>
                <View style={[styles.rightColumn, wideEditor && styles.rightColumnWide]}>
                  {wideSidebar && mode === 'global' && renderFileActions()}
                  {isBatch && mode === 'global' ? renderBatchSettings() : mode === 'global' ? renderGlobalEditor() : mode === 'all' ? renderModuleEditor('all') : renderModuleEditor(selectedModule)}
                  {renderSummary()}
                  {settings.showJson && (
                    <View style={styles.panel}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: jsonExpanded }}
                        onPress={() => setJsonExpanded((expanded) => !expanded)}
                      >
                        <Text style={styles.collapseTitle}>{jsonExpanded ? '▼' : '▶'} View Raw JSON Code</Text>
                      </Pressable>
                      {jsonExpanded && (
                        <ScrollView style={styles.jsonBox} nestedScrollEnabled>
                          <Text selectable style={styles.jsonText}>{JSON.stringify(isBatch ? protocol : displayedProtocol, null, 2)}</Text>
                        </ScrollView>
                      )}
                    </View>
                  )}
                </View>
              </View>
            </ScrollView>
            )}
          </View>
          {!wideSidebar && renderSidebarModal()}
          {renderBatchDialog()}
          {renderSettingsDialog()}
          {renderDeleteDialog()}
          {renderDownloadDialog()}
          {renderFolderDialog()}
          {renderSequenceDialog()}
          {renderJournalViewDialog()}
        </View>
        <StatusBar style={scheme === 'brand' ? 'dark' : 'auto'} />
      </SafeAreaView>
    </SafeAreaProvider>
    </ReadOnlyContext.Provider>
    </ThemeContext.Provider>
  );
}

function ActionButton(props: { title: string; onPress: () => void; menu?: boolean }): React.JSX.Element {
  const { styles } = useContext(ThemeContext);
  return (
    <Pressable accessibilityRole={props.menu ? 'menuitem' : 'button'} onPress={props.onPress} style={props.menu ? styles.menuItem : styles.actionButton}>
      <Text style={props.menu ? styles.menuItemText : styles.actionText}>{props.title}</Text>
    </Pressable>
  );
}

function ToggleButton(props: { active: boolean; title: string; disabled?: boolean; onPress: () => void }): React.JSX.Element {
  const { styles } = useContext(ThemeContext);
  const readOnly = useContext(ReadOnlyContext) || props.disabled === true;
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: props.active, disabled: readOnly }} disabled={readOnly} onPress={props.onPress} style={[styles.toggle, props.active && styles.toggleActive, readOnly && styles.fieldDisabled]}>
      <Text style={props.active ? styles.toggleActiveText : styles.toggleText}>{props.title}</Text>
    </Pressable>
  );
}

const MAX_POWER_PERCENT = 140;

// An active global sweep sets how long every active module runs.
function moduleRunTime(protocol: Protocol, module: ProtocolModule): number {
  const sweep = calculateSweepDuration(protocol);
  if (sweep !== undefined && module.active !== false) return sweep;
  return Number(module.activeRunTime ?? module.runTime ?? 0) || 0;
}

function modulePower(protocol: Protocol, module: ProtocolModule): number {
  const power = protocol.power ?? {};
  const start = Number(power.startPower);
  const end = Number(power.endPower);
  if (power.active !== false && start > 0 && end > 0) return (start + end) / 2;
  return Number(module.power ?? 0) || 0;
}

// Power delivered = power x run time, scaled against 140% for the longest run time.
function deliveredSaturation(protocol: Protocol, module: ProtocolModule, referenceMinutes: number): number {
  if (referenceMinutes <= 0) return 0;
  const delivered = modulePower(protocol, module) * moduleRunTime(protocol, module);
  return Math.min(1, Math.max(0, delivered / (MAX_POWER_PERCENT * referenceMinutes)));
}

function tintColor(hex: string, saturation: number): string {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `rgb(${channels.map((channel) => Math.round(255 - (255 - channel) * saturation)).join(',')})`;
}

function describeModule(protocol: Protocol, module: ProtocolModule): string {
  const frequency = protocol.frequency ?? {};
  const power = protocol.power ?? {};
  const sweepFrequency = frequency.active !== false && Number(frequency.startFreq) > 0 && Number(frequency.endFreq) > 0;
  const sweepPower = power.active !== false && Number(power.startPower) > 0 && Number(power.endPower) > 0;
  const freq = sweepFrequency ? `${String(frequency.startFreq)}-${String(frequency.endFreq)}` : String(module.freq ?? 0);
  const level = sweepPower ? `${String(power.startPower)}-${String(power.endPower)}` : String(module.power ?? 0);
  return `${freq}hz · ${level}%\n${String(Math.round(moduleRunTime(protocol, module) * 10) / 10)}m`;
}

function SettingRow(props: { label: string; accent: boolean; children: ReactNode }): React.JSX.Element {
  const { styles } = useContext(ThemeContext);
  return (
    <View style={styles.settingRow}>
      <Text style={[styles.settingLabel, props.accent && styles.settingLabelAccent]}>{props.label}</Text>
      {props.children}
    </View>
  );
}

function Select(props: { label: string; value: string; disabled?: boolean; options: { value: string; label: string }[]; onChange: (value: string) => void }): React.JSX.Element {
  const { styles, inputBackground, inputBorder, inputText } = useContext(ThemeContext);
  if (Platform.OS === 'web') {
    return createElement(
      'select',
      {
        'aria-label': props.label,
        disabled: props.disabled,
        value: props.value,
        onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
        style: {
          backgroundColor: inputBackground,
          border: `1px solid ${inputBorder}`,
          borderRadius: 6,
          color: inputText,
          fontSize: 15,
          opacity: props.disabled ? 0.5 : 1,
          padding: '10px 12px',
          width: '100%',
        },
      },
      props.options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label)),
    );
  }
  const index = Math.max(0, props.options.findIndex((option) => option.value === props.value));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={() => props.onChange(props.options[(index + 1) % props.options.length]?.value ?? '')}
      style={[styles.selectButton, props.disabled && styles.fieldDisabled]}
    >
      <Text style={styles.selectText}>{props.options[index]?.label}</Text>
    </Pressable>
  );
}

function NumberField(props: { label: string; value: unknown; unit: string; disabled?: boolean; onChange: (value: number) => void; onCommit?: () => void }): React.JSX.Element {
  const { styles } = useContext(ThemeContext);
  const readOnly = useContext(ReadOnlyContext) || props.disabled === true;
  const value = typeof props.value === 'number' && Number.isFinite(props.value) ? String(props.value) : '0';
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{props.label}</Text>
      <View style={styles.fieldControl}>
        <TextInput
          accessibilityLabel={props.label}
          keyboardType="decimal-pad"
          editable={!readOnly}
          value={value}
          onChangeText={(text) => {
            const parsed = Number(text);
            props.onChange(text === '' || !Number.isFinite(parsed) ? 0 : Math.max(0, parsed));
          }}
          onEndEditing={props.onCommit}
          style={[styles.numberInput, readOnly && styles.fieldDisabled]}
        />
        <Text style={styles.unit}>{props.unit}</Text>
      </View>
    </View>
  );
}

function isReadOnlyFile(name: string): boolean {
  return /\.vnp[123]$/i.test(name);
}

// Dots and path separators in a file name crash the controller.
function stripFileNameChars(text: string): string {
  return text.replace(/[./\\]/g, '');
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function decodeUtf8(bytes: Uint8Array): string {
  const encoded = Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
  return decodeURIComponent(encoded);
}

const styleDefs = {
  safeArea: { flex: 1, backgroundColor: '#2f5d1f' },
  appShell: { flex: 1, flexDirection: 'row', backgroundColor: '#2f5d1f' },
  sidebar: { width: 300, backgroundColor: '#2f5d1f', borderRightColor: '#cbd5e1', borderRightWidth: 1, paddingBottom: 8 },
  sidebarActions: { borderBottomColor: '#cbd5e1', borderBottomWidth: 1 },
  menuItems: { backgroundColor: '#2f5d1f' },
  menuItem: { backgroundColor: '#8dc63f', borderBottomColor: '#6fa82c', borderBottomWidth: 1, paddingHorizontal: 18, paddingVertical: 14 },
  menuHeader: { backgroundColor: '#2f5d1f', borderBottomColor: '#6fa82c', borderBottomWidth: 1, paddingHorizontal: 18, paddingVertical: 10 },
  menuHeaderText: { color: '#fefefe', fontSize: 13, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  menuItemText: { color: '#fefefe', fontSize: 15, fontWeight: '700' },
  brand: { alignItems: 'center', backgroundColor: '#2f5d1f', borderBottomColor: '#cbd5e1', borderBottomWidth: 1, padding: 14 },
  mobileLogo: { height: 199, marginBottom: 8, width: 199 },
  logo: { width: 128, height: 128 },
  brandCaption: { color: '#e9f3df', fontSize: 12, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  uploadButton: { alignItems: 'center', backgroundColor: '#f0fdf4', borderColor: '#7bc043', borderRadius: 8, borderStyle: 'dashed', borderWidth: 2, margin: 14, padding: 16 },
  uploadTitle: { color: '#334155', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  uploadHint: { color: '#64748b', fontSize: 12, marginTop: 5, textAlign: 'center' },
  fileScroll: { flex: 1 },
  fileList: { gap: 8, paddingHorizontal: 12, paddingBottom: 16 },
  fileGroup: { backgroundColor: '#f0fdf4', borderColor: '#f9a01b', borderRadius: 6, borderWidth: 1, overflow: 'hidden' },
  groupTitle: { backgroundColor: '#7bc043', color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.4, padding: 10, textTransform: 'uppercase' },
  fileRow: { alignItems: 'center', borderBottomColor: '#f1f5f9', borderBottomWidth: 1, flexDirection: 'row', paddingHorizontal: 8 },
  fileButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 5 },
  selectedFile: { backgroundColor: '#dcfce7', borderColor: '#f9a01b', borderWidth: 1 },
  fileName: { color: '#334155', fontSize: 12, fontWeight: '600' },
  statusBar: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#f9a01b', borderRadius: 6, borderWidth: 1, flexDirection: 'row', gap: 10, marginHorizontal: 14, marginTop: 10, padding: 10 },
  statusText: { color: '#334155', flex: 1, fontSize: 13, fontWeight: '700' },
  fileActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  copyText: { color: '#f9a01b', fontSize: 16, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 8 },
  readOnlyBanner: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#f9a01b', borderRadius: 6, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginHorizontal: 14, marginTop: 10, padding: 10 },
  readOnlyText: { color: '#334155', flex: 1, fontSize: 13, fontWeight: '700', minWidth: 180 },
  readOnlyButton: { backgroundColor: '#f9a01b', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  fieldDisabled: { opacity: 0.5 },
  deleteText: { color: '#dc2626', fontSize: 14, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 6 },
  runnerEmpty: { color: '#d9efc4', fontSize: 13, lineHeight: 19, padding: 10 },
  emptyList: { color: '#64748b', fontSize: 13, lineHeight: 19, padding: 10 },
  main: { flex: 1, minWidth: 0 },
  toolbar: { backgroundColor: '#2f5d1f', borderBottomColor: '#cbd5e1', borderBottomWidth: 1, gap: 8, paddingHorizontal: 18, paddingVertical: 10 },
  modeToggle: { borderColor: '#f9a01b', borderRadius: 6, borderWidth: 1, flexDirection: 'row', overflow: 'hidden' },
  modeToggleButton: { paddingHorizontal: 12, paddingVertical: 9 },
  modeToggleButtonActive: { backgroundColor: '#f9a01b' },
  runnerBrand: { alignItems: 'center', gap: 4, marginBottom: 14 },
  runnerRow: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', borderRadius: 8, borderWidth: 1, gap: 8, padding: 12 },
  dropBefore: { borderTopColor: '#2f9e44', borderTopWidth: 3 },
  dropAfter: { borderBottomColor: '#2f9e44', borderBottomWidth: 3 },
  runnerPanel: { backgroundColor: '#12301a', borderColor: '#7bc043', borderRadius: 12, borderWidth: 1, gap: 10, padding: 18 },
  runnerFolder: { backgroundColor: '#7bc043', borderColor: '#5fa12f', borderRadius: 10, borderWidth: 1, gap: 8, padding: 10 },
  runnerTitle: { color: '#1e293b', fontSize: 15, fontWeight: '700', paddingRight: 28 },
  cardClose: { alignItems: 'center', height: 24, justifyContent: 'center', position: 'absolute', right: 6, top: 6, width: 24, zIndex: 1 },
  cardCloseText: { color: '#dc2626', fontSize: 14, fontWeight: '700' },
  runnerMeta: { color: '#64748b', fontSize: 12, lineHeight: 18 },
  runnerButtons: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  runnerButtonText: { color: '#334155', fontSize: 13, fontWeight: '700' },
  runnerInput: { flex: 1, minWidth: 140 },
  dangerButton: { backgroundColor: '#b91c1c', borderColor: '#b91c1c', borderRadius: 6, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  sequenceStep: { borderColor: '#cbd5e1', borderRadius: 10, borderWidth: 1, gap: 8, marginBottom: 10, padding: 12 },
  thumbButton: { backgroundColor: '#fff', borderColor: '#cbd5e1', borderRadius: 6, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  thumbUp: { backgroundColor: '#dcfce7' },
  thumbDown: { backgroundColor: '#fee2e2' },
  noteInput: { minHeight: 56, textAlignVertical: 'top' },
  progressTrack: { backgroundColor: '#e2e8f0', borderRadius: 5, height: 10, overflow: 'hidden' },
  progressFill: { backgroundColor: '#7bc043', height: 10 },
  toolbarHeading: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  headingText: { flex: 1, minWidth: 0 },
  currentFile: { color: '#fdfdfd', flex: 1, fontSize: 18, fontWeight: '600' },
  durationText: { color: '#64748b', fontSize: 12, marginTop: 3 },
  menuButton: { backgroundColor: '#f9a01b', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 9 },
  actionButton: { backgroundColor: '#f9a01b', borderColor: '#f9a01b', borderRadius: 6, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  workspace: { padding: 14 },
  editorLayout: { gap: 14 },
  editorLayoutWide: { alignItems: 'flex-start', flexDirection: 'row' },
  diagramPanel: { alignItems: 'center', width: '100%' },
  diagramPanelWide: { flexBasis: 360, flexGrow: 0, flexShrink: 1, width: 'auto' },
  legend: { backgroundColor: '#fff', borderColor: '#cbd5e1', borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 18, marginBottom: 10, paddingHorizontal: 14, paddingVertical: 6 },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  legendText: { color: '#334155', fontSize: 13, fontWeight: '600' },
  phaseASwatch: { backgroundColor: '#7bc043', borderColor: '#1a1a1a', borderRadius: 3, borderWidth: 1, height: 15, width: 15 },
  phaseBSwatch: { backgroundColor: '#f9a01b', borderColor: '#1a1a1a', borderRadius: 3, borderWidth: 1, height: 15, width: 15 },
  moduleGrid: { alignItems: 'center', gap: 6, maxWidth: 400, width: '100%' },
  moduleRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', width: '100%' },
  moduleTile: { alignItems: 'center', borderColor: '#1a1a1a', borderRadius: 7, borderWidth: 1, justifyContent: 'center', minHeight: 58, padding: 4, width: '31%' },
  phaseA: { backgroundColor: '#7bc043' },
  phaseB: { backgroundColor: '#f9a01b' },
  inactiveTile: { backgroundColor: '#fff' },
  crossTile: { borderColor: '#000', borderWidth: 4 },
  crossLabel: { color: '#000', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  selectedTile: { borderColor: '#000', borderWidth: 3 },
  disabledMode: { backgroundColor: '#f3f7f1', borderColor: '#dde6da' },
  disabledModeText: { color: '#94a3b8' },
  moduleTitle: { color: '#1a1a1a', fontSize: 16, fontWeight: '800' },
  moduleSubtitle: { color: '#334155', fontSize: 10, marginTop: 3, textAlign: 'center' },
  modeButton: { backgroundColor: '#fff', borderColor: '#cbd5e1', borderRadius: 7, borderWidth: 2, marginTop: 12, padding: 12, width: '100%' },
  activeMode: { backgroundColor: '#f0fdf4', borderColor: '#7bc043' },
  modeText: { color: '#334155', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  rightColumn: { gap: 14, minWidth: 0, width: '100%' },
  rightColumnWide: { flex: 1, minWidth: 340, width: 'auto' },
  panel: { backgroundColor: '#fff', borderColor: '#cbd5e1', borderRadius: 12, borderWidth: 1, gap: 10, padding: 18 },
  panelTitle: { color: '#7bc043', fontSize: 18, fontWeight: '800', letterSpacing: 0.5, textAlign: 'center', textTransform: 'uppercase' },
  expandText: { color: '#64748b', fontSize: 12, fontWeight: '700' },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  sectionTitle: { color: '#7bc043', flex: 1, fontSize: 14, fontWeight: '800', textTransform: 'uppercase' },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { flexBasis: 150, flexGrow: 1, minWidth: 125 },
  fieldLabel: { color: '#475569', fontSize: 12, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' },
  fieldControl: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  numberInput: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', borderRadius: 6, borderWidth: 1, color: '#1e293b', fontSize: 15, paddingHorizontal: 9, paddingVertical: 6, textAlign: 'right', width: 84 },
  textInput: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', borderRadius: 6, borderWidth: 1, color: '#1e293b', fontSize: 14, padding: 10 },
  notesInput: { minHeight: 68, textAlignVertical: 'top' },
  unit: { color: '#64748b', fontSize: 12, fontWeight: '600', minWidth: 28 },
  toggle: { alignItems: 'center', backgroundColor: '#f1f5f9', borderColor: '#cbd5e1', borderRadius: 18, borderWidth: 1, minWidth: 82, paddingHorizontal: 12, paddingVertical: 7 },
  toggleActive: { backgroundColor: '#dcfce7', borderColor: '#7bc043' },
  toggleText: { color: '#64748b', fontSize: 12, fontWeight: '700' },
  toggleActiveText: { color: '#166534', fontSize: 12, fontWeight: '700' },
  helpText: { color: '#64748b', fontSize: 12, lineHeight: 18 },
  phaseOptions: { flexDirection: 'row', gap: 8 },
  phaseButton: { alignItems: 'center', backgroundColor: '#f1f5f9', borderColor: '#cbd5e1', borderRadius: 6, borderWidth: 1, minWidth: 76, padding: 9 },
  phaseAButton: { backgroundColor: '#7bc043' },
  phaseBButton: { backgroundColor: '#f9a01b' },
  primaryButton: { alignItems: 'center', backgroundColor: '#7bc043', borderRadius: 6, padding: 11 },
  buttonText: { color: '#334155', fontSize: 12, fontWeight: '700' },
  moduleList: { gap: 8 },
  batchRow: { alignItems: 'center', borderBottomColor: '#f1f5f9', borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 7 },
  moduleName: { color: '#334155', flex: 1, fontSize: 14, fontWeight: '700' },
  stageButton: { alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 5, minWidth: 70, padding: 8 },
  activeStage: { backgroundColor: '#dcfce7' },
  stageFiles: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  stageFile: { borderColor: '#cbd5e1', borderRadius: 4, borderWidth: 1, maxWidth: 150, padding: 6 },
  stageClear: { justifyContent: 'center' },
  summaryRow: { flexDirection: 'row' },
  summaryCell: { borderBottomColor: '#e2e8f0', borderBottomWidth: 1, color: '#334155', flex: 1, fontSize: 13, minWidth: 0, paddingHorizontal: 2, paddingVertical: 9, textAlign: 'center' },
  summaryModule: { color: '#f9a01b', fontWeight: '800' },
  summaryBox: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', borderRadius: 8, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 8 },
  summaryHeading: { color: '#7bc043', fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  jsonBox: { backgroundColor: '#0f172a', borderRadius: 7, maxHeight: 320, padding: 12 },
  jsonText: { color: '#e2e8f0', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, fontSize: 11 },
  error: { backgroundColor: '#fef2f2', color: '#b91c1c', fontSize: 13, paddingHorizontal: 18, paddingVertical: 10 },
  modalRoot: { backgroundColor: 'rgba(0,0,0,0.45)', flex: 1, flexDirection: 'row' },
  modalBackdrop: { flex: 1 },
  collapseTitle: { color: '#1e293b', fontSize: 17, fontWeight: '700' },
  durationBar: { backgroundColor: '#f1f5f9', borderRadius: 6, padding: 8 },
  durationBarText: { color: '#475569', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  settingRow: { alignItems: 'center', borderBottomColor: '#f1f5f9', borderBottomWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'space-between', paddingBottom: 10 },
  settingLabel: { color: '#475569', flex: 1, fontSize: 13, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
  settingLabelAccent: { color: '#7bc043', fontWeight: '800' },
  filenameInput: { flex: 1, minWidth: 0 },
  wideInput: { flexBasis: 0, flexGrow: 1, maxWidth: 320 },
  phaseToggle: { alignItems: 'center', borderColor: '#1a1a1a', borderRadius: 6, borderWidth: 1, height: 44, justifyContent: 'center', width: 54 },
  phaseToggleText: { color: '#1a1a1a', fontSize: 18, fontWeight: '800' },
  viewPill: { alignSelf: 'flex-start', borderColor: '#f9a01b', borderRadius: 12, borderWidth: 1, marginTop: 6, paddingHorizontal: 10, paddingVertical: 2 },
  viewPillActive: { backgroundColor: '#f9a01b' },
  viewPillText: { color: '#f9a01b', fontSize: 11, fontWeight: '800' },
  viewPillActiveText: { color: '#fff' },
  selectButton: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', borderRadius: 6, borderWidth: 1, padding: 11 },
  selectText: { color: '#1e293b', fontSize: 15 },
  dialogRoot: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', flex: 1, justifyContent: 'center', padding: 16 },
  dialog: { backgroundColor: '#fff', borderRadius: 16, maxHeight: '90%', maxWidth: 560, padding: 28, width: '100%' },
  dialogTitle: { color: '#7bc043', fontSize: 20, fontWeight: '800', letterSpacing: 1, textAlign: 'center', textTransform: 'uppercase' },
  dialogSubtitle: { color: '#475569', fontSize: 15, marginBottom: 18, marginTop: 6, textAlign: 'center' },
  dialogNameRow: { alignItems: 'center', borderBottomColor: '#cbd5e1', borderBottomWidth: 2, flexDirection: 'row', gap: 12, paddingBottom: 16 },
  dialogInput: { flex: 2 },
  dialogStages: { flexGrow: 0, marginVertical: 8, maxHeight: 400 },
  dialogButtons: { flexDirection: 'row', gap: 15, justifyContent: 'center', marginTop: 14 },
  deleteButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 14 },
  backButton: { backgroundColor: '#fff', borderColor: '#cbd5e1', borderRadius: 6, borderWidth: 1, paddingHorizontal: 44, paddingVertical: 11 },
  backButtonText: { color: '#334155', fontSize: 14, fontWeight: '700' },
  addButton: { backgroundColor: '#7bc043', borderRadius: 6, paddingHorizontal: 22, paddingVertical: 12 },
  addButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  settingsHint: { color: '#64748b', fontSize: 12, lineHeight: 18, marginBottom: 6 },
  settingsSection: { borderBottomColor: '#cbd5e1', borderBottomWidth: 1, gap: 6, paddingBottom: 14, paddingTop: 10 },
  settingsToggleRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
} satisfies Record<string, ViewStyle & TextStyle>;

type Styles = Record<keyof typeof styleDefs, ViewStyle & TextStyle>;
type Scheme = 'brand' | 'light' | 'dark';
type Theme = { styles: Styles; accent: string; phaseA: string; phaseB: string; inputBackground: string; inputBorder: string; inputText: string };
type ColorMap = Record<string, string>;

const ACCENT_GREEN = '#7bc043';
const ACCENT_ORANGE = '#f9a01b';
// Phase colors, tiles, and the JSON box keep their colors in every scheme.
const fixedStyles = new Set<string>([
  'phaseASwatch', 'phaseBSwatch', 'phaseA', 'phaseB', 'phaseAButton', 'phaseBButton', 'moduleTile', 'moduleTitle',
  'moduleSubtitle', 'inactiveTile', 'crossTile', 'crossLabel', 'selectedTile', 'phaseToggle', 'phaseToggleText', 'jsonBox', 'jsonText',
]);
const fillProps = new Set(['backgroundColor', 'borderColor', 'borderBottomColor', 'borderRightColor']);

const systemPalettes: Record<'light' | 'dark', { accent: string; phaseA: string; phaseB: string; fill: ColorMap; text: ColorMap }> = {
  light: {
    accent: '#636366',
    phaseA: '#2f7f86',
    phaseB: '#d98b2b',
    fill: {
      '#2f5d1f': '#f2f2f7', '#cbd5e1': '#c7c7cc', '#f1f5f9': '#e5e5ea', '#f8fafc': '#f2f2f7', '#f0fdf4': '#e5e5ea',
      [ACCENT_GREEN]: '#636366', [ACCENT_ORANGE]: '#636366', '#dcfce7': '#d1d1d6', '#e2e8f0': '#e5e5ea',
      '#f3f7f1': '#f2f2f7', '#dde6da': '#e5e5ea', '#8dc63f': '#ffffff', '#6fa82c': '#e5e5ea',
    },
    text: {
      '#334155': '#1c1c1e', '#475569': '#3a3a3c', '#1e293b': '#1c1c1e', '#64748b': '#6c6c70', '#94a3b8': '#8e8e93',
      [ACCENT_GREEN]: '#636366', [ACCENT_ORANGE]: '#636366', '#166534': '#636366', '#fefefe': '#1c1c1e', '#fdfdfd': '#1c1c1e', '#e9f3df': '#6c6c70',
    },
  },
  dark: {
    accent: '#8e8e93',
    phaseA: '#4aa3ab',
    phaseB: '#e0a050',
    fill: {
      '#2f5d1f': '#000000', '#fff': '#1c1c1e', '#cbd5e1': '#48484a', '#f1f5f9': '#2c2c2e', '#f8fafc': '#2c2c2e',
      '#f0fdf4': '#3a3a3c', [ACCENT_GREEN]: '#8e8e93', [ACCENT_ORANGE]: '#8e8e93', '#dcfce7': '#3a3a3c',
      '#e2e8f0': '#3a3a3c', '#f3f7f1': '#1c1c1e', '#dde6da': '#2c2c2e', '#fef2f2': '#3a1c1c', '#8dc63f': '#1c1c1e', '#6fa82c': '#3a3a3c',
    },
    text: {
      '#334155': '#f2f2f7', '#475569': '#d1d1d6', '#1e293b': '#f2f2f7', '#64748b': '#aeaeb2', '#94a3b8': '#8e8e93',
      [ACCENT_GREEN]: '#8e8e93', [ACCENT_ORANGE]: '#8e8e93', '#166534': '#d1d1d6', '#b91c1c': '#ff6b6b', '#fefefe': '#f2f2f7', '#fdfdfd': '#f2f2f7', '#e9f3df': '#aeaeb2',
    },
  },
};

function buildTheme(scheme: Scheme): Theme {
  if (scheme === 'brand') {
    return { styles: StyleSheet.create(styleDefs) as Styles, accent: ACCENT_GREEN, phaseA: ACCENT_GREEN, phaseB: ACCENT_ORANGE, inputBackground: '#f8fafc', inputBorder: '#cbd5e1', inputText: '#1e293b' };
  }
  const palette = systemPalettes[scheme];
  const mapped: Record<string, Record<string, unknown>> = {};
  for (const [name, style] of Object.entries(styleDefs)) {
    mapped[name] = fixedStyles.has(name)
      ? style
      : Object.fromEntries(Object.entries(style).map(([prop, value]) => {
        if (typeof value !== 'string') return [prop, value];
        if (fillProps.has(prop)) return [prop, palette.fill[value] ?? value];
        if (prop === 'color') return [prop, palette.text[value] ?? value];
        return [prop, value];
      }));
  }
  const phaseFills: Record<string, string> = {
    phaseASwatch: palette.phaseA, phaseA: palette.phaseA, phaseAButton: palette.phaseA,
    phaseBSwatch: palette.phaseB, phaseB: palette.phaseB, phaseBButton: palette.phaseB,
  };
  for (const [name, color] of Object.entries(phaseFills)) mapped[name] = { ...mapped[name], backgroundColor: color };
  mapped.runnerPanel = { ...mapped.runnerPanel, backgroundColor: palette.fill['#fff'] ?? '#fff', borderColor: palette.fill['#cbd5e1'] ?? '#cbd5e1' };
  mapped.runnerEmpty = mapped.emptyList as Record<string, unknown>;
  mapped.runnerFolder = { ...mapped.runnerFolder, backgroundColor: palette.fill['#f1f5f9'] ?? '#f1f5f9', borderColor: palette.fill['#cbd5e1'] ?? '#cbd5e1' };
  return {
    styles: StyleSheet.create(mapped) as unknown as Styles,
    accent: palette.accent,
    phaseA: palette.phaseA,
    phaseB: palette.phaseB,
    inputBackground: palette.fill['#f8fafc'] ?? '#f8fafc',
    inputBorder: palette.fill['#cbd5e1'] ?? '#cbd5e1',
    inputText: palette.text['#1e293b'] ?? '#1e293b',
  };
}

const ThemeContext = createContext<Theme>(buildTheme('brand'));
const ReadOnlyContext = createContext(false);

type RunSession = { file: string; entryId: string; message: string; startedAt?: number; totalSeconds?: number | undefined };

type AppMode = 'editor' | 'runner';
type Settings = { useSystemColors: boolean; showJson: boolean; deviceAddress: string; appMode: AppMode };
const defaultSettings: Settings = { useSystemColors: false, showJson: false, deviceAddress: 'np1.local', appMode: 'editor' };
const settingsKey = 'brainbroccoli.settings';
const settingsPath = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}settings.json` : '';

async function loadSettings(): Promise<Settings> {
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = window.localStorage.getItem(settingsKey);
    } else if (settingsPath && (await FileSystem.getInfoAsync(settingsPath)).exists) {
      raw = await FileSystem.readAsStringAsync(settingsPath);
    }
    const saved = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    return {
      useSystemColors: typeof saved.useSystemColors === 'boolean' ? saved.useSystemColors : defaultSettings.useSystemColors,
      showJson: typeof saved.showJson === 'boolean' ? saved.showJson : defaultSettings.showJson,
      deviceAddress: typeof saved.deviceAddress === 'string' ? saved.deviceAddress : defaultSettings.deviceAddress,
      appMode: saved.appMode === 'runner' ? 'runner' : 'editor',
    };
  } catch {
    return defaultSettings;
  }
}

const filesKey = 'brainbroccoli.files';
const filesPath = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}files.json` : '';

async function loadStoredFiles(): Promise<Record<string, Protocol>> {
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = window.localStorage.getItem(filesKey);
    } else if (filesPath && (await FileSystem.getInfoAsync(filesPath)).exists) {
      raw = await FileSystem.readAsStringAsync(filesPath);
    }
    const saved = raw ? (JSON.parse(raw) as unknown) : {};
    return saved !== null && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, Protocol>) : {};
  } catch {
    return {};
  }
}

async function persistFiles(files: Record<string, Protocol>): Promise<void> {
  try {
    const raw = JSON.stringify(files);
    if (Platform.OS === 'web') {
      window.localStorage.setItem(filesKey, raw);
    } else if (filesPath) {
      await FileSystem.writeAsStringAsync(filesPath, raw);
    }
  } catch {
    // Retaining files is a convenience; failing to save should not interrupt editing.
  }
}

async function persistSettings(settings: Settings): Promise<void> {
  try {
    const raw = JSON.stringify(settings);
    if (Platform.OS === 'web') {
      window.localStorage.setItem(settingsKey, raw);
    } else if (settingsPath) {
      await FileSystem.writeAsStringAsync(settingsPath, raw);
    }
  } catch {
    // Settings are a convenience; failing to save should not interrupt editing.
  }
}

const runnerKey = 'brainbroccoli.runner';
const runnerPath = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}runner.json` : '';

function DropZone({ props, children }: { props: Record<string, unknown>; children: ReactNode }): React.JSX.Element {
  return Platform.OS === 'web' ? createElement('div', { ...props, style: { display: 'flex', flexDirection: 'column', gap: 8, minHeight: 16 } }, children) : <Fragment>{children}</Fragment>;
}

async function loadStoredRunner(): Promise<RunnerData> {
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = window.localStorage.getItem(runnerKey);
    } else if (runnerPath && (await FileSystem.getInfoAsync(runnerPath)).exists) {
      raw = await FileSystem.readAsStringAsync(runnerPath);
    }
    return raw ? parseRunnerData(JSON.parse(raw) as unknown) : emptyRunnerData;
  } catch {
    return emptyRunnerData;
  }
}

async function persistRunner(data: RunnerData): Promise<void> {
  try {
    const raw = JSON.stringify(data);
    if (Platform.OS === 'web') {
      window.localStorage.setItem(runnerKey, raw);
    } else if (runnerPath) {
      await FileSystem.writeAsStringAsync(runnerPath, raw);
    }
  } catch {
    // The runner list and journal are conveniences; failing to save should not interrupt running.
  }
}
