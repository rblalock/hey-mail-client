import type { Input, WebContents } from "electron";

export type ZoomAction = "in" | "out" | "reset";
const FACTORS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export function zoomAction(input: Pick<Input, "type" | "key" | "control" | "meta" | "alt" | "shift" | "isComposing">): ZoomAction | undefined {
  if (input.type !== "keyDown" || input.isComposing || input.alt || !(input.control || input.meta)) return;
  const key = input.key.toLowerCase();
  if (key === "+" || key === "=" || key === "add") return "in";
  if (!input.shift && (key === "-" || key === "subtract")) return "out";
  if (!input.shift && key === "0") return "reset";
}

export function nextZoomFactor(current: number, action: ZoomAction): number {
  if (action === "reset") return 1;
  // Tolerate Chromium's floating-point round trip and zoom set through its menu.
  if (action === "in") return FACTORS.find((factor) => factor > current + 0.001) ?? FACTORS.at(-1)!;
  return [...FACTORS].reverse().find((factor) => factor < current - 0.001) ?? FACTORS[0]!;
}

export function installWindowZoom(contents: WebContents): void {
  contents.on("before-input-event", (event, input) => {
    const action = zoomAction(input);
    if (!action) return;
    // Own this key before either renderer shortcuts or the default menu sees it.
    event.preventDefault();
    contents.setZoomFactor(nextZoomFactor(contents.getZoomFactor(), action));
  });
}
