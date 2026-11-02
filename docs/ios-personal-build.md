# Install this fork on your own iPhone

This builds Readest from source on a Mac and installs it on an iPhone over USB, signed with your own Apple ID. A free Apple ID works. Apps signed with a free account stop opening after 7 days; run the build again to renew. A paid developer account lasts a year.

The build installs as its own app (`com.<your-mac-username>.readest.dev`), so it sits next to the App Store version of Readest if you have it.

## What's different from the App Store app

A free Apple ID can't sign some of Readest's capabilities, so the script turns them off for this build:

- Sign in with Apple and iCloud sync
- The home screen reading widget and "Share to Readest" from other apps (they can't pass data to the app)
- CarPlay audio and web links that open the app

Reading, the AI features (Claude lookup, Book Notes, animations) and Read Aloud with ElevenLabs all work.

## One-time setup on the Mac

1. Install **Xcode** from the App Store, open it once, and let it install the iOS platform.
2. Sign in to Xcode with your Apple ID: Xcode > Settings > Accounts > + > Apple ID. Select the account, choose your "(Personal Team)", click **Manage Certificates**, and add an **Apple Development** certificate.
3. Install the tools in Terminal:

   ```bash
   # Homebrew, if you don't have it: https://brew.sh
   brew install node pnpm libimobiledevice ideviceinstaller
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust; accept the defaults
   rustup target add aarch64-apple-ios
   ```

4. Get the code:

   ```bash
   git clone https://github.com/sean-burner/readest.git
   cd readest
   git submodule update --init --recursive
   pnpm install
   pnpm --filter @readest/readest-app setup-vendors
   ```

## One-time setup on the iPhone

1. Connect the iPhone to the Mac with a cable, unlock it, and tap **Trust** when it asks about the computer.
2. Turn on Developer Mode: Settings > Privacy & Security > Developer Mode, then restart the phone when it asks. (The option shows up after the phone has been connected to Xcode once. If you don't see it, open Xcode > Window > Devices and Simulators with the phone plugged in.)

## Build and install

With the iPhone plugged in and unlocked:

```bash
cd apps/readest-app
bash scripts/ios-personal-build.sh
```

The first build takes 15 to 30 minutes because it compiles all the Rust code, and needs about 20 GB of free disk space. Later builds are faster.

The first time you open the app, iOS blocks it. Go to Settings > General > VPN & Device Management, tap your Apple ID, and tap **Trust**.

Then in the app, open Settings > AI, turn it on, pick Claude (Anthropic) and paste your Anthropic API key. Do the same with your ElevenLabs key under Read Aloud if you want ElevenLabs voices.

## Updating to the latest changes

```bash
git pull
pnpm install
cd apps/readest-app
bash scripts/ios-personal-build.sh
```

This also renews the 7-day limit on a free account.

## If something goes wrong

- **"no team id"**: you haven't added an Apple Development certificate yet (setup step 2). You can also pass the id yourself: `APPLE_TEAM_ID=ABCDE12345 bash scripts/ios-personal-build.sh`. Your team id is in Xcode > Settings > Accounts, or in Keychain Access under the "Apple Development" certificate's Organizational Unit.
- **Signing or provisioning errors**: run with `KEEP_PATCH=1` so the project stays switched to your account, open `src-tauri/gen/apple/Readest.xcodeproj` in Xcode, choose your team under Signing & Capabilities for the Readest_iOS, ShareExtension and ReadestWidget targets, then run the script again. Afterwards undo the changes with `git checkout -- src-tauri`.
- **Free account limits**: a free Apple ID can have 3 of your own apps installed at once and create up to 10 app ids a week. Keep the same `BUNDLE_ID` between builds.
- **"No space left on device"**: free about 20 GB and run the script again; compiled Rust code is kept. Old iOS debug symbols in `~/Library/Developer/Xcode/iOS DeviceSupport` are safe to delete.
- **Install fails**: unlock the phone and check it still trusts the Mac. To install by hand, drag the `.ipa` from `src-tauri/gen/apple/build/arm64/` onto the phone in Xcode > Window > Devices and Simulators.
