export const COMPACT_AGENT_NAVIGATION_QUERY = "(max-width: 1120px)";

export type NavigationPresentation = {
  collapsed: boolean;
  overlay: boolean;
};

export function navigationPresentation(
  compactAgentLayout: boolean,
  preferredCollapsed: boolean,
  compactExpanded: boolean,
): NavigationPresentation {
  if (!compactAgentLayout) return { collapsed: preferredCollapsed, overlay: false };
  if (compactExpanded) return { collapsed: false, overlay: true };
  return { collapsed: true, overlay: false };
}
