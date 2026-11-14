Getting the app ready for deployment for others
- Remove all "Gibson" hardcoded.
- Change first-time setup to be more user friendly.
- Add better instructions for deployment on Github, including how to set up Plaid integration.

## App Store & Google Play Store Deployment Checklist

### Phase 1: Native Mobile Wrapper & Build Setup (Capacitor)
- [ ] Initialize Capacitor in `frontend/` (`@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`).
- [ ] Dynamic API URL & Environment Configuration (replace relative `/api` paths in `frontend/src/api.js` with `VITE_API_BASE_URL`).
- [ ] Capacitor Cookie & Credentials Support (ensure session cookies/credentials work smoothly within mobile WebViews).
- [ ] Plaid Link in Native App (configure Universal Links & Android App Links for OAuth redirects, e.g., `PLAID_REDIRECT_URI`).
- [ ] Biometrics & Passkeys Native Bridge (`@capacitor/biometrics` to bridge Passkey / Face ID / Touch ID unlock natively on iOS and Android).

### Phase 2: App Multi-Tenancy & Product Polish
- [ ] Remove hardcoded "Gibson" branding across frontend, backend, database seeds, and notifications.
- [ ] Multi-tenant or self-hosted configuration (isolated household data vs self-hosted server connection on onboarding).
- [x] Account Deletion (mandatory for Apple & Google: user-facing "Delete Account" button and backend cleanup endpoint `DELETE /api/account`).

### Phase 3: Legal, Privacy & Compliance
- [ ] Privacy Policy & Terms of Service publicly hosted URLs (disclosing financial data collection, Plaid integration, biometrics).
- [ ] Apple App Privacy Nutrition Label (Financial Info, User Content, Identifiers).
- [ ] Provide Apple with review demo credentials + Plaid Sandbox test credentials in App Review Notes.
- [ ] Google Play Data Safety Section & Financial App Declaration.

### Phase 4: Push Notifications & Device Permissions
- [ ] Native Push Notification Gateway (integrate APNs + FCM via `@capacitor/push-notifications` to register tokens in `push_subscriptions`).
- [ ] Safe-Area Insets & Viewport Handling (audit Dynamic Island, notches, and keyboard avoidance for expense inputs).

### Phase 5: Apple App Store Specifics (iOS)
- [ ] Apple Developer Program enrollment ($99/year).
- [ ] Xcode assets, App Icons (1024x1024), splash screen, and capabilities (Push Notifications, Background Modes, Associated Domains).
- [ ] App Store Connect record, screenshots (6.7" & 6.5" iPhones), keywords, and description.
- [ ] TestFlight build testing on physical iPhones.
- [ ] Submit for App Store Review.

### Phase 6: Google Play Store Specifics (Android)
- [ ] Google Play Developer Account ($25 one-time fee) & identity verification.
- [ ] Android Studio production release signing (upload keystore) & build Android App Bundle (`.aab`).
- [ ] Store listing assets (App Icon 512x512, Feature Graphic 1024x500, screenshots), content rating, and target audience declaration.
- [ ] Internal/Closed testing track (complete 14-day closed testing with 20 testers if required for personal accounts).
- [ ] Submit for Google Play Production Review.
