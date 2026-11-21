# Brain Broccoli: Getting Started Guide

A step-by-step guide for first-time users. No technical background needed.

Brain Broccoli is a free app for creating and running light-therapy protocols
on the **Vielight Neuro Pro 2** controller.

## 1. What you need

- A Vielight Neuro Pro 2 (powered on).
- A phone, tablet, or computer: Android, Windows, macOS, or Linux. (An iOS
  build exists but is for testing only and can't be installed on a real iPhone yet.)
- The device and the Neuro Pro 2 on the **same Wi-Fi network** (see step 3).

## 2. Download and install

1. Open the download page: <https://github.com/liquid-brains/brainbroccoli/releases>
   and click the newest version (for example **v0.3.0**).
2. Scroll down to **Assets** and click the one file for your device. Ignore the
   two "Source code" items.

   | Your device | Click this file |
   |---|---|
   | Android phone/tablet | `BrainBroccoli-android.apk` |
   | Windows | `BrainBroccoli-windows.zip` |
   | macOS | `BrainBroccoli-macos.zip` |
   | Linux | `BrainBroccoli-linux.tar.gz` |
   | iPhone/iPad | not available yet (`BrainBroccoli-ios.zip` is an unsigned test build) |

3. Install it. There is no installer for the desktop versions: you unzip the
   download and run the app from the unzipped folder.
   - **Android:** open the downloaded `.apk` (check your Downloads folder or the
     browser's download notification). If asked, allow "Install unknown apps"
     for your browser or Files app, then tap Install. The app appears as
     **BrainBroccoli**.
   - **Windows:** right-click `BrainBroccoli-windows.zip` and choose **Extract
     All**. Open the extracted folder (`BrainBroccoli-win32-x64`) and
     double-click **BrainBroccoli.exe**. If SmartScreen warns you, choose
     *More info → Run anyway* (the app isn't commercially signed). Don't run it
     from inside the zip; extract it first.
   - **macOS:** double-click `BrainBroccoli-macos.zip` to unzip it, drag
     **BrainBroccoli** to Applications, then right-click it and choose **Open**
     the first time (the app isn't notarized). If macOS still refuses, go to
     *System Settings → Privacy & Security* and click **Open Anyway**.
   - **Linux:** extract the archive (right-click → Extract Here, or
     `tar -xzf BrainBroccoli-linux.tar.gz`), open the `BrainBroccoli-linux-x64`
     folder and run **BrainBroccoli** (double-click, or `./BrainBroccoli` in a
     terminal).

## 3. Connect to your controller

1. Connect the Neuro Pro 2 to your Wi-Fi and find its IP address
   (for example `192.168.1.100`) using the Vielight instructions or your router's
   device list.
2. Make sure your phone/computer is on the same Wi-Fi.
3. In Brain Broccoli open **Settings** and type the address into **IP address**.

The app only talks to the controller when you press a controller action
(download, save, delete, or run).

## 4. Look at what's on the controller

1. Open the **Editor**.
2. Choose **Download Controller Files**. The protocols stored on the controller
   appear in the list.
3. Tap a protocol to see its settings, module diagram, and summary.

Nothing changes on the controller until you choose **Save to Controller**.

## 5. Run a protocol (Runner)

1. In the **Editor**, **star** the protocols you want to use. Starred items
   appear in the **Runner**.
2. Open the **Runner**, pick a protocol, and press run. The controller starts
   the session.
3. Afterward, the Runner's history lets you rate and comment on each session.

Tips:
- Drag items to reorder them, and use folders to organize them.
- A **sequence** chains protocols and rest intervals one after another. Use
  **New Sequence**, or star a batch to make one automatically. Sequences are
  stored in the app only, and the app tries to keep your device awake while one
  runs.

## 6. Create or change a protocol (Editor)

1. Open the Editor and select a protocol (or import a file by dragging it in).
2. Edit one module at a time, or all of them at once. Long-press LEDs in the
   diagram to select several.
3. Press **Save to Controller** to store it. An orange ● beside a file means it
   has changes not yet saved to the controller.

Saving a built-in (system) file creates your own editable copy.

## Troubleshooting

- **Can't download or save:** check the IP address, that the controller is on,
  and that both devices share the same Wi-Fi.
- **Connection is unreliable with `np1.local`:** the app's default hostname
  (`np1.local`) doesn't always resolve reliably. Enter the controller's numeric
  IP address in **Settings → IP address** instead.
- **Something else:** report it at
  <https://github.com/liquid-brains/brainbroccoli/issues> or on the forum.
