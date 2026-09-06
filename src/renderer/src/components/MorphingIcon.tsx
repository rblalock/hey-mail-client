import { MorphIcon, type IconInput, type MorphIconProps } from "morphicons/react";

type MorphingIconProps = Omit<MorphIconProps, "icon" | "reducedMotion"> & {
  icon: IconInput;
};

const STATE_SPRING = { stiffness: 700, damping: 53 } as const;

export default function MorphingIcon({ icon, spring = STATE_SPRING, ...props }: MorphingIconProps) {
  return <MorphIcon {...props} icon={icon} spring={spring} reducedMotion="user" />;
}
