import { useMemo, useState } from 'react';
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

export default function App() {
  const { width } = useWindowDimensions();
  const wideSidebar = width >= 980;
  const wideEditor = width >= 1100;
  const [protocol, setProtocol] = useState<Protocol>(() => createEmptyProtocol());
  const [files, setFiles] = useState<Record<string, Protocol>>({});
  const [currentFileName, setCurrentFileName] = useState('');
  const [mode, setMode] = useState<EditorMode>('global');
  const [selectedModule, setSelectedModule] = useState<number>(protocolModules[0].number);
  const [activeBatchStage, setActiveBatchStage] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  function loadProtocol(name: string, value: Protocol): void {
    setCurrentFileName(name);
    setProtocol(value);
    setMode('global');
    setSelectedModule(protocolModules[0].number);
    setActiveBatchStage(0);
    setSidebarOpen(false);
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
    const filenames = [...(protocol.filenames ?? Array(8).fill(''))];
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

  function createBatch(): void {
    const name = createUniqueProtocolFileName('My_Batch', '.vnp4', Object.keys(files));
    const fresh: Protocol = {
      ...createEmptyProtocol(name.replace(/\.vnp4$/i, '')),
      single: false,
      filenames: Array(8).fill(''),
    };
    setFiles((current) => ({ ...current, [name]: fresh }));
    loadProtocol(name, fresh);
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
        type: '*/*',
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
      loadProtocol(firstUniqueFile.name, firstUniqueFile.protocol);
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
            .sort((left, right) => left.localeCompare(right));
          if (names.length === 0) {
            return null;
          }
          return (
            <View key={group.extension} style={styles.fileGroup}>
              <Text style={styles.groupTitle}>{group.label}</Text>
              {names.map((name) => (
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
                    <Text style={styles.deleteText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          );
        })}
        {Object.keys(files).length === 0 && <Text style={styles.emptyList}>Import files or create a new protocol.</Text>}
      </View>
    );
  }

  const sidebar = (
    <View style={styles.sidebar}>
      <View style={styles.brand}>
        <Image accessibilityLabel="Brain Broccoli logo" source={require('./assets/brain-broccoli.png')} resizeMode="contain" style={styles.logo} />
        <Text style={styles.brandCaption}>Vielight Neuro Pro 2 Protocol Editor</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={importFiles} disabled={busy} style={styles.uploadButton}>
        <Text style={styles.uploadTitle}>{busy ? 'Importing…' : 'Import protocol files'}</Text>
        <Text style={styles.uploadHint}>Choose .vnp, JSON, or ZIP files</Text>
      </Pressable>
      <ScrollView style={styles.fileScroll}>{renderFileList()}</ScrollView>
    </View>
  );

  const currentModule = getProtocolModule(displayedProtocol, selectedModule);
  const moduleControl = currentModule.moduleControl ?? {};
  const phase = normalizePhase(moduleControl.phase ?? 'A');
  const duration = calculateTotalDuration(displayedProtocol);
  const availableStageFiles = Object.keys(files).filter((name) => !name.toLowerCase().endsWith('.vnp4'));

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
      <View style={styles.panel}>
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>{label}</Text>
          <ToggleButton active={section.active !== false} title={section.active === false ? 'Activate' : 'Activated'} onPress={() => toggleSection(sectionName)} />
        </View>
        {section.active !== false && (
          <View style={styles.fieldGrid}>
            {entries.map(([title, key, unit]) => (
              <NumberField
                key={key}
                label={title}
                value={section[key]}
                unit={unit}
                onChange={(value) => updateSection(sectionName, key, value)}
              />
            ))}
          </View>
        )}
      </View>
    );
  }

  function renderGlobalEditor(): React.JSX.Element {
    const cross = displayedProtocol.cross ?? {};
    return (
      <>
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Global protocol settings</Text>
          {renderGlobalFields('frequency')}
          {renderGlobalFields('power')}
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Cross frequency coupling</Text>
            <ToggleButton active={cross.active !== false} title={cross.active === false ? 'Activate' : 'Activated'} onPress={() => toggleSection('cross')} />
          </View>
          {cross.active !== false && (
            <View style={styles.fieldGrid}>
              <NumberField label="Frequency" value={cross.freq} unit="Hz" onChange={(value) => updateSection('cross', 'freq', value)} />
              <NumberField label="Coupling delay" value={cross.couplingDelay} unit="min" onChange={(value) => updateSection('cross', 'couplingDelay', value)} />
              <NumberField label="Stop coupling" value={cross.stopCoupling} unit="min" onChange={(value) => updateSection('cross', 'stopCoupling', value)} />
            </View>
          )}
          <Text style={styles.fieldLabel}>Notes</Text>
          <TextInput
            accessibilityLabel="Protocol notes"
            value={displayedProtocol.notes ?? ''}
            onChangeText={(notes) => updateDisplayedProtocol((current) => ({ ...current, notes }))}
            placeholder="Add protocol notes"
            style={[styles.textInput, styles.notesInput]}
          />
        </View>
        {isBatch && (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Batch stages</Text>
            {Array.from({ length: 8 }, (_, index) => {
              const stageFile = protocol.filenames?.[index] ?? '';
              return (
                <View key={index} style={styles.batchRow}>
                  <Pressable
                    onPress={() => setActiveBatchStage(index)}
                    style={[styles.stageButton, activeBatchStage === index && styles.activeStage]}
                  >
                    <Text style={styles.buttonText}>Stage {index + 1}</Text>
                  </Pressable>
                  <View style={styles.stageFiles}>
                    {availableStageFiles.map((name) => (
                      <Pressable
                        key={name}
                        onPress={() => setBatchFile(index, name)}
                        style={[styles.stageFile, stageFile === name && styles.selectedFile]}
                      >
                        <Text numberOfLines={1} style={styles.fileName}>{name}</Text>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => setBatchFile(index, '')} style={styles.stageClear}>
                      <Text style={styles.deleteText}>Clear</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </>
    );
  }

  function renderModuleEditor(moduleNumber: number): React.JSX.Element {
    const module = getProtocolModule(displayedProtocol, moduleNumber);
    const control = module.moduleControl ?? {};
    const frequencyActive = displayedProtocol.frequency?.active !== false;
    const powerActive = displayedProtocol.power?.active !== false;
    return (
      <View style={styles.panel}>
        <View style={styles.sectionHeading}>
          <Text style={styles.panelTitle}>{protocolModules.find((item) => item.number === moduleNumber)?.name} module</Text>
          <ToggleButton active={module.active !== false} title={module.active === false ? 'Activate' : 'Active'} onPress={() => updateModule(moduleNumber, { active: module.active === false })} />
        </View>
        <View style={styles.fieldGrid}>
          <NumberField label="Active run time" value={module.activeRunTime ?? module.runTime} unit="min" onChange={(value) => updateModule(moduleNumber, { activeRunTime: value })} />
          <NumberField label="Delay start time" value={module.delayStartTime} unit="min" onChange={(value) => updateModule(moduleNumber, { delayStartTime: value })} />
          {!frequencyActive && (
            <NumberField label="Frequency" value={module.freq ?? control.freq} unit="Hz" onChange={(value) => updateModuleControl(moduleNumber, 'freq', value)} />
          )}
          {!powerActive && (
            <NumberField label="Power" value={module.power ?? control.power} unit="%" onChange={(value) => updateModuleControl(moduleNumber, 'power', value)} />
          )}
        </View>
        {(frequencyActive || powerActive) && (
          <Text style={styles.helpText}>Global sweeps control {frequencyActive && powerActive ? 'frequency and power' : frequencyActive ? 'frequency' : 'power'} for this module.</Text>
        )}
        <View style={styles.sectionHeading}>
          <Text style={styles.fieldLabel}>Phase</Text>
          <View style={styles.phaseOptions}>
            {(['A', 'B'] as const).map((value) => (
              <Pressable
                key={value}
                onPress={() => updateModuleControl(moduleNumber, 'phase', value === 'B' ? 1 : 0)}
                style={[styles.phaseButton, value === phase && (value === 'A' ? styles.phaseAButton : styles.phaseBButton)]}
              >
                <Text style={styles.buttonText}>Phase {value}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.sectionHeading}>
          <Text style={styles.fieldLabel}>Apply cross frequency</Text>
          <ToggleButton active={module.applyCross === true} title={module.applyCross === true ? 'Applied' : 'Off'} onPress={() => updateModule(moduleNumber, { applyCross: module.applyCross !== true })} />
        </View>
      </View>
    );
  }

  function renderAllModules(): React.JSX.Element {
    const activeCount = (displayedProtocol.modules ?? []).filter((module) => module.active !== false).length;
    const makeActive = activeCount < protocolModules.length;
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Edit all modules</Text>
        <Pressable
          onPress={() => {
            protocolModules.forEach(({ number }) => updateModule(number, { active: makeActive }));
          }}
          style={styles.primaryButton}
        >
          <Text style={styles.buttonText}>{makeActive ? 'Activate all modules' : 'Deactivate all modules'}</Text>
        </Pressable>
        <View style={styles.moduleList}>
          {protocolModules.map(({ name, number }) => {
            const module = getProtocolModule(displayedProtocol, number);
            return (
              <View key={number} style={styles.batchRow}>
                <Text style={styles.moduleName}>{name}</Text>
                <ToggleButton active={module.active !== false} title={module.active === false ? 'Inactive' : 'Active'} onPress={() => updateModule(number, { active: module.active === false })} />
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
        <Text style={styles.panelTitle}>Protocol summary</Text>
        <ScrollView horizontal>
          <View>
            <View style={styles.summaryRow}>
              {['Module', 'Power', 'Frequency', 'Cross', 'Phase', 'Delay / time'].map((title) => (
                <Text key={title} style={[styles.summaryCell, styles.summaryHeading]}>{title}</Text>
              ))}
            </View>
            {protocolModules.map(({ name, number }) => {
              const module = getProtocolModule(displayedProtocol, number);
              const control = module.moduleControl ?? {};
              const active = module.active !== false;
              return (
                <View key={number} style={styles.summaryRow}>
                  <Text style={styles.summaryCell}>{name}</Text>
                  <Text style={styles.summaryCell}>{String(active ? module.power ?? control.power ?? 0 : 0)}%</Text>
                  <Text style={styles.summaryCell}>{String(active ? module.freq ?? control.freq ?? 0 : 0)} Hz</Text>
                  <Text style={styles.summaryCell}>{active && module.applyCross ? 'On' : 'Off'}</Text>
                  <Text style={styles.summaryCell}>{active ? normalizePhase(control.phase) : 'A'}</Text>
                  <Text style={styles.summaryCell}>{String(module.delayStartTime ?? 0)} / {String(module.activeRunTime ?? module.runTime ?? 0)} min</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    );
  }

  function renderSidebarModal(): React.JSX.Element {
    return (
      <Modal transparent animationType="slide" visible={sidebarOpen} onRequestClose={() => setSidebarOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel="Close file list" onPress={() => setSidebarOpen(false)} style={styles.modalBackdrop} />
          {sidebar}
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
                    <Text style={styles.buttonText}>☰ Files</Text>
                  </Pressable>
                )}
                <View style={styles.headingText}>
                  <Text numberOfLines={1} style={styles.currentFile}>{currentFileName || 'No File Loaded'}</Text>
                  <Text style={styles.durationText}>Total protocol duration: {duration === undefined ? 'Not specified' : `${duration} minutes`}</Text>
                </View>
              </View>
              <View style={styles.toolbarButtons}>
                <ActionButton title="New File" onPress={createNewProtocol} />
                <ActionButton title="Create Batch" onPress={createBatch} />
                <ActionButton title="Save to Disk" onPress={saveProtocol} />
                <ActionButton title="Export ZIP" onPress={exportZip} />
              </View>
            </View>
            {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <ScrollView contentContainerStyle={styles.workspace}>
              <View style={[styles.editorLayout, wideEditor && styles.editorLayoutWide]}>
                <View style={styles.diagramPanel}>
                  <View style={styles.legend}>
                    <View style={styles.legendItem}><View style={styles.phaseASwatch} /><Text style={styles.legendText}>Phase A</Text></View>
                    <View style={styles.legendItem}><View style={styles.phaseBSwatch} /><Text style={styles.legendText}>Phase B</Text></View>
                  </View>
                  <View style={styles.moduleGrid}>
                    {protocolModules.map(({ name, number }) => {
                      const module = getProtocolModule(displayedProtocol, number);
                      const currentPhase = normalizePhase(module.moduleControl?.phase);
                      const phaseStyle = currentPhase === 'B' ? styles.phaseB : styles.phaseA;
                      return (
                        <Pressable
                          key={number}
                          accessibilityRole="button"
                          accessibilityLabel={`${name}${module.active === false ? ', inactive' : ''}`}
                          onPress={() => {
                            setSelectedModule(number);
                            setMode('module');
                          }}
                          style={[
                            styles.moduleTile,
                            module.active === false ? styles.inactiveTile : phaseStyle,
                            mode === 'module' && selectedModule === number && styles.selectedTile,
                          ]}
                        >
                          <Text style={styles.moduleTitle}>{name}</Text>
                          <Text style={styles.moduleSubtitle}>{module.active === false ? 'Inactive' : `${module.power ?? moduleControl.power ?? 0}% · ${module.freq ?? moduleControl.freq ?? 0} Hz`}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable onPress={() => setMode('all')} style={[styles.modeButton, mode === 'all' && styles.activeMode]}>
                    <Text style={styles.modeText}>Edit all modules</Text>
                  </Pressable>
                  <Pressable onPress={() => setMode('global')} style={[styles.modeButton, mode === 'global' && styles.activeMode]}>
                    <Text style={styles.modeText}>Global protocol settings</Text>
                  </Pressable>
                </View>
                <View style={styles.rightColumn}>
                  {mode === 'global' ? renderGlobalEditor() : mode === 'all' ? renderAllModules() : renderModuleEditor(selectedModule)}
                  {renderSummary()}
                  <View style={styles.panel}>
                    <Text style={styles.panelTitle}>Raw JSON</Text>
                    <ScrollView style={styles.jsonBox} nestedScrollEnabled>
                      <Text selectable style={styles.jsonText}>{JSON.stringify(isBatch ? protocol : displayedProtocol, null, 2)}</Text>
                    </ScrollView>
                  </View>
                </View>
              </View>
            </ScrollView>
          </View>
          {!wideSidebar && renderSidebarModal()}
        </View>
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function ActionButton(props: { title: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={styles.actionButton}>
      <Text style={styles.actionText}>{props.title}</Text>
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

function NumberField(props: { label: string; value: unknown; unit: string; onChange: (value: number) => void }): React.JSX.Element {
  const value = typeof props.value === 'number' && Number.isFinite(props.value) ? String(props.value) : '0';
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
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
  brand: { alignItems: 'center', backgroundColor: '#f8fafc', borderBottomColor: '#cbd5e1', borderBottomWidth: 1, padding: 14 },
  logo: { width: 128, height: 128 },
  brandCaption: { color: '#64748b', fontSize: 12, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  uploadButton: { alignItems: 'center', backgroundColor: '#f8fafc', borderColor: '#94a3b8', borderRadius: 8, borderStyle: 'dashed', borderWidth: 2, margin: 14, padding: 16 },
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
  deleteText: { color: '#dc2626', fontSize: 16, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 6 },
  emptyList: { color: '#64748b', fontSize: 13, lineHeight: 19, padding: 10 },
  main: { flex: 1, minWidth: 0 },
  toolbar: { backgroundColor: '#fff', borderBottomColor: '#cbd5e1', borderBottomWidth: 1, gap: 12, paddingHorizontal: 18, paddingVertical: 14 },
  toolbarHeading: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  headingText: { flex: 1, minWidth: 0 },
  currentFile: { color: '#334155', fontSize: 18, fontWeight: '700' },
  durationText: { color: '#64748b', fontSize: 12, marginTop: 3 },
  toolbarButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  menuButton: { backgroundColor: '#f9a01b', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 9 },
  actionButton: { backgroundColor: '#f9a01b', borderColor: '#f9a01b', borderRadius: 6, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  workspace: { padding: 18 },
  editorLayout: { gap: 18 },
  editorLayoutWide: { alignItems: 'flex-start', flexDirection: 'row' },
  diagramPanel: { alignItems: 'center', flexBasis: 390, flexGrow: 1, flexShrink: 1 },
  legend: { backgroundColor: '#fff', borderColor: '#cbd5e1', borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 18, marginBottom: 16, paddingHorizontal: 14, paddingVertical: 9 },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  legendText: { color: '#334155', fontSize: 13, fontWeight: '600' },
  phaseASwatch: { backgroundColor: '#7bc043', borderColor: '#1a1a1a', borderRadius: 3, borderWidth: 1, height: 15, width: 15 },
  phaseBSwatch: { backgroundColor: '#f9a01b', borderColor: '#1a1a1a', borderRadius: 3, borderWidth: 1, height: 15, width: 15 },
  moduleGrid: { alignContent: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 500, width: '100%' },
  moduleTile: { alignItems: 'center', borderColor: '#1a1a1a', borderRadius: 7, borderWidth: 1, justifyContent: 'center', minHeight: 65, minWidth: '29%', padding: 5 },
  phaseA: { backgroundColor: '#7bc043' },
  phaseB: { backgroundColor: '#f9a01b' },
  inactiveTile: { backgroundColor: '#fff' },
  selectedTile: { borderColor: '#000', borderWidth: 3 },
  moduleTitle: { color: '#1a1a1a', fontSize: 16, fontWeight: '800' },
  moduleSubtitle: { color: '#334155', fontSize: 10, marginTop: 3, textAlign: 'center' },
  modeButton: { backgroundColor: '#fff', borderColor: '#cbd5e1', borderRadius: 7, borderWidth: 2, marginTop: 12, padding: 12, width: '100%' },
  activeMode: { backgroundColor: '#f0fdf4', borderColor: '#7bc043' },
  modeText: { color: '#334155', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  rightColumn: { flex: 1, gap: 14, minWidth: 0, width: '100%' },
  panel: { backgroundColor: '#fff', borderColor: '#cbd5e1', borderRadius: 10, borderWidth: 1, gap: 12, padding: 16 },
  panelTitle: { color: '#7bc043', fontSize: 17, fontWeight: '800' },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  sectionTitle: { color: '#7bc043', flex: 1, fontSize: 14, fontWeight: '800', textTransform: 'uppercase' },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { flexBasis: 150, flexGrow: 1, minWidth: 125 },
  fieldLabel: { color: '#475569', fontSize: 12, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' },
  fieldControl: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  numberInput: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', borderRadius: 6, borderWidth: 1, color: '#1e293b', flex: 1, fontSize: 15, minWidth: 60, paddingHorizontal: 9, paddingVertical: 8, textAlign: 'right' },
  textInput: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', borderRadius: 6, borderWidth: 1, color: '#1e293b', fontSize: 14, padding: 10 },
  notesInput: { minHeight: 68, textAlignVertical: 'top' },
  unit: { color: '#64748b', fontSize: 12, fontWeight: '600', minWidth: 30 },
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
  summaryCell: { borderBottomColor: '#e2e8f0', borderBottomWidth: 1, color: '#334155', fontSize: 11, minWidth: 80, paddingHorizontal: 7, paddingVertical: 8, textAlign: 'center' },
  summaryHeading: { color: '#7bc043', fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  jsonBox: { backgroundColor: '#0f172a', borderRadius: 7, maxHeight: 320, padding: 12 },
  jsonText: { color: '#e2e8f0', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, fontSize: 11 },
  error: { backgroundColor: '#fef2f2', color: '#b91c1c', fontSize: 13, paddingHorizontal: 18, paddingVertical: 10 },
  modalRoot: { backgroundColor: 'rgba(0,0,0,0.45)', flex: 1, flexDirection: 'row' },
  modalBackdrop: { flex: 1 },
});
