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

The native shell locks the app to portrait by default and lets game pages use their in-page controls instead of browser navigation.
