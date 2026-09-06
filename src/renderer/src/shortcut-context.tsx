import { createContext, useContext } from "react";
import { SHORTCUTS, type ShortcutId } from "./shortcuts";

export const ShortcutContext = createContext(SHORTCUTS);
export function useShortcutHints() {
  const shortcuts = useContext(ShortcutContext);
  return (id: ShortcutId) => shortcuts.find((shortcut) => shortcut.id === id)?.display ?? "";
}
