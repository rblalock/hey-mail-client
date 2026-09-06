import { useState, type ComponentPropsWithoutRef } from "react";
import type { MailContact } from "../../../shared/contracts";
import { contactInitials } from "../contact-avatar";

type ContactAvatarProps = Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  contact: MailContact;
};

export default function ContactAvatar({ contact, className, style, ...props }: ContactAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const showImage = Boolean(contact.avatarUrl && failedUrl !== contact.avatarUrl);

  return <span
    {...props}
    className={["contact-avatar", className].filter(Boolean).join(" ")}
    style={{ ...(contact.avatarBackgroundColor ? { backgroundColor: contact.avatarBackgroundColor } : {}), ...style }}
    aria-hidden="true"
  >
    {showImage
      ? <img src={contact.avatarUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(contact.avatarUrl)} />
      : contactInitials(contact)}
  </span>;
}
