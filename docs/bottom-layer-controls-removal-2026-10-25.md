# Remove duplicate bottom layer controls

The bottom icon docks and category bar are removed on desktop and mobile following the annotated browser feedback. Every layer, including harbour journey times, remains available in the right-side Map layers panel. Existing layer visibility, transport routes, category selection and saved map view retain their current behavior.

Removed code includes the dock-only tooltip wrapper, category state and saved preference, group definitions, translations and CSS. Popup collision checks no longer track retired controls. Map attribution, scale, and 3D camera controls move down into the freed area while remaining above the traffic intelligence ticker.

The transport browser checks now require the retired controls to be absent and verify panel visibility choices across closing and reopening. Coverage includes the reported 484×807 viewport, narrower mobile screens, landscape, English/Traditional Chinese, and both map renderers.

At 484×807, expanding accessibility status exposed a ResizeObserver feedback loop in the positioned panel. A stable viewport-capped panel height keeps note expansion within the scrolling body and removes that loop without suppressing browser errors.

Validation: ESLint, TypeScript and all 216 deterministic tests pass. The production build passes. All seven layer-selector scenarios pass, including 484×807, 320px, landscape and both renderers. Native 3D checks pass all seven scenarios, including mobile/narrow popup clearance, camera controls, route details, WebGL fallback and style retry. The snapshot retry/removal check also passes. Changes are local; no deployment was requested.
