import { createElement, useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import JSZip from 'jszip';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
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
} from './src/core/protocol';
import type { Protocol, ProtocolModule, ProtocolSection } from './src/core/protocol';
import { readProtocolArchive } from './src/core/protocol-archive';
import type { ProtocolFile } from './src/core/protocol-archive';

type EditorMode = 'global' | 'module' | 'all';
type SectionName = 'frequency' | 'power' | 'cross';
const fileGroups = [
  { extension: '.vnp0', label: 'User Protocols' },
  { extension: '.vnp1', label: 'Vielight Protocols' },
  { extension: '.vnp2', label: 'Gracefire Protocols' },
  { extension: '.vnp3', label: 'Vielight Batch Protocols' },
  { extension: '.vnp4', label: 'User Batch Protocols' },
  { extension: '.json', label: 'Legacy JSON' },
];
const batchStageCount = 8;

export default function App() {
  const { width } = useWindowDimensions();
  const wideSidebar = width >= 980;
  const wideEditor = width - (wideSidebar ? 300 : 0) >= 860;
  const [protocol, setProtocol] = useState<Protocol>(() => createEmptyProtocol());
  const [files, setFiles] = useState<Record<string, Protocol>>({});
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

  function updateDisplayedProtocol(update: (value: Protocol) => Protocol): void {
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
    updateSection(sectionName, 'active', section?.active === false);
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
    const base = batchDraftName.trim().replace(/\.vnp4$/i, '') || 'My_Batch';
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

  function renameBatch(text: string): void {
    const base = text.trim().replace(/\.vnp4$/i, '');
    const name = `${base}.vnp4`;
    if (!currentFileName || base === '' || name === currentFileName) {
      return;
    }
    const others = Object.keys(files).filter((existing) => existing !== currentFileName);
    const unique = createUniqueImportedFileName(name, others);
    const renamed = { ...protocol, filename: unique.replace(/\.vnp4$/i, '') };
    setFiles((current) => {
      const next = { ...current };
      delete next[currentFileName];
      next[unique] = renamed;
      return next;
    });
    setCurrentFileName(unique);
    setProtocol(renamed);
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
      return readProtocolArchive(await readAssetBytes(asset));
    }
    if (!isProtocolFile(asset.name)) {
      return [];
    }
    return [{ name: asset.name, protocol: parseProtocolJSON(await readAssetText(asset)) }];
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
      const imported = (await Promise.all(result.assets.map(importAsset))).flat();
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
    }
  }

  async function saveProtocol(): Promise<void> {
    setError('');
    try {
      const batch = isBatch;
      const importedName = currentFileName.split('/').pop() ?? '';
      const baseName = importedName.replace(/\.[^.]+$/, '') || String(protocol.filename || 'protocol');
      const outputName = `${baseName}${batch ? '.vnp4' : '.vnp0'}`;
      const contents = JSON.stringify(batch ? protocol : displayedProtocol, null, 2);
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

  function saveToController(): void {
    setError('Saving to a controller is not available yet; use Save to Disk or Download Controller Files.');
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
      if (Platform.OS === 'web') {
        const blob = await archive.generateAsync({ type: 'blob' });
        downloadBlob(blob, 'brain-broccoli-protocols.zip');
        return;
      }
      if (!FileSystem.cacheDirectory) {
        throw new Error('Temporary file storage is unavailable on this device.');
      }
      const encoded = await archive.generateAsync({ type: 'base64' });
      const uri = `${FileSystem.cacheDirectory}brain-broccoli-protocols.zip`;
      await FileSystem.writeAsStringAsync(uri, encoded, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/zip', dialogTitle: 'Export protocols' });
      } else {
        throw new Error('File sharing is not available on this device.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to export the protocol archive.');
    }
  }

  function deleteFile(name: string): void {
    setFiles((current) => {
      const remaining = { ...current };
      delete remaining[name];
      return remaining;
    });
    if (currentFileName === name) {
      setCurrentFileName('');
      setProtocol(createEmptyProtocol());
    }
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
                <Text style={styles.groupTitle}>{expanded ? '▼' : '▶'} {group.label} ({group.extension.slice(1)})</Text>
              </Pressable>
              {expanded && names.map((name) => (
                <View key={name} style={styles.fileRow}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      const selected = files[name];
                      if (selected) {
                        loadProtocol(name, selected);
                      }
                    }}
                    style={[styles.fileButton, currentFileName === name && styles.selectedFile]}
                  >
                    <Text numberOfLines={1} style={styles.fileName}>{name}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${name}`} onPress={() => deleteFile(name)}>
                    <Text style={styles.deleteText}>✕</Text>
                  </Pressable>
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
      <View style={wideSidebar ? styles.toolbarButtons : styles.menuItems}>
        <ActionButton menu={!wideSidebar} title="📋 Create Batch" onPress={run(openBatchDialog)} />
        <ActionButton menu={!wideSidebar} title="📄 New File" onPress={run(createNewProtocol)} />
        <ActionButton menu={!wideSidebar} title="⬇️ Download Controller Files" onPress={run(() => { void exportZip(); })} />
        <ActionButton menu={!wideSidebar} title="📥 Save to Controller" onPress={run(saveToController)} />
        <ActionButton menu={!wideSidebar} title="💾 Save to Disk" onPress={run(() => { void saveProtocol(); })} />
      </View>
    );
  }

  function renderBrand(): React.JSX.Element {
    if (!wideSidebar) {
      return <Image accessibilityLabel="Brain Broccoli logo" source={require('./assets/brain-broccoli.png')} resizeMode="contain" style={styles.mobileLogo} />;
    }
    return (
      <View style={styles.brand}>
        <Image accessibilityLabel="Brain Broccoli logo" source={require('./assets/brain-broccoli.png')} resizeMode="contain" style={styles.logo} />
        <Text style={styles.brandCaption}>Vielight Neuro Pro 2 Protocol Editor</Text>
      </View>
    );
  }

  const canDrop = Platform.OS === 'web' && wideSidebar;

  const sidebar = (
    <View style={styles.sidebar}>
      {wideSidebar && renderBrand()}
      {!wideSidebar && <View style={styles.sidebarActions}>{renderActions()}</View>}
      <Pressable accessibilityRole="button" onPress={importFiles} disabled={busy} style={styles.uploadButton}>
        <Text style={styles.uploadTitle}>{busy ? 'Importing…' : canDrop ? 'Drop Vielight JSON files or zipped JSON files' : 'Import protocol files'}</Text>
        <Text style={styles.uploadHint}>{canDrop ? 'Click to browse files' : 'Tap to choose .vnp or .zip files'}</Text>
      </Pressable>
      <ScrollView style={styles.fileScroll}>{renderFileList()}</ScrollView>
    </View>
  );

  const currentModule = getProtocolModule(displayedProtocol, selectedModule);
  const moduleControl = currentModule.moduleControl ?? {};
  const phase = normalizePhase(moduleControl.phase ?? 'A');
  const duration = calculateTotalDuration(displayedProtocol);
  const maxRunTime = Math.max(0, ...protocolModules.map((item) => moduleRunTime(getProtocolModule(displayedProtocol, item.number))));
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
          <ToggleButton active={section.active !== false} title={section.active === false ? 'Activate' : 'Activated'} onPress={() => toggleSection(sectionName)} />
        </SettingRow>
        {section.active !== false && entries.map(([title, key, unit]) => (
          <NumberField
            key={key}
            label={title}
            value={section[key]}
            unit={unit}
            onChange={(value) => updateSection(sectionName, key, value)}
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
            key={currentFileName}
            accessibilityLabel="Batch filename"
            defaultValue={currentFileName.replace(/\.vnp4$/i, '')}
            onEndEditing={(event) => renameBatch(event.nativeEvent.text)}
            style={[styles.textInput, styles.wideInput]}
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
                <Select label={`Stage ${index + 1}`} value={stageFile} options={stageOptions} onChange={(name) => setBatchFile(index, name)} />
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
        <SettingRow label="Protocol notes" accent={false}>
          <TextInput
            accessibilityLabel="Protocol notes"
            value={displayedProtocol.notes ?? ''}
            onChangeText={(notes) => updateDisplayedProtocol((current) => ({ ...current, notes }))}
            placeholder="Add protocol notes"
            style={[styles.textInput, styles.wideInput]}
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
        <NumberField label="Active run time" value={module.activeRunTime ?? module.runTime} unit="min" onChange={(value) => setModule({ activeRunTime: value })} />
        <NumberField label="Delay start time" value={module.delayStartTime} unit="min" onChange={(value) => setModule({ delayStartTime: value })} />
        <SettingRow label="Module phase" accent={false}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Phase ${modulePhase}`}
            onPress={() => setControl('phase', modulePhase === 'A' ? 1 : 0)}
            style={[styles.phaseToggle, modulePhase === 'A' ? styles.phaseAButton : styles.phaseBButton]}
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
        {summaryExpanded && (
          <ScrollView horizontal style={styles.summaryBox}>
            <View>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryCell, styles.summaryHeading]} />
                {['PWR\n%', 'FREQ\nHZ', 'CROSS\nFREQ', 'PHASE', 'TIME\nDELAY/ACTIVE'].map((title) => (
                  <Text key={title} style={[styles.summaryCell, styles.summaryHeading]}>{title}</Text>
                ))}
              </View>
              {protocolModules.map(({ name, number }) => {
                const module = getProtocolModule(displayedProtocol, number);
                const control = module.moduleControl ?? {};
                const active = module.active !== false;
                return (
                  <View key={number} style={styles.summaryRow}>
                    <Text style={[styles.summaryCell, styles.summaryModule]}>{name}</Text>
                    <Text style={styles.summaryCell}>{String(active ? module.power ?? control.power ?? 0 : 0)}</Text>
                    <Text style={styles.summaryCell}>{String(active ? module.freq ?? control.freq ?? 0 : 0)}</Text>
                    <Text style={styles.summaryCell}>{active && module.applyCross ? 'on' : 'off'}</Text>
                    <Text style={styles.summaryCell}>{active ? normalizePhase(control.phase) : 'A'}</Text>
                    <Text style={styles.summaryCell}>{String(module.delayStartTime ?? 0)}/{String(module.activeRunTime ?? module.runTime ?? 0)}</Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
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
                onChangeText={setBatchDraftName}
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
                <Text numberOfLines={1} style={styles.currentFile}>{currentFileName ? `Editing: ${currentFileName}` : 'No File Loaded'}</Text>
              </View>
              {wideSidebar && renderActions()}
            </View>
            {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <ScrollView contentContainerStyle={styles.workspace}>
              <View style={[styles.editorLayout, wideEditor && styles.editorLayoutWide]}>
                <View style={[styles.diagramPanel, wideEditor && styles.diagramPanelWide]}>
                  {!wideSidebar && renderBrand()}
                  <View style={styles.legend}>
                    <View style={styles.legendItem}><View style={styles.phaseASwatch} /><Text style={styles.legendText}>Phase A</Text></View>
                    <View style={styles.legendItem}><View style={styles.phaseBSwatch} /><Text style={styles.legendText}>Phase B</Text></View>
                  </View>
                  <View style={styles.moduleGrid}>
                    {protocolDiagramRows.map((row, rowIndex) => (
                      <View key={`row-${rowIndex}`} style={styles.moduleRow}>
                        {row.map((name) => {
                          const moduleInfo = protocolModules.find((item) => item.name === name);
                          if (!moduleInfo) return null;
                          const { number } = moduleInfo;
                          const module = getProtocolModule(displayedProtocol, number);
                          const currentPhase = normalizePhase(module.moduleControl?.phase);
                          const crossApplied = module.active !== false && module.applyCross === true && displayedProtocol.cross?.active !== false;
                          const tileInactive = module.active === false || modulePower(displayedProtocol, module) <= 0;
                          const tint = tintColor(currentPhase === 'B' ? '#f9a01b' : '#7bc043', deliveredSaturation(displayedProtocol, module, maxRunTime));
                          return (
                            <Pressable
                              key={number}
                              accessibilityRole="button"
                              accessibilityLabel={`${name}${tileInactive ? ', inactive' : ''}`}
                              onPress={() => {
                                setSelectedModule(number);
                                setMode('module');
                              }}
                              style={[
                                styles.moduleTile,
                                tileInactive ? styles.inactiveTile : { backgroundColor: tint },
                                crossApplied && styles.crossTile,
                                mode === 'module' && selectedModule === number && styles.selectedTile,
                              ]}
                            >
                              <Text style={styles.moduleTitle}>{name}</Text>
                              <Text style={styles.moduleSubtitle}>{tileInactive ? 'Inactive' : describeModule(displayedProtocol, module)}</Text>
                              {crossApplied && <Text style={styles.crossLabel}>X:{String(displayedProtocol.cross?.freq ?? 0)}Hz</Text>}
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                  <Pressable disabled={isBatch} onPress={() => setMode('all')} style={[styles.modeButton, !isBatch && mode === 'all' && styles.activeMode, isBatch && styles.disabledMode]}>
                    <Text style={[styles.modeText, isBatch && styles.disabledModeText]}>Edit all modules</Text>
                  </Pressable>
                  <Pressable disabled={isBatch} onPress={() => setMode('global')} style={[styles.modeButton, !isBatch && mode === 'global' && styles.activeMode, isBatch && styles.disabledMode]}>
                    <Text style={[styles.modeText, isBatch && styles.disabledModeText]}>Global protocol settings</Text>
                  </Pressable>
                </View>
                <View style={[styles.rightColumn, wideEditor && styles.rightColumnWide]}>
                  {isBatch && mode === 'global' ? renderBatchSettings() : mode === 'global' ? renderGlobalEditor() : mode === 'all' ? renderModuleEditor('all') : renderModuleEditor(selectedModule)}
                  {renderSummary()}
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
                </View>
              </View>
            </ScrollView>
          </View>
          {!wideSidebar && renderSidebarModal()}
          {renderBatchDialog()}
        </View>
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function ActionButton(props: { title: string; onPress: () => void; menu?: boolean }): React.JSX.Element {
  return (
    <Pressable accessibilityRole={props.menu ? 'menuitem' : 'button'} onPress={props.onPress} style={props.menu ? styles.menuItem : styles.actionButton}>
      <Text style={props.menu ? styles.menuItemText : styles.actionText}>{props.title}</Text>
    </Pressable>
  );
}

function ToggleButton(props: { active: boolean; title: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: props.active }} onPress={props.onPress} style={[styles.toggle, props.active && styles.toggleActive]}>
      <Text style={props.active ? styles.toggleActiveText : styles.toggleText}>{props.title}</Text>
    </Pressable>
  );
}

const MAX_POWER_PERCENT = 140;

function moduleRunTime(module: ProtocolModule): number {
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
  const delivered = modulePower(protocol, module) * moduleRunTime(module);
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
  return `${freq}hz · ${level}%\n${String(module.activeRunTime ?? module.runTime ?? 0)}m`;
}

function SettingRow(props: { label: string; accent: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.settingRow}>
      <Text style={[styles.settingLabel, props.accent && styles.settingLabelAccent]}>{props.label}</Text>
      {props.children}
    </View>
  );
}

function Select(props: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }): React.JSX.Element {
  if (Platform.OS === 'web') {
    return createElement(
      'select',
      {
        'aria-label': props.label,
        value: props.value,
        onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
        style: {
          backgroundColor: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          color: '#1e293b',
          fontSize: 15,
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
      onPress={() => props.onChange(props.options[(index + 1) % props.options.length]?.value ?? '')}
      style={styles.selectButton}
    >
      <Text style={styles.selectText}>{props.options[index]?.label}</Text>
    </Pressable>
  );
}

function NumberField(props: { label: string; value: unknown; unit: string; onChange: (value: number) => void }): React.JSX.Element {
  const value = typeof props.value === 'number' && Number.isFinite(props.value) ? String(props.value) : '0';
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{props.label}</Text>
      <View style={styles.fieldControl}>
        <TextInput
          accessibilityLabel={props.label}
          keyboardType="decimal-pad"
          value={value}
          onChangeText={(text) => {
            const parsed = Number(text);
            props.onChange(text === '' || !Number.isFinite(parsed) ? 0 : parsed);
          }}
          style={styles.numberInput}
        />
        <Text style={styles.unit}>{props.unit}</Text>
      </View>
    </View>
  );
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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#eaf2e8' },
  appShell: { flex: 1, flexDirection: 'row', backgroundColor: '#eaf2e8' },
  sidebar: { width: 300, backgroundColor: '#fff', borderRightColor: '#cbd5e1', borderRightWidth: 1, paddingBottom: 8 },
  sidebarActions: { borderBottomColor: '#cbd5e1', borderBottomWidth: 1 },
  menuItems: { backgroundColor: '#fff' },
  menuItem: { borderBottomColor: '#f1f5f9', borderBottomWidth: 1, paddingHorizontal: 18, paddingVertical: 14 },
  menuItemText: { color: '#334155', fontSize: 15, fontWeight: '600' },
  brand: { alignItems: 'center', backgroundColor: '#f8fafc', borderBottomColor: '#cbd5e1', borderBottomWidth: 1, padding: 14 },
  mobileLogo: { height: 199, marginBottom: 8, width: 199 },
  logo: { width: 128, height: 128 },
  brandCaption: { color: '#64748b', fontSize: 12, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  uploadButton: { alignItems: 'center', backgroundColor: '#f0fdf4', borderColor: '#7bc043', borderRadius: 8, borderStyle: 'dashed', borderWidth: 2, margin: 14, padding: 16 },
  uploadTitle: { color: '#334155', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  uploadHint: { color: '#64748b', fontSize: 12, marginTop: 5, textAlign: 'center' },
  fileScroll: { flex: 1 },
  fileList: { gap: 8, paddingHorizontal: 12, paddingBottom: 16 },
  fileGroup: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', borderRadius: 6, borderWidth: 1, overflow: 'hidden' },
  groupTitle: { backgroundColor: '#f1f5f9', color: '#475569', fontSize: 12, fontWeight: '800', letterSpacing: 0.4, padding: 10, textTransform: 'uppercase' },
  fileRow: { alignItems: 'center', borderBottomColor: '#f1f5f9', borderBottomWidth: 1, flexDirection: 'row', paddingHorizontal: 8 },
  fileButton: { flex: 1, paddingVertical: 10, paddingHorizontal: 5 },
  selectedFile: { backgroundColor: '#f0fdf4', borderColor: '#7bc043', borderWidth: 1 },
  fileName: { color: '#334155', fontSize: 12, fontWeight: '600' },
  deleteText: { color: '#dc2626', fontSize: 14, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 6 },
  emptyList: { color: '#64748b', fontSize: 13, lineHeight: 19, padding: 10 },
  main: { flex: 1, minWidth: 0 },
  toolbar: { backgroundColor: '#fff', borderBottomColor: '#cbd5e1', borderBottomWidth: 1, gap: 8, paddingHorizontal: 18, paddingVertical: 10 },
  toolbarHeading: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  headingText: { flex: 1, minWidth: 0 },
  currentFile: { color: '#334155', flex: 1, fontSize: 18, fontWeight: '600' },
  durationText: { color: '#64748b', fontSize: 12, marginTop: 3 },
  toolbarButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
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
  unit: { color: '#64748b', fontSize: 12, fontWeight: '600', width: 28 },
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
  summaryCell: { borderBottomColor: '#e2e8f0', borderBottomWidth: 1, color: '#334155', fontSize: 13, minWidth: 90, paddingHorizontal: 7, paddingVertical: 10, textAlign: 'center' },
  summaryModule: { color: '#f9a01b', fontWeight: '800' },
  summaryBox: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', borderRadius: 8, borderWidth: 1, padding: 12 },
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
  backButton: { backgroundColor: '#fff', borderColor: '#cbd5e1', borderRadius: 6, borderWidth: 1, paddingHorizontal: 44, paddingVertical: 11 },
  backButtonText: { color: '#334155', fontSize: 14, fontWeight: '700' },
  addButton: { backgroundColor: '#7bc043', borderRadius: 6, paddingHorizontal: 22, paddingVertical: 12 },
  addButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
