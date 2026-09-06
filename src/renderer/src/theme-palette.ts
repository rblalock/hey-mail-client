import type { ThemeSnapshot } from "../../shared/contracts";

type Rgb = [number, number, number];

function parseHex(value: string | undefined): Rgb | undefined {
  const match = value?.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) return undefined;
  const hex = match[1]!.length === 3 ? [...match[1]!].map((character) => character.repeat(2)).join("") : match[1]!;
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

function toHex(color: Rgb): string {
  return `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return from.map((channel, index) => channel + (to[index]! - channel) * amount) as Rgb;
}

function luminance(color: Rgb): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrast(foreground: Rgb, background: Rgb): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function perceptualChroma(color: Rgb): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * red! + 0.5363325363 * green! + 0.0514459929 * blue!);
  const m = Math.cbrt(0.2119034982 * red! + 0.6806995451 * green! + 0.1073969566 * blue!);
  const s = Math.cbrt(0.0883024619 * red! + 0.2817188376 * green! + 0.6299787005 * blue!);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return Math.hypot(a, b);
}

function ensureContrast(candidate: Rgb, background: Rgb, ratio = 4.5): Rgb {
  if (contrast(candidate, background) >= ratio) return candidate;
  const target: Rgb = luminance(background) < 0.35 ? [255, 255, 255] : [0, 0, 0];
  let low = 0;
  let high = 1;
  for (let index = 0; index < 18; index += 1) {
    const middle = (low + high) / 2;
    if (contrast(mix(candidate, target, middle), background) >= ratio) high = middle;
    else low = middle;
  }
  return mix(candidate, target, high);
}

function structuralTone(value: string | undefined, background: Rgb, direction: "lighter" | "darker"): Rgb | undefined {
  const candidate = parseHex(value);
  if (!candidate || contrast(candidate, background) > 2.4) return undefined;
  if (perceptualChroma(candidate) > perceptualChroma(background) + 0.035) return undefined;
  const difference = luminance(candidate) - luminance(background);
  if (direction === "lighter" ? difference <= 0 : difference >= 0) return undefined;
  return candidate;
}

export function deriveThemeVariables(theme: ThemeSnapshot): Record<string, string> {
  const dark = theme.mode === "dark";
  const background = parseHex(theme.colors.background) ?? (dark ? [26, 27, 38] : [247, 247, 249]);
  const foreground = parseHex(theme.colors.foreground) ?? (dark ? [236, 238, 244] : [35, 38, 47]);
  const rawMuted = parseHex(theme.colors.muted) ?? mix(foreground, background, 0.42);
  const rawAccent = parseHex(theme.colors.accent) ?? [73, 120, 245];
  const neutralTarget: Rgb = dark ? [246, 246, 248] : [24, 25, 29];

  const interaction = dark
    ? structuralTone(theme.colors.lighter_background, background, "lighter")
      ?? structuralTone(theme.colors.selection, background, "lighter")
      ?? mix(background, neutralTarget, 0.14)
    : structuralTone(theme.colors.selection, background, "darker")
      ?? structuralTone(theme.colors.dark_background, background, "darker")
      ?? mix(background, neutralTarget, 0.1);
  const canvas = dark
    ? structuralTone(theme.colors.dark_background, background, "darker")
      ?? structuralTone(theme.colors.darker_background, background, "darker")
      ?? mix(background, [0, 0, 0], 0.15)
    : structuralTone(theme.colors.dark_background, background, "darker")
      ?? mix(background, [0, 0, 0], 0.035);
  const lightSurface = !dark
    ? structuralTone(theme.colors.lighter_background, background, "lighter") ?? mix(background, [255, 255, 255], 0.7)
    : undefined;
  const page = background;
  const surface = dark ? mix(background, interaction, 0.26) : lightSurface!;
  const field = mix(background, interaction, dark ? 0.46 : 0.32);
  const hover = mix(background, interaction, dark ? 0.68 : 0.58);
  const hoverStrong = interaction;

  const neutralForeground = mix(foreground, neutralTarget, dark ? 0.78 : 0.72);
  const ink = ensureContrast(neutralForeground, page, 11.5);
  const inkTwo = ensureContrast(mix(neutralForeground, background, dark ? 0.29 : 0.32), page, 7);
  const mutedHint = mix(rawMuted, neutralForeground, dark ? 0.72 : 0.68);
  const inkThree = ensureContrast(mix(mutedHint, background, dark ? 0.34 : 0.38), page, 5.6);
  const accent = ensureContrast(rawAccent, page, 4.5);
  const line = mix(background, interaction, dark ? 0.78 : 0.68);
  const lineStrong = dark ? mix(background, neutralTarget, 0.24) : mix(background, interaction, 0.94);

  return {
    "--canvas": toHex(canvas),
    "--page": toHex(page),
    "--surface": toHex(surface),
    "--field": toHex(field),
    "--hover": toHex(hover),
    "--hover-2": toHex(hoverStrong),
    "--ink": toHex(ink),
    "--ink-2": toHex(inkTwo),
    "--ink-3": toHex(inkThree),
    "--line": toHex(line),
    "--line-strong": toHex(lineStrong),
    "--accent": toHex(accent),
    "--accent-tint": toHex(mix(page, accent, dark ? 0.18 : 0.12)),
    "--success": toHex(ensureContrast([46, 160, 95], page, 3)),
    "--danger": toHex(ensureContrast([211, 72, 78], page, 4.5)),
    "--app-mono": theme.fontFamily ? `"${theme.fontFamily.replaceAll('"', "")}", ui-monospace, monospace` : "ui-monospace, monospace",
  };
}
