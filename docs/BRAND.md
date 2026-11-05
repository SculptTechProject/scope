# Scope identity

Scope's mark uses two opposing request/response paths around an open inspection
window. Keep its two breaks, square geometry and proportions intact. The production
mark is one solid cyan, `#2DDED1`, on a transparent background. Graphite `#111315`
and paper `#F3F0E8` are the supporting presentation colors. This brand refresh does
not change the desktop interface's existing interaction colors.

## Source assets

| Asset | Purpose |
| --- | --- |
| [scope-logo.svg](../assets/brand/scope-logo.svg) | Canonical two-path vector; prefer this for web and scalable placement. |
| [scope-logo.png](../assets/brand/scope-logo.png) | Clean transparent 512 × 512 export and desktop-icon source. |
| [scope-banner.png](../assets/brand/scope-banner.png) | 1774 × 887 repository/portfolio banner; brand illustration, not an application screenshot. |
| [provenance.json](../assets/brand/provenance.json) | Exact generation prompts, production steps, dimensions and source-asset SHA-256 hashes. |

`resources/scope.svg` mirrors the canonical vector. Desktop PNG, ICO and ICNS
variants live in `src-tauri/icons/` and were generated with the repository's locked
Tauri CLI 2.12.4 from the clean PNG. Regenerate into a temporary directory:

```sh
npm ci
npm run tauri -- icon assets/brand/scope-logo.png --output /tmp/scope-icons
```

Review the output and replace only the existing desktop icon files. Android/iOS
outputs are not part of this desktop branding change. Keep the source PNG/SVG;
do not regenerate from the textured banner or an enlarged screenshot.

## Use and provenance

Keep clear space around the mark and retain its transparent aperture. Do not
stretch, rotate, outline, add gradients or attach a magnifier/pulse symbol. Prefer
at least 24 px for the mark; a banner containing text needs enough width to remain
legible. Keep product information in Markdown when an image is unavailable.

The concept and banner were created with OpenAI image generation on 5 November
2026. The chosen mark was reconstructed as clean vector geometry and exported to
PNG; the banner is the original generated raster. It retains related cyan and
near-black tones from its generation prompt. The vector/PNG define the exact
production color. No private conversations, account content, third-party photos
or app captures were used in these brand assets. Existing real screenshots and
their separate [capture provenance](images/README.md) remain unchanged.

The original Scope artwork is distributed under **AGPL-3.0-or-later**, like the
project: see [LICENSE](../LICENSE). Existing third-party licenses and notices
remain intact. The new desktop icons are included in the 1.2.0 release candidate.
Published 1.1.0 downloads retain their original icon. Packaging, platform
verification and publication are tracked separately in [the verification record](VERIFICATION.md).

Use concrete verbs and evidence: capture, rewrite, replay, save, inspect. Keep
scope, privacy and synthetic provenance visible. Avoid unsupported claims such
as universal pinning bypass, complete API inference, independent security audit
or enterprise certification. A proposed version is not a published release.
