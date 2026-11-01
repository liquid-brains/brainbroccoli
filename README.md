# brainbroccoli

An app skeleton for a NeuroPro2 protocol editor, following
[brainkandi](https://github.com/liquid-brains/brainkandi)'s Expo/React Native,
TypeScript, Electron, and artifact-producing CI structure. Protocol editing,
storage, and session controls are intentionally not implemented.

## Development

Use Node.js 24 and npm:

```sh
npm ci
npm start
npm run android
npm run ios       # requires macOS and Xcode
npm run web
```

The initial screen is only a placeholder. No device requests are sent on startup.

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

Use the device's actual IPv4 address on the same local network. The factory
validates the address and defaults to a 10-second request timeout; brainlight
options (including an injected `fetch`) can be supplied for testing or future
platform transports. Android permits HTTP for the device; iOS declares local
network access. Browser/Electron requests still require device CORS support or
a future scoped transport adapter; the desktop shell does not disable web
security or sandboxing. Its content security policy currently allows only
same-origin connections; a future transport must explicitly authorize device
requests. No protocol is created, changed, or run by this skeleton.

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
when needed rather than adding `--no-sandbox` to the launcher.

CI checks types/tests and builds Android, unsigned iOS, Linux, Windows, and macOS
artifacts on main pushes and pull requests. Native projects and build outputs
are generated and ignored. Store publishing and signing are not configured.

The scaffold uses current Expo/Electron/Vitest releases rather than inheriting
known-vulnerable tool versions from the reference. Transitive overrides keep
glob/minimatch patched and deepmerge on an unaffected release.
