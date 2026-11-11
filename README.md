# brainbroccoli

A NeuroPro2 protocol editor and session runner for the Vielight Neuro Pro 2,
built with Expo and React Native. It runs on Android, iOS, and the desktop
(Linux, Windows, macOS via Electron), following
[brainkandi](https://github.com/liquid-brains/brainkandi)'s TypeScript,
Electron, and artifact-producing CI structure. Prebuilt binaries are on the
[releases page](https://github.com/liquid-brains/brainbroccoli/releases).

## Features

- **Editor:** import `.vnp0`–`.vnp4` or JSON protocol files individually or from
  ZIP archives. Edit global and per-module settings, multi-select modules with a
  long press, and review a protocol summary table, a module diagram, and the raw
  JSON. Save protocols or export an archive. Saving a system file creates an
  editable user copy.
- **Controller sync:** download protocol files from the controller, save or
  delete user files on it, and see which local files are not yet synced.
  Downloading also fetches the Extended (`.vnp2`) stage files that batches use.
  Extended files stay hidden until unlocked in Settings.
- **Protocol Runner:** star protocols and batches, build sequences of protocols
  and rest intervals, and run them on the controller with a journal of each
  session. On Android a foreground service keeps a session running while the
  device is locked.
- **Settings and storage:** files, sync state, runner data, and settings persist
  on the device. Settings includes the theme (Broccoli, or system light/dark with
  teal and amber accents) and **Erase All Data**. Tablets rotate freely; phones
  stay in portrait.

## Development

Use Node.js 22 or newer and npm:

```sh
npm ci
npm start
npm run android
npm run ios       # requires macOS and Xcode
npm run web
```

The file list adapts to the available screen width. Device requests are sent only
when you use a controller action (download, save, delete, or run).

## NeuroPro2 integration

`src/core/device.ts` provides `createNeuroPro2Device(ip, options)`, backed by
`@liquid-brains/brainlight`. Import the library's NeuroPro module rather than its
root entry point, which runs a Node.js CLI. For example, a read-only request:

```ts
import { createNeuroPro2Device } from './src/core/device';

const device = createNeuroPro2Device('192.168.0.58');
const files = await device.listFiles('vnp2');
```

Use the controller's IPv4 address or host name (Settings → IP address). The
factory validates it and defaults to a 10-second request timeout; brainlight
options (including an injected `fetch`) can be supplied for testing or other
transports. Android permits HTTP for the device; iOS declares local network
access.

**Download Controller Files** lists the controller's `.vnp0`, `.vnp2` and `.vnp3`
files with `downloadControllerFiles` and loads them into the editor. In the
Electron shell the requests go through a preload bridge to the main process,
which only allows read-only controller paths (`getlistfile`, `getlistbatchfile`,
`filedata`, `batchfiledata`) over HTTP, so no CORS support is needed on the
device and the sandbox and content security policy stay unchanged. In a plain
browser the device must allow CORS. The editor otherwise modifies protocol files
locally. **Save to Controller** and **Delete** (user `.vnp0`/`.vnp4`
files only) are the only commands that change a device. They call brainlight's
`saveFile` and `deleteFile`, and the bridge also allows the file save, delete and
list-update commands they use, plus `stop`, `filedatarun`, `run` and `activate` for the Protocol Runner. Saving a batch
uploads its referenced user `.vnp0` stage files first.

The Protocol Runner does not run controller batches directly. Starring a batch
creates a sequence with the same name and steps, and **New Sequence** builds an
ordered list of protocols and rest intervals (no 8-phase limit) that is stored
only in the app. Running it starts each protocol in turn and waits for it to
finish before starting the next; a step that never reports completion is stopped
shortly after its expected length.

## Validation and builds

```sh
npm run typecheck
npm test
npm run bundle:android
npm run bundle:linux
npm run linux          # run the exported web bundle in Electron
npm run package:desktop
make apk               # requires Android SDK/NDK and Java 17
make ipa               # produces an unsigned .app, not a distributable .ipa
```

Electron requires a working OS sandbox. Configure the host's sandbox support
when possible. The packaged Linux launcher passes `--no-sandbox` for hosts that
cannot support Electron's OS sandbox; only run the packaged app with trusted files
and content.

CI checks types/tests and builds Android, unsigned iOS, Linux, Windows, and macOS
artifacts on main pushes and pull requests. Native projects and build outputs
are generated and ignored. Store publishing and signing are not configured.

The scaffold uses current Expo/Electron/Vitest releases rather than inheriting
known-vulnerable tool versions from the reference. Transitive overrides keep
glob/minimatch patched and deepmerge on an unaffected release.
