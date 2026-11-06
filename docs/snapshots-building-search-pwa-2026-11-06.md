# Snapshot controls, building search and PWA — 6 November 2026

## Delivered behavior

- Snapshot photos have independent Auto-enhance and Auto-contrast buttons, both on initially. A 96 × 72 luminance sample sets bounded exposure and contrast for each refreshed image. Enhancement also applies a modest saturation adjustment. Both buttons off restores the original display; canvas sampling failures keep the photo available. The 1×/2× control sits below the photo and initially shows 1×. At 2×, both image dimensions double inside a scrollable viewport, keeping map popups within the screen. Controls are shared by snapshot hover previews and both map renderers.
- The existing Search panel has a Buildings category. English and Chinese queries use the government's Address Lookup Service, with bilingual names/addresses, Hong Kong coordinate validation, explicit empty/error states and retry. Requests debounce for 500 ms, abort when superseded, time out after 12 seconds, and use a 50-entry, 15-minute memory cache. Suggestions are limited to 20. The chosen building is a separate approximate-location pin; it does not turn on a traffic layer. Selection stops GPS following. Renderer switches retain the pin, and selecting a traffic item replaces it. The existing saved search scope accepts Buildings.
- Production registers a service worker and supplies an installable standalone manifest. Sources opens with an install section, including a native install button when the browser exposes it and Safari home-screen instructions on iOS. An open map reports loss of connectivity; an offline reload shows a bilingual recovery page. Only that page and two existing app icons enter the service-worker cache. Traffic feeds, photos, building requests, map tiles and application bundles do not. Root deployments and `/HKRTTrafficInfo/` static deployments have separate worker scopes and caches. Worker registration is disabled in development.

## Verification

- `npm run verify`: ESLint, TypeScript and all 251 deterministic tests passed. Seven added tests cover bilingual address normalization, shared podium identities, invalid locations, query bounds/cache, image-adjustment limits, offline navigation and cache isolation at both deployment paths.
- `npx next build`, `npm run build:static` and `npm run build` passed. Static export restored and hash-verified all 23 API route files.
- Desktop and 390 × 844 mobile browser checks covered both snapshot defaults, restoring the original filter, and 2× dimensions (292 × 219 to 584 × 438 in the desktop detail popup). Mobile layouts did not overflow the document.
- Live English `Two International Finance Centre` and Chinese `國際金融中心二期` searches returned bilingual results. Choosing a building created its pin in 2D and retained it after a 3D switch. The Chinese interface was checked separately. With all 23 traffic layers disabled, both renderers still displayed the building pin without the empty-map notice. A simulated HTTP 503 displayed the retry action; retrying with a valid empty response displayed the distinct no-results message.
- Production Chromium successfully registered and controlled the page with `/sw.js`. A normal persistent browser profile returned no Chrome installability errors and showed the Install app button. No app was installed on the user's device.
- Offline reload and online Retry were exercised at the root and GitHub Pages subpath. The latter retained `/HKRTTrafficInfo/` in its manifest URL, worker scope and recovery link. Cache inspection found only `offline.html`, `app-icon-192.png`, and `app-icon-512.png`.
- The Impeccable detector returned no deterministic findings. Screenshots were inspected for desktop, mobile, Chinese, 3D and offline states; local evidence is under ignored `output/playwright/`.

## Boundaries and maintenance

The PWA is installable, but it does not supply an offline map or offline traffic feed. Building suggestions can represent a building's podium/reference point rather than its entrance. Some official traffic feeds may fail independently; those existing failures do not imply a PWA or search failure. Native iOS installation was not exercised on a physical device. The standard local Worker preview could not start: the installed runtime supports compatibility dates through 2026-05-22, while the existing generated Worker configuration requests 2026-10-06. The Worker build succeeded and its static-asset header rules parsed successfully; runtime PWA checks used production Next.js and the static export. No dependencies or deployment compatibility dates were changed.

Increment the cache version in `public/sw.js` when changing its cached offline assets. Next.js worker cache headers are configured in `next.config.ts`; Cloudflare static asset headers are in `public/_headers`. Registration uses `updateViaCache: 'none'` for every target. No deployment or commit was performed for this change.

## References

- [Government Address Lookup Service data dictionary, version 3.2](https://www.als.gov.hk/docs/Data_Dictionary_for_ALS_EN-v3.2.pdf): bilingual structured addresses, JSON headers, coordinates and query parameters.
- [Next.js progressive web apps guide](https://nextjs.org/docs/app/guides/progressive-web-apps): manifest, registration, install experience and service-worker response headers; checked through Context7.
