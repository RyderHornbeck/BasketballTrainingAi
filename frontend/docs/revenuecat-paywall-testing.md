# RevenueCat Paywall Setup and Testing

The subscription gate is iOS-only. It uses RevenueCat entitlement `premium`, offerings
`default` and `deal`, and Supabase user UUIDs as RevenueCat App User IDs. RevenueCat
CustomerInfo is the access authority; the app does not infer access from a successful
StoreKit dialog.

## App Store Connect

- Accept the Paid Apps Agreement and complete banking and tax information.
- In the app with bundle ID `com.hoopplan.app`, create one auto-renewable subscription
  group and the monthly/annual products used by both RevenueCat offerings.
- Add every required localization, display name, description, price, review screenshot,
  and availability territory.
- Configure any free trial/introductory offer on the products in App Store Connect. The
  app only advertises it when StoreKit reports the user as eligible.
- Keep product durations and prices consistent with the intended annual and monthly
  cards. A lower-priced `deal` must be represented by real purchasable App Store
  products/packages; UI text cannot change StoreKit pricing.
- Add the Privacy Policy and Terms of Service URLs to App Store metadata and include the
  subscription path in App Review notes.
- Create Sandbox Apple IDs for eligible, previously subscribed, expired, billing-retry,
  and Ask to Buy scenarios. Do not sign a sandbox account into iCloud; use the sandbox
  account prompt under App Store developer settings.

## RevenueCat

- Connect the App Store Connect app and in-app purchase key.
- Import each subscription product.
- Create entitlement `premium` and attach every product that should unlock Court Coach.
- Create offering `default` with annual and monthly packages.
- Create offering `deal` with the real lower-priced annual/monthly packages. Both cards
  gracefully support a missing duration, but each offering must have at least one.
- Make `default` the current offering.
- Verify the iOS public SDK key starts with `appl_`. Never put a RevenueCat secret key in
  an `EXPO_PUBLIC_` variable.
- Choose and document the project restore behavior. If a purchase must follow a user who
  deletes and recreates a Court Coach account, configure RevenueCat to transfer on
  restore. If transfers are disabled, restores on a new Supabase UUID will not unlock.
- Confirm sandbox CustomerInfo contains `entitlements.active.premium` after purchase.

## EAS configuration and build

Set `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` in every EAS environment used by an iOS build:

- `development` for the development profile
- `preview` for staging and TestFlight profiles in this repository
- `production` for App Store production builds

Use an environment-scoped EAS variable or secret; do not commit the live key. Confirm it
is embedded with `npx expo config --type public` without printing unrelated secrets.

`react-native-purchases` is native code. Expo Go and an old installed binary cannot test
this change, and an OTA update alone cannot add the SDK. Create a fresh development or
TestFlight build:

```sh
npm run build:dev:ios
npm run build:testflight:ios
```

## Physical-device sandbox checklist

### Gate and identity

- Create a new Supabase account after completing onboarding. Confirm the paywall appears
  before onboarding answers are submitted or initial plan generation begins.
- Force-quit on the paywall, reopen, and confirm protected tabs never flash.
- Buy premium, force-quit, and confirm the app opens normally with cached/verified
  CustomerInfo.
- Sign out, sign into a different Supabase account, and confirm entitlements do not leak
  between RevenueCat App User IDs.
- Delete an account, recreate it, and verify the chosen RevenueCat transfer/restore
  policy behaves as documented.
- Expire or revoke the sandbox subscription and foreground/relaunch the app. Confirm the
  hard paywall returns.

### Products and truthful display

- Verify localized annual/monthly prices, currency, billing periods, dates, monthly
  equivalent, and positive savings against the Apple purchase sheet.
- Test an intro-eligible Apple ID and confirm the free-trial timeline and CTA appear.
- Test an ineligible and an unknown-eligibility result; neither may claim a trial.
- Remove annual, then monthly, from a test offering and confirm the remaining package is
  selected without a crash.
- Temporarily remove/misname each offering and verify a retryable configuration screen,
  not an infinite loader or free access.

### Purchase, cancellation, and restore

- Purchase annual and monthly independently. Confirm access unlocks only after
  `premium` is active and Back cannot return to the paywall.
- Cancel Apple’s purchase sheet on the default paywall. Confirm the white/purple `deal`
  offering appears and the selected duration is retained when available.
- Cancel on the deal paywall. Confirm it stays on deal and does not loop.
- Test purchase cancellation followed by a delayed CustomerInfo update; active premium
  must still unlock.
- Rapidly tap purchase and restore. Confirm only one request runs at a time.
- Test Ask to Buy/pending, purchases disabled, unavailable product, already purchased,
  network timeout, and operation-in-progress errors.
- Restore with the purchasing Apple ID and with an Apple ID that owns nothing.
- Restore after reinstall and after signing into the correct Supabase account.

### Connectivity and lifecycle

- Launch offline with previously verified premium and confirm cached premium access is
  preserved.
- Launch offline without premium and confirm offerings fail safely with Retry and Sign
  Out; offline state must never grant access.
- Disconnect during offering load, purchase, entitlement verification, restore, and
  onboarding submission. Reconnect and retry each operation.
- Force-quit immediately after purchase, after entitlement activation, and during
  `finish-setup`. Relaunch and confirm setup resumes without duplicate plan generation.
- Change subscription state outside the app, then foreground it and confirm the
  CustomerInfo refresh updates the gate without polling.

### UX, accessibility, and legal

- Test small and largest Dynamic Type sizes on a supported iPhone and iPad.
- With VoiceOver, verify plan cards are announced as selectable radio options with price,
  period, trial, savings, selection, and disabled state.
- Confirm purchase, restore, legal, Retry, and Sign Out controls have usable tap targets
  and cannot be double-submitted.
- Open Privacy and Terms links from default paywall, deal paywall, and Profile.
- Confirm all loading states are branded skeletons and deal/default transitions are
  visually stable.

## Release validation

Run before creating the native release:

```sh
npx tsc --noEmit
npm run lint
npx expo config --type public
npx expo-doctor
```

Then test a TestFlight build with a sandbox/TestFlight Apple account. Before submission,
verify App Store subscription metadata is approved or Ready to Submit, RevenueCat
offerings are live, agreements are active, the production EAS environment contains the
correct public key, and App Review notes explain how to reach the paywall and restore
purchases.
