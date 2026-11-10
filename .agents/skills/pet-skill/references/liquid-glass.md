# Liquid Glass design contract

This project adopts Apple's Liquid Glass principles as a cross-platform Electron design language; it does not claim to reproduce Apple's private system material or platform APIs.

Official sources:

- [Liquid Glass technology overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
- [Human Interface Guidelines: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass)
- [Human Interface Guidelines: Layout](https://developer.apple.com/design/human-interface-guidelines/layout)

## Layer rules

1. Keep pet artwork, histories, lists, charts, and settings content in the content layer.
2. Reserve glass for the functional layer: floating status pills, panel chrome/navigation, transient popovers, permission bubbles, compact HUD controls, and high-value actions.
3. Avoid glass-on-glass. A control inside a glass container uses a simple tint/fill and focus feedback, not a second backdrop blur.
4. Let layout, grouping, and spacing express hierarchy before adding borders, glows, or blur.
5. Keep the pet visually dominant; glass supports interaction and must not compete with the sprite.

## Material variants

- Use a regular treatment by default: adaptive dark/light tint, sufficient opacity, subtle saturation, one highlight edge, and a soft elevation shadow.
- Use a clear treatment only for a small control over rich pet/media content. Add a tested dimming layer when the background can become bright.
- Do not mix regular and clear treatments in one component group.
- Do not use glass as the background for long lists, charts, or the entire settings content layer.

## Interaction and accessibility

- Illuminate or slightly elevate an interactive control on hover/press/focus; keep motion brief and interruptible.
- Preserve a visible `:focus-visible` state and sufficient text/icon contrast across light and dark wallpapers.
- Support `prefers-reduced-motion`, `prefers-contrast: more`, and `prefers-reduced-transparency` where available. Provide an app-level opaque fallback if platform detection is insufficient.
- Do not encode state only through translucency, glow, or color. Retain text, symbols, or shape changes.
- Validate inactive-window appearance; controls should visually recede without becoming illegible.

## Electron/CSS implementation guidance

- Centralize semantic tokens such as surface tint, border, highlight, shadow, blur, radius, spacing, and motion instead of repeating arbitrary values. Hover/press/focus feedback uses `--transition-*` so it stays brief and is zeroed under reduced motion; see the spacing and motion section of [ui-design-system.md](ui-design-system.md).
- Limit `backdrop-filter` to the functional-layer container. Nested children must not add another backdrop filter.
- Keep a sufficiently opaque base color beneath blur because transparent Electron windows can sit over unpredictable wallpaper or video.
- Use rounded containers and concentric spacing, but retain existing pet proportions and compact desktop hit areas.
- Treat Windows and Linux rendering as explicit implementations. Verify actual Electron output instead of assuming WebKit/AppKit behavior.

## Visual acceptance set

- Light static wallpaper.
- Dark static wallpaper.
- High-detail or moving background when practical.
- Focused and unfocused window.
- Normal, hover, pressed, disabled, and keyboard-focus states.
- Reduced motion, reduced transparency, and increased contrast fallbacks.
- 100%, 125%, and 150% display scaling when geometry or text changes.
