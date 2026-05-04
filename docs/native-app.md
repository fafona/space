# Faolla Native App

This project can be wrapped as a native iOS/Android app with Capacitor.

## Setup

```bash
npm install
npm run app:add:ios
npm run app:add:android
```

## Build Web And Sync

```bash
npm run build
npm run app:sync
```

By default the app loads `https://www.faolla.com`. To target another deployed environment:

```bash
$env:CAPACITOR_SERVER_URL = "https://staging.faolla.com"
npm run app:sync
```

## Open Native Projects

```bash
npm run app:open:ios
npm run app:open:android
```

## Android Package

Debug APK for direct testing:

```bash
npm run app:android:debug
```

The debug APK is generated at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

For a release APK, create a private keystore and copy the signing template:

```bash
keytool -genkeypair -v -keystore android/release/faolla-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias faolla
copy android\keystore.properties.example android\keystore.properties
npm run app:android:release
```

Do not commit `android/keystore.properties` or any `.jks`/`.keystore` file.

The native shell locks the app to portrait by default. Tank Battle switches to landscape inside the native app.
