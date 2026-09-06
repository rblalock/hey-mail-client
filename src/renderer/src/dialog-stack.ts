export function isTopmostDialogScrim(scrim: HTMLElement | null): boolean {
  if (!scrim) return false;
  const visible = Array.from(document.querySelectorAll<HTMLElement>(".dialog-scrim:not([hidden])"));
  return visible.at(-1) === scrim;
}
