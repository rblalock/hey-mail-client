# Intermittent input focus

Reported 2026-09-06: text inputs did not accept typing after opening the app. Hiding and reopening the window restored typing.

Status: not reproduced. No behavior change made.

## Initial checks

- `src/main/index.ts`: first launch shows the window at `ready-to-show`; second-instance activation calls `show()` and `focus()`. No focus-event diagnostics are recorded.
- `src/renderer/src/App.tsx`: the global shortcut handler leaves ordinary typing alone when the target is editable. The compact navigation drawer makes the workspace inert while open; check this state during a recurrence.
- `src/main/window-zoom.ts`: only recognized modifier-plus-zoom keys are intercepted.
- Several actions use `window.confirm()`. Electron has had [dialog-related input-focus bugs](https://github.com/electron/electron/issues/20821), but that older Windows report does not establish the cause on this Linux build.
- [Wayland controls window activation](https://www.electronjs.org/docs/latest/api/browser-window#platform-notices). A hide/show recovery makes activation worth checking, but does not prove it is the cause.
- The existing desktop log had no matching focus/activation/input failure entry. It does not record enough detail to rule these paths out.

## Next reproduction

- Separate cold launch, launching an already-running instance, and hiding/showing the special workspace.
- Check whether a native confirmation or file dialog preceded the failure.
- While broken, capture window focus, renderer `document.hasFocus()`, active element type, inert ancestors, and whether key events reach the renderer. Do not capture typed text or mail.
- Compare those states after hiding/showing. Use synthetic inputs; no mail or calendar writes.
- Only add a focus-restoration change after reproducing the failing path. Avoid unconditional refocus loops that could steal focus from dialogs or other apps.
