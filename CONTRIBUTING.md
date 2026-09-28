# Contributing

Thanks for considering a contribution! This is a small, single-purpose plugin, so the
bar for changes is: **keep it zero-config and dependency-free** (the OpenCode runtime
resolves `@opencode/plugin/tui`, `@opentui/solid/jsx-runtime`, and `solid-js` from its own
bundled runtime — don't add imports that require `npm install`).

## Getting started

1. Clone or copy the repo into the plugin directory so it actually loads:

   ```sh
   mkdir -p ~/.config/opencode/plugins
   git clone https://github.com/BL47E/opencode-go-limits-tracker.git \
     ~/.config/opencode/plugins/go-usage
   ```

2. Restart the TUI — plugins load at startup.

3. Verify it's discovered:

   ```sh
   opencode plugin list
   ```

   You should see `opencode-go-limits-tracker` with source `local`.

## Dev workflow

- Edit `tui.ts` (the `index.ts` file is only the generic entry point).
- Restart the TUI after each change — there is no hot reload for plugins.
- Check `~/.local/share/opencode/log/opencode.log` (filter `role=cli`) if the banner
  silently disappears or the plugin errors on startup.

## Code style

- Plain JavaScript-style TypeScript; no build step.
- Prefer the existing patterns: `jsx(...)` calls instead of JSX syntax, `createSignal`
  for state, no class components.
- Keep the render function side-effect-free apart from the existing `refresh()` timer.

## Good first issues

- A config knob for `REFRESH_MS` (e.g., read from `cli.json`)
- Handling of fractional percents if the endpoint starts returning them
- A "hidden when sidebar is off" fallback note or banner position option

## Test checklist (manual)

Before opening a PR, confirm:

- [ ] Banner renders ~5s after TUI start on an `opencode-go` session
- [ ] Banner disappears when switching to a non-Go provider
- [ ] No error in the opencode log after a run that fails to reach the endpoint (e.g., no network)

## Submitting

1. Fork the repo and create a branch from `main`.
2. Link the issue your change addresses (or open one first if it's non-trivial).
3. Keep PRs small and focused — one feature or one fix per PR.
4. Describe manual testing done (see checklist above).

MIT-licensed; by contributing you agree your work is released under the same license.
