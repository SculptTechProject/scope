Scope includes scripts from the user's SculptTechProject/bypass-scripts-adb repository. The notices below preserve that distribution's provenance. Scope's Rust device manager and Python worker are new integration code; they do not depend on an installed HTTP Toolkit instance. The original JavaScript files and CA template are vendored unchanged. Scope substitutes its own public CA and chosen proxy port only in runtime copies. The runtime CA template also uses a Scope-specific temporary directory and certificate filename.

# Third-party notices

The project is distributed under **AGPL-3.0-or-later**; see [LICENSE](LICENSE).
Third-party components retain the copyright notices and license terms described below.
The project name does not imply affiliation with HTTP Toolkit or Frida.

## Rust, frontend packages and fonts

Collected license texts and package/source inventories are included in
[`resources/licenses/index.html`](resources/licenses/index.html),
[`rust.json`](resources/licenses/rust.json) and
[`frontend.json`](resources/licenses/frontend.json). These include the
Manrope and IBM Plex Mono font licenses and the Lucide icon license. The
Rust 1.99.1 standard-library notices are retained separately in
[`resources/licenses/rust-standard-library/`](resources/licenses/rust-standard-library/).
Each collection records its source lockfile hash; regeneration is described in
[`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md). Third-party terms remain in force.

## HTTP Toolkit interception scripts

Files: `resources/frida/config-template.js` and `resources/frida/android/*.js`.

- Authors: Tim Perry and HTTP Toolkit contributors; `android-disable-root-detection.js` also credits Riyad Mondal.
- License: **AGPL-3.0-or-later**. The original notices remain in each source file; the full license is included in [LICENSE](LICENSE).
- Upstream project: [frida-interception-and-unpinning](https://github.com/httptoolkit/frida-interception-and-unpinning).
- Exact distribution source: [HTTP Toolkit Server v1.26.1, overrides/frida](https://github.com/httptoolkit/httptoolkit-server/tree/1abef0adc96d07bd64377e85e847025a55bac2ac/overrides/frida), commit `1abef0adc96d07bd64377e85e847025a55bac2ac`.
- Local changes: `config.js` was renamed to `config-template.js`. The JavaScript content is otherwise unchanged from that distribution. Runtime certificate and proxy substitutions are written to the ignored `.runtime/` directory, rather than these source files.

## HTTP Toolkit system CA installation template

File: `resources/device/install-system-ca.template.sh`.

- Authors: Tim Perry and HTTP Toolkit contributors.
- License: **AGPL-3.0-or-later**; see [LICENSE](LICENSE).
- Source: the `injectSystemCertificate` shell template in [HTTP Toolkit Server v1.26.1, adb-commands.ts](https://github.com/httptoolkit/httptoolkit-server/blob/1abef0adc96d07bd64377e85e847025a55bac2ac/src/interceptors/android/adb-commands.ts).
- Modified on **2026-09-30**: extracted the embedded shell script into a standalone template, added provenance and license comments, and retained `${certificatePath}` and `${injectionScriptPath}` as substitutions supplied by the launcher. Any later changes should keep this notice up to date.

## Frida Java bridge

File: `resources/frida/frida-java-bridge.js`.

This is the prebuilt **frida-java-bridge 7.0.13** bundle distributed by HTTP Toolkit Server v1.26.1. Its content is unchanged. It is not relicensed as original HTTP Toolkit code.

- Upstream authors: Frida contributors.
- Declared upstream license: **LGPL-2.0 WITH WxWindows-exception-3.1**, as recorded in the [7.0.13 package manifest](https://github.com/frida/frida-java-bridge/blob/6ab2a63e4b02ab881f11ea06632cebea4b1b435e/package.json).
- Full license texts: [GNU Library GPL version 2](resources/frida/licenses/LGPL-2.0.txt) and [wxWindows Library Licence version 3.1, including its exception](resources/frida/licenses/WxWindows-Library-Licence-3.1.txt).
- Corresponding bridge source: [frida-java-bridge v7.0.13](https://github.com/frida/frida-java-bridge/tree/6ab2a63e4b02ab881f11ea06632cebea4b1b435e), commit `6ab2a63e4b02ab881f11ea06632cebea4b1b435e`; [source archive](https://github.com/frida/frida-java-bridge/archive/6ab2a63e4b02ab881f11ea06632cebea4b1b435e.tar.gz).
- Bundle source: [HTTP Toolkit Server v1.26.1, frida-java-bridge.js](https://github.com/httptoolkit/httptoolkit-server/blob/1abef0adc96d07bd64377e85e847025a55bac2ac/overrides/frida/frida-java-bridge.js).

The generation command provided in the bundle header uses `frida-compile` to bundle the following entry point:

```js
import Java from 'frida-java-bridge';
globalThis.Java ||= Java;
```

The bundle includes Buffer, Base64 and IEEE754 helper code from Frida's JavaScript shims. The original package notices are included here:

| Component | Authors / copyright | License text | Source |
| --- | --- | --- | --- |
| Buffer | Feross Aboukhadijeh and other contributors | [MIT](resources/frida/licenses/buffer-MIT.txt) | [frida/gumjs-buffer](https://github.com/frida/gumjs-buffer) |
| Base64 | Copyright (c) 2014 Jameson Little | [MIT](resources/frida/licenses/base64-MIT.txt) | [frida/gumjs-base64](https://github.com/frida/gumjs-base64) |
| IEEE754 | Copyright 2008 Fair Oaks Labs, Inc. | [BSD-3-Clause](resources/frida/licenses/ieee754-BSD-3-Clause.txt) | [frida/gumjs-ieee754](https://github.com/frida/gumjs-ieee754) |

The helper license texts were copied verbatim from the published `@frida/buffer@7.0.4`, `@frida/base64-js@2.0.3` and `@frida/ieee754@2.0.2` packages. These versions appear in the bridge's upstream 7.0.13 development lockfile; HTTP Toolkit does not include a build lockfile with its prebuilt bundle, so the precise helper versions embedded in that artifact are not asserted here.

The GNU Library GPL text was obtained from [GNU](https://www.gnu.org/licenses/old-licenses/lgpl-2.0.txt). The wxWindows license and exception were obtained from [Frida Gum 17.9.1 COPYING](https://github.com/frida/frida-gum/blob/17.9.1/COPYING), preserving that license section verbatim.

The extracted CA installation template has SHA-256 `201fa259470c9fa4e1b70dd3a020e7807f762bf838346ae2f8297f62586eb67b` after the modifications listed above.

## Vendored JavaScript integrity

These SHA-256 values identify the unmodified JavaScript copied from HTTP Toolkit Server v1.26.1. The renamed configuration template has the same bytes as upstream `config.js`.

| File | SHA-256 |
| --- | --- |
| `resources/frida/android/android-certificate-unpinning-fallback.js` | `5190e449ae590e896f362a5751267199c2bef5417f69635715705def00462cd7` |
| `resources/frida/android/android-certificate-unpinning.js` | `21cfb61cc492c557fc55e2b504a2e5e8f679b3515bff824acb12b14975381d9b` |
| `resources/frida/android/android-disable-root-detection.js` | `25e91287ab38111a188eb5786fa47586a252c711f0e401b9dc6a7c727600fda8` |
| `resources/frida/android/android-proxy-override.js` | `aed9941c65bd9d23789f9e54e11d37cd95ab83c5818f0c39a36e4581b05ad688` |
| `resources/frida/android/android-system-certificate-injection.js` | `f751f783f30fc9b296bf7f05692f27faabb31a37dafd46c31cd756bab98f8641` |
| `resources/frida/config-template.js` | `5afad65ed908006eb1af99aa6da3a73359036bdaa870fe32bf654695fa95d02a` |
| `resources/frida/frida-java-bridge.js` | `88f0ca1fb34d2bd7b589f3d4c44aa0077780473530922887a53311ec55d9c214` |

## Optional packaged Frida runtime

**Public alpha releases do not redistribute the native Frida worker, Python
runtime or Android Frida server.** `npm run package` stages filtered resources
that exclude those optional binaries. The user can explicitly run the shipped
`resources/device/install-runtime.py` helper to download Frida from PyPI and
the official Frida release into a private user runtime. That installation does
not modify system Python or an Android device.

A previously verified local macOS arm64 experiment included
`resources/bin/scope-frida-worker` and the unmodified official
`frida-server-17.9.1-android-arm64` binary. The following provenance is retained
for that local experiment and future review; those native components are absent
from public release artifacts and are not relicensed as Scope code.

| Component | Version / origin | License text |
| --- | --- | --- |
| Frida Python bindings | 17.9.1 | [wxWindows Library Licence 3.1](resources/device/licenses/frida-python-17.9.1-COPYING.txt) |
| Frida core / Android server | 17.9.1, official upstream binary | [wxWindows Library Licence 3.1](resources/device/licenses/frida-core-17.9.1-COPYING.txt) |
| Frida Gum | 17.9.1 | [wxWindows Library Licence 3.1 and embedded third-party notices](resources/device/licenses/frida-gum-17.9.1-COPYING.txt) |
| CPython | 3.12.13, python-build-standalone 20260610 | [Python license and historical notices](resources/device/licenses/python-3.12.13-LICENSE.txt), [runtime dependency licenses](resources/device/licenses/python-build-standalone-20260610/licenses) |
| PyInstaller bootloader / runtime | 6.22.3 | [GPL 2 or later with bootloader exception; Apache/MIT runtime terms](resources/device/licenses/pyinstaller-6.22.3-COPYING.txt) |

The main Frida licenses incorporate GNU Library GPL 2 or later, with an explicit
exception permitting binary object code distribution under the distributor's
own terms. The [GNU Library GPL text](resources/device/licenses/LGPL-2.0.txt)
is included alongside those exceptions. Scope does not modify Frida, CPython or
PyInstaller. The JavaScript interception scripts remain subject to the separate
AGPL notices above.

The older Python 3.9 developer environment optionally installs
`typing_extensions` 4.16.0; its [license](resources/device/licenses/typing_extensions-4.16.0-LICENSE.txt)
is retained for that case. It is absent from the Python 3.12 packaged worker.

Exact release sources, pinned Frida submodules, Python distribution metadata,
archive integrity and the public distribution boundary
are recorded in the [runtime notice index](resources/device/licenses/README.md).
Keep that directory with the integration sources. Any future redistribution of
the optional native runtime requires a complete artifact-specific dependency and
corresponding-source review. The public packaging checks currently reject it.
