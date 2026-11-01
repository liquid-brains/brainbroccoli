# brainbroccoli

A responsive NeuroPro2 protocol editor built with Expo and React Native,
following [brainkandi](https://github.com/liquid-brains/brainkandi)'s
TypeScript, Electron, and artifact-producing CI structure. Import `.vnp0`–`.vnp4`
or JSON protocol files individually or from ZIP archives, edit protocol settings
and modules, and save protocols or export an archive. Files are held in memory
for the current app session; saving to a controller and session controls are not
implemented.

## Development

Use Node.js 22 or newer and npm:

```sh
npm ci
npm start
npm run android
npm run ios       # requires macOS and Xcode
npm run web
```

The file list adapts to the available screen width. Device requests are sent only when
you choose Download Controller Files.

## NeuroPro2 integration

`src/core/device.ts` provides `createNeuroPro2Device(ip, options)`, backed by
`@liquid-brains/brainlight`. Import the library's NeuroPro module rather than its
root entry point, which runs a Node.js CLI. For example, future application code
can make a read-only request with:

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
