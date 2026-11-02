#!/usr/bin/env bash
# Offline APK build: installed Android SDK + JDK only; no Gradle/Maven downloads.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
JDK="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
BUILD_TOOLS="${SCOPE_ANDROID_BUILD_TOOLS:-$SDK/build-tools/36.0.0}"
ANDROID_JAR="${SCOPE_ANDROID_JAR:-$SDK/platforms/android-37.0/android.jar}"
BUILD="$ROOT/build"
mkdir -p "$BUILD/classes" "$BUILD/dex"
"$JDK/bin/javac" -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -d "$BUILD/classes" "$ROOT/src/com/scope/demo/MainActivity.java"
CLASS_FILES=("$BUILD"/classes/com/scope/demo/*.class)
JAVA_HOME="$JDK" "$BUILD_TOOLS/d8" --lib "$ANDROID_JAR" --output "$BUILD/dex" "${CLASS_FILES[@]}"
"$BUILD_TOOLS/aapt" package -f -M "$ROOT/AndroidManifest.xml" -I "$ANDROID_JAR" -F "$BUILD/unsigned.apk"
(cd "$BUILD/dex" && "$BUILD_TOOLS/aapt" add "$BUILD/unsigned.apk" classes.dex)
"$BUILD_TOOLS/zipalign" -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"
if [ ! -f "$BUILD/demo.keystore" ]; then
    "$JDK/bin/keytool" -genkeypair -keystore "$BUILD/demo.keystore" -storepass android -keypass android -alias androiddebugkey -dname "CN=Scope Local Demo" -keyalg RSA -validity 10000 -noprompt
fi
JAVA_HOME="$JDK" "$BUILD_TOOLS/apksigner" sign --ks "$BUILD/demo.keystore" --ks-pass pass:android --key-pass pass:android --out "$BUILD/scope-demo.apk" "$BUILD/aligned.apk"
JAVA_HOME="$JDK" "$BUILD_TOOLS/apksigner" verify "$BUILD/scope-demo.apk"
printf 'Built %s\n' "$BUILD/scope-demo.apk"
