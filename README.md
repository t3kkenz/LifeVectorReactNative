# LifeVector

LifeVector is a private personal-location tracker. The mobile app finds a nearby LifePi over Bluetooth Low Energy, establishes an encrypted session, and collects the records used to understand where your time goes.

The current mobile experience includes:

- LifePi discovery and signal-strength display
- explicit connect and disconnect controls
- persistent device identity with RSA key exchange
- an AES-CTR encrypted data channel
- connection monitoring while the tracker is active
- Android and iOS projects generated for React Native 0.87

## Mobile tracker

The application is in [`LifeVectorMobile`](LifeVectorMobile). It requires Node.js 22.13 or newer. Android development uses JDK 17, Android Studio, and the Android 37 SDK; iOS development requires a current Xcode and CocoaPods installation.

Install the JavaScript packages:

```bash
cd LifeVectorMobile
npm install
```

For Android, create `android/local.properties` when Android Studio has not created it already:

```properties
sdk.dir=/absolute/path/to/Android/sdk
```

Start Metro and launch the target in another terminal:

```bash
npm start
npm run android
```

On macOS, install pods before the first iOS run:

```bash
cd ios
bundle exec pod install
cd ..
npm run ios
```

The LifePi must advertise a name beginning with `lifepi` and expose the service and secure-session characteristics configured in [`src/config/ble.js`](LifeVectorMobile/src/config/ble.js).

## Security and data ownership

LifeVector generates its key pair on the phone and stores the private key and negotiated session values in the application sandbox. The interface does not send tracker records to a hosted service. Production builds should replace the current application storage with platform-backed key storage before handling sensitive real-world data.

## Maintenance

Run the following checks before publishing a build:

```bash
npm run bundle:android
npm audit --audit-level=high
cd android && ./gradlew assembleDebug
```

((Project))
