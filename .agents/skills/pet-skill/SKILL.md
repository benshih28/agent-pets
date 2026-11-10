---
name: pet-skill
description: Project-specific workflow and architecture guide for Agent Pets. Use when an agent plans, implements, reviews, tests, secures, documents, or versions changes in this Electron/Vue desktop-pet repository, especially roadmap phases, hooks and event ingestion, pet UI, Liquid Glass styling, permissions, quota, custom sprites, multi-pet behavior, packaging, or releases.
---

# Agent Pets project workflow

Work in Traditional Chinese for user-facing plans, phase reports, and handoffs. Keep code identifiers and established UI copy consistent with the source.

## Start every task

1. Read `git status --short`, `package.json`, the relevant source, and repository instructions before editing.
2. Preserve user-owned changes. The untracked `.claude/` directory is not part of the skill and must not be modified unless the user explicitly requests it.
3. Read [project-map.md](references/project-map.md) for source ownership, runtime boundaries, and package-manager rules.
4. Read the relevant section of [Desktop Pet Architecture v2](../../../docs/architecture/Desktop-Pet-Architecture-v2-Feature-Roadmap.zh-TW.md) for roadmap or architecture work.
5. For any visual or interaction change, read [liquid-glass.md](references/liquid-glass.md) and [ui-design-system.md](references/ui-design-system.md).
6. For every roadmap phase, release, security-sensitive change, or version update, read [phase-gates.md](references/phase-gates.md).
7. For package installation, build, packaging, or environment repair, read [build-environment.md](references/build-environment.md).

## Preserve architecture boundaries

- Treat hooks and Agent Adapters as observed fact sources; normalize events before product policies consume them.
- Keep Electron-native operations in the main process and expose only narrow, typed preload methods.
- Validate every IPC sender and payload in the main process. TypeScript types do not replace runtime checks.
- Keep permission handling in an isolated Control Plane. Never accept arbitrary callback URLs, commands, ports, or response pipes from generic events or MCP.
- Keep MCP presentation-only: status, reaction, and speech. Do not add command, file, permission, XP, or achievement mutation tools.
- Keep mood short-term and XP long-term. Use idempotent ledgers for durable rewards.
- Extract focused services from `electron/main.ts` incrementally; do not combine a feature with a broad rewrite.
- Keep per-state data in the agent-state registries, per-source and per-family data in `AGENT_SOURCE_REGISTRY` / `AGENT_FAMILY_REGISTRY`, and per-cue sound data in `src/types/sound.ts`; freeze registries with `deepFreeze` from `src/types/freeze.ts`; do not add a parallel switch, table or source list (see [project-map.md](references/project-map.md)).
- Treat Traditional Chinese UI copy as a cross-phase acceptance requirement; do not add a new user-visible surface without its Traditional Chinese wording or an explicitly recorded localization gap.
- Reuse `src/i18n.ts` for renderer and Electron-native user-visible copy; keep canonical status, agent, MCP, and token terms stable when they are part of an external contract.

## Implement one phase at a time

1. Establish the phase baseline and acceptance criteria before editing.
2. Make the smallest coherent change that satisfies the active phase.
3. Add or update contract, negative, regression, and runtime tests in proportion to risk.
4. Run the functional, visual, security, packaging, and diff checks in `phase-gates.md`.
5. Write a phase report under `docs/phase-reports/` with evidence, residual risks, and a recommended version increment.
6. Stop for user confirmation after the phase passes. Do not update the version beforehand.
7. After explicit confirmation, update the patch version by default. Use a minor increment for a large architectural, persistent-schema, public-contract, or security-boundary change. Re-run validation after changing the version.

## Validate the requested surface

- Do not treat an HTTP 204, static config, type-check, or build as proof of visible behavior.
- For hooks, verify delivery, canonical mapping, store/projection state, and rendered pet state separately.
- For desktop UI, verify a real Electron flow, not only a browser component.
- For transparent windows, test rendered hit targets, click-through, the pet display work area, and multi-monitor/DPI behavior when affected.
- For packaged Windows hooks, resolve a real `node.exe`; never use the packaged app executable as a Node interpreter.
- Record untested macOS/Linux behavior as residual risk. Do not infer it from Windows.

## Maintain visual consistency

- Apply Liquid Glass as a restrained functional layer for floating controls, navigation, status pills, popovers, and transient actions.
- Keep content lists and settings in a stable content layer. Avoid glass-on-glass and repeated nested blur.
- Prefer the regular, legible treatment. Use a clear treatment only over visually rich content with a tested dimming layer.
- Provide opaque/high-contrast and reduced-motion fallbacks. Verify light and dark wallpapers and focus states.
- Preserve the pet and existing visual personality; do not restyle unrelated surfaces in a feature phase.
- Use the token layer (`src/styles/tokens.css`: colour, type, spacing including the `--space-0-5/1-5/2-5` half steps, `--transition-*`/`--duration-*`/`--ease-*` motion) and the shared primitives (`src/components/ui/`) documented in [ui-design-system.md](references/ui-design-system.md) instead of hand-rolling a new button, card, toggle, dropdown, progress bar, confirmation dialog, or icon. This app ships for both Windows and macOS; a plain-text glyph icon or a `window.confirm()` dialog is a cross-platform bug, not a style choice.

## Package and version

- Use `pnpm` and `pnpm-lock.yaml`; do not introduce `package-lock.json`.
- Keep `package.json` and `pnpm-lock.yaml` version metadata aligned.
- Never bump the version merely because implementation started or tests passed. Wait for explicit user approval of the completed phase.
- Do not create a Git tag, release, or publish artifact unless the user explicitly requests it.
