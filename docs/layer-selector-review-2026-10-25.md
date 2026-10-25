# Unified right-side layer selector

The Map layers panel exposes all 23 layers through seven categories. Road contains the nine road controls from the bottom dock. Conditions & access, Buses & minibuses, Trains & Light Rail, Ferries, Trams and Taxis cover the remaining layers. The existing teal controls, labelled rows, icons and popover remain the visual authority.

Choosing a category only reveals its controls. Independent switches use the same layer store and toggle handler as both bottom docks, preserving selections in other categories. Transport route selection, search, show/hide-all, geometry retry, vehicle status and zoom remain available below the layer switches. Bus-stop and route-label controls remain in the relevant transport categories. Detector visibility, incident messages, counts, feed retries and hosted-only restrictions remain available.

The category dropdown stays outside the scrolling body, including on short landscape screens. `layerCategory` is validated when restoring a session. New sessions start in Road, while valid saved transport modes migrate for existing sessions. No arrival data is saved and no feed or map-rendering behavior changes.

Validation:

- `npm run verify`: ESLint, TypeScript and all 216 deterministic tests pass, including complete category coverage, session validation and migration.
- `npm run build`: production build passes.
- `tests/transport-layers.browser.mjs`: six passing scenarios covering English desktop, Traditional Chinese mobile, 320px width, landscape, 2D and 3D. Each exercises all 23 switches, browse-only category changes, both directions of dock synchronization, selected-route preservation, search, bulk actions, zoom, reloads and renderer switches. Screenshots use deterministic map/feed fixtures.
- `tests/route-vehicles.browser.mjs`: four passing desktop/mobile and 2D/3D scenarios.
- `tests/map-empty.browser.mjs`: all seven scenarios pass, including visible selected bus routes and viewport-gated feeds.
- The broader marker suite initially passed six of eight scenarios. The snapshot edge-hover scenario passed on focused recheck. The remaining colocated desktop marker test fails because its single-element tooltip locator matches two tooltips. That same failure reproduces against an archived `HEAD` application, with only the old test helper's nested-summary selector narrowed so the baseline can reach the scenario. No marker or tooltip production code is changed here.
- Impeccable's detector reports no deterministic findings. The finish reviewer cleared the scoped fixes, including restricting the camera-inventory caveat to Road. The documenter verified that palette, type, shadows and the existing component system are preserved. Missing `PRODUCT.md`, `DESIGN.md` and design sidecar predate this ordinary extension and are not repaired as part of it.

No commit, push or deployment is part of this change.
