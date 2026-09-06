import { useState, type ButtonHTMLAttributes } from "react";
import MorphingIcon from "./MorphingIcon";
import { agentRailIcon, navigationRailIcon } from "./sidebar-icons";

type RailMorphButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  rail: "navigation" | "agent";
  open: boolean;
  iconSize?: number;
};

export default function RailMorphButton({ rail, open, iconSize = 16, ...props }: RailMorphButtonProps) {
  const [previewed, setPreviewed] = useState(false);
  const icon = rail === "navigation"
    ? navigationRailIcon(!open, previewed)
    : agentRailIcon(open, previewed);

  return <button
    {...props}
    type="button"
    onPointerEnter={() => setPreviewed(true)}
    onPointerLeave={() => setPreviewed(false)}
    onFocus={() => setPreviewed(true)}
    onBlur={() => setPreviewed(false)}
  ><MorphingIcon icon={icon} size={iconSize} /></button>;
}
