# Consolidated transport layers

The Layers icon replaces the separate right-hand rail, bus-stop and route-label controls. Its panel offers bus-stop visibility, route-label visibility, a transport dropdown, show/hide-all actions, bilingual search, multiple route checkboxes and per-route zoom. The panel retains the current teal map controls, typography and compact spacing. A route badge carries operator colour; native inputs provide keyboard and screen-reader interaction.

Route filtering happens in the monitor before either map renderer receives its paths, stops and vehicle payloads. Shared rail stations remain while a selected line serves them. Light Rail services have separate choices, including the closing sections of the circular services. Ferry paths retain the existing inferred fairways. MTR Bus and tram paths remain approximate ordered-stop connections.

Bus choices come from stops loaded around the map, within the feed's existing coverage and zoom gates. This is stated in the panel. `/api/bus-route-paths` loads cached route geometry without ETA polling for every stop. Two client workers limit concurrent geometry requests; canceled selections abort their waits. Geometry errors are retryable, and approximate geometry is labelled. Existing selected-route ETA tracking remains separate.

Session parsing validates the selected transport, search text, route visibility overrides and explicitly chosen bus-route references. Those references keep a selected bus route available after panning away or reopening the app, without saving live observations. Bulk hide/show applies to subsequently loaded routes in the same transport, and does not change other transports. Legacy rail preferences migrate into the consolidated picker. Both map modes consume shared route-focus coordinates.

Validation:

- `npm run verify`: lint, TypeScript and 208 deterministic tests passed.
- `npm run build`: production build.
- `npm run build:static`: static export passed and all 21 API files were restored.
- `tests/transport-layers.browser.mjs`: English desktop, Traditional Chinese mobile, 320px width, 844×500 landscape, and both 2D/3D modes. Checks actual switches, multi-selection, search, hide/show, route fit, reload persistence, mode switching and panel containment.
- Six transport-panel browser cases passed. The existing 11 bus-route cases and eight commuter/session cases also passed using the consolidated display switches.

Browser fixtures isolate upstream availability while exercising the production adapters, shared route filters and both renderers. These checks validate local behavior; they do not constitute a production release.
