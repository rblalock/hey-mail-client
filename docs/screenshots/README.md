# README screenshots

Captured from the actual renderer's synthetic browser preview. No HEY account, Pi process, or model was connected. Names, mail, events, and AI answers are examples. The draft comparison includes a manually edited example suggestion.

- `inbox.png`: `?preview&theme=dusk&imbox-sections`, AI pane hidden; select conversations with `J` and `Shift+J`.
- `command-palette.png`: open `Ctrl+K` from the inbox with the AI pane hidden.
- `helpers.png`: open the launch conversation, then run **Recap this conversation** from `Ctrl+K`. Return to the inbox with the Helper open.
- `helper-settings.png`: open Settings from the profile menu and expand Helpers, with the AI pane hidden.
- `calendar.png`: week containing September 1, 2026, with the AI pane hidden.
- `draft-review.png`: compose a fictional launch reply, choose **Write → Improve**, edit the proposal in **Draft**, then show **Changes**.

Captures use 1440 × 960, except Calendar at 1440 × 740 and the command palette at 960 × 760. Theme and controls are unchanged. The README identifies the example data.

Use a standalone Vite renderer server with `configFile: false`, the React and Tailwind plugins, and `?preview`. Do not use `electron-vite dev --rendererOnly` for isolated captures: it still launches Electron. Keep the preview in a separate browser session and close it afterward.
