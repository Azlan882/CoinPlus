# 📱 How to Get Your CoinPulse Android APK through GitHub

This repository contains a pre-configured, automated **GitHub Actions CI/CD workflow** (`.github/workflows/build-apk.yml`) that compiles the native Android APK in the cloud with zero local setup required.

---

## 🚀 Method 1: Automated Build via GitHub Actions (Recommended)

### Step 1: Push This Codebase to a GitHub Repository
If you haven't initialized your git remote yet:
```bash
git init
git add .
git commit -m "feat: CoinPulse production-ready mining app with Android CI"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

---

### Step 2: GitHub Automatically Builds Your APK
1. Open your repository on **GitHub.com**.
2. Click on the **Actions** tab at the top.
3. You will see a running workflow named **"Build Android APK"**.
4. GitHub automatically:
   - Sets up Ubuntu, Node.js 20, Java 21 (matching Capacitor 8 requirements), and the Android SDK.
   - Installs dependencies cleanly via `npm ci` and builds optimized web assets.
   - Compiles the native Android Gradle project.
   - Produces the native **`CoinPulse-v1.0-debug.apk`**.

*(The build takes approximately 2 to 3 minutes).*

---

### Step 3: Download the APK Directly
1. Click on the completed workflow run (with the green checkmark ✅).
2. Scroll down to the **Artifacts** section at the bottom of the summary page.
3. Click on **`CoinPulse-Android-APK`**.
4. A `.zip` file containing **`CoinPulse-v1.0-debug.apk`** will download immediately to your phone or computer!
5. Unzip and tap on the `.apk` on your Android device to install and test.

---

### ⚡ Manual One-Click Trigger from GitHub
You can also trigger a fresh APK build anytime without pushing new code:
1. Go to **Actions** → **Build Android APK** in the left sidebar.
2. Click the **"Run workflow"** button on the right.
3. Select branch `main` and click **Run workflow**.

---

## 🏷️ Automated GitHub Release (Tag Triggers)
If you want GitHub to automatically publish an official release with the APK file attached:
```bash
git tag v1.0.0
git push origin v1.0.0
```
GitHub Actions will compile the APK and attach `CoinPulse-v1.0-debug.apk` directly to the **Releases** page of your GitHub repository.

---

## 💻 Method 2: Local Android Studio Build (Alternative)
If you prefer building locally on your computer with Android Studio:
```bash
# 1. Install dependencies & build web bundle
npm install
npm run build

# 2. Sync native Android directory
npx cap sync android

# 3. Build APK directly via Gradle wrapper
cd android
./gradlew assembleDebug

# Output APK location:
# android/app/build/outputs/apk/debug/app-debug.apk
```
Or open the `android` folder in **Android Studio**:
```bash
npx cap open android
```
Then select **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**.

---

## 📦 Android Package Details
- **App Name**: CoinPulse
- **Package ID**: `com.coinpulse.mining`
- **Default Permissions**: Internet connectivity (`android.permission.INTERNET`)
- **Target SDK**: Android 14+ (API 34)
- **Minimum SDK**: Android 7.0 (API 22)
