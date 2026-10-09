# LifeVector Mobile

The LifeVector mobile tracker connects to a nearby LifePi over Bluetooth Low Energy and negotiates an encrypted channel for collecting personal location records.

## Requirements

- Node.js 22.13 or newer
- npm 10 or newer
- JDK 17 and Android Studio for Android builds
- Xcode and CocoaPods for iOS builds

## Development

```bash
npm install
npm start
```

With Metro running, launch Android or iOS from a second terminal:

```bash
npm run android
# or, on macOS
npm run ios
```

The tracker discovers devices whose advertised name begins with `lifepi`. Bluetooth UUIDs and the message size are defined in [`src/config/ble.js`](src/config/ble.js).

## Validation

```bash
npm run bundle:android
npm audit --audit-level=high
cd android && ./gradlew assembleDebug
```

The package is intentionally limited to one BLE stack. React Native autolinking configures the native packages; do not run the removed `react-native link` workflow.
