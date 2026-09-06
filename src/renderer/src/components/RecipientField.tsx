import { X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import type { MailLibraryItem } from "../../../shared/contracts";

type RecipientFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  contacts: MailLibraryItem[];
  autoFocus?: boolean;
  placeholder?: string;
  collapseAfter?: number;
  invalid?: boolean;
  describedBy?: string;
};

export function parseRecipients(value: string): string[] {
  return [...new Set(value.split(/[,;]/).map((recipient) => recipient.trim()).filter(Boolean))];
}

export function invalidRecipientAddresses(value: string): string[] {
  return parseRecipients(value).filter((recipient) => recipient.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient));
}

export function shouldOpenRecipientSuggestions(query: string): boolean {
  return query.trim().length > 0;
}

function contactAddress(contact: MailLibraryItem): string {
  return contact.subtitle?.includes("@") ? contact.subtitle : contact.title;
}

export function filterContacts(contacts: MailLibraryItem[], query: string, selected: string[], limit = 7): MailLibraryItem[] {
  const normalized = query.trim().toLowerCase();
  const selectedAddresses = new Set(selected.map((recipient) => recipient.toLowerCase()));
  return contacts.filter((contact) => {
    const address = contactAddress(contact);
    if (selectedAddresses.has(address.toLowerCase())) return false;
    return !normalized || `${contact.title} ${contact.subtitle ?? ""}`.toLowerCase().includes(normalized);
  }).map((contact, index) => {
    const title = contact.title.toLowerCase();
    const address = (contact.subtitle ?? "").toLowerCase();
    const rank = !normalized ? 0
      : title.startsWith(normalized) ? 0
      : address.startsWith(normalized) ? 1
      : title.includes(normalized) ? 2
      : 3;
    return { contact, index, rank };
  }).sort((left, right) => left.rank - right.rank || left.index - right.index).slice(0, limit).map(({ contact }) => contact);
}

function recipientLabel(recipient: string, contacts: MailLibraryItem[]): string {
  return contacts.find((contact) => contactAddress(contact).toLowerCase() === recipient.toLowerCase())?.title ?? recipient;
}

export default function RecipientField({ label, value, onChange, contacts, autoFocus = false, placeholder, collapseAfter, invalid = false, describedBy }: RecipientFieldProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const recipients = useMemo(() => parseRecipients(value), [value]);
  const compact = collapseAfter !== undefined && recipients.length > collapseAfter && !expanded;
  const visibleRecipients = compact ? recipients.slice(0, collapseAfter) : recipients;
  const suggestions = useMemo(() => filterContacts(contacts, query, recipients), [contacts, query, recipients]);

  const updateRecipients = (next: string[]) => {
    const seen = new Set<string>();
    onChange(next.filter((recipient) => {
      const normalized = recipient.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    }).join(", "));
  };
  const addRecipient = (recipient: string, restoreFocus = true) => {
    const normalized = recipient.trim().replace(/^.*<([^>]+)>$/, "$1");
    if (!normalized) return;
    if (!recipients.some((current) => current.toLowerCase() === normalized.toLowerCase())) updateRecipients([...recipients, normalized]);
    setQuery("");
    setActiveIndex(-1);
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => inputRef.current?.focus());
  };
  const selectSuggestion = (contact: MailLibraryItem) => addRecipient(contactAddress(contact));

  return <div className="recipient-field">
    <span className="recipient-field-label">{label}</span>
    <div className={`recipient-control${compact ? " is-compact" : ""}`} onClick={() => inputRef.current?.focus()}>
      {visibleRecipients.map((recipient) => <span className="recipient-chip" key={recipient} title={recipient}>
        <span>{recipientLabel(recipient, contacts)}</span>
        <button type="button" aria-label={`Remove ${recipient}`} onClick={(event) => { event.stopPropagation(); updateRecipients(recipients.filter((current) => current !== recipient)); }}><X size={11} /></button>
      </span>)}
      {compact && <button
        type="button"
        className="recipient-overflow"
        aria-label={`Show ${recipients.length - visibleRecipients.length} more ${label} recipients`}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >+{recipients.length - visibleRecipients.length} more</button>}
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        role="combobox"
        aria-label={`${label} recipients`}
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-activedescendant={open && suggestions[activeIndex] ? `${listId}-${suggestions[activeIndex]!.id}` : undefined}
        value={query}
        placeholder={recipients.length ? "" : placeholder}
        onFocus={() => {
          setExpanded(true);
          const shouldOpen = shouldOpenRecipientSuggestions(query);
          setOpen(shouldOpen);
          setActiveIndex(shouldOpen ? 0 : -1);
        }}
        onBlur={() => {
          if (query.trim().includes("@")) addRecipient(query, false);
          else setOpen(false);
          setExpanded(false);
        }}
        onChange={(event) => {
          const next = event.target.value;
          const parts = next.split(/[,;]/);
          const nextQuery = parts.at(-1) ?? "";
          if (parts.length > 1) {
            const completed = parts.slice(0, -1).map((part) => part.trim()).filter(Boolean);
            updateRecipients([...recipients, ...completed]);
            setQuery(nextQuery);
          } else setQuery(nextQuery);
          const shouldOpen = shouldOpenRecipientSuggestions(nextQuery);
          setOpen(shouldOpen);
          setActiveIndex(shouldOpen ? 0 : -1);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
          if (event.key === "Enter" && (open || query.trim())) event.stopPropagation();
          if (event.ctrlKey || event.metaKey || event.altKey) {
            if (event.key === "Enter" && (open || query.trim())) event.preventDefault();
            return;
          }
          if (event.key === "ArrowDown" && shouldOpenRecipientSuggestions(query) && suggestions.length) { event.preventDefault(); setOpen(true); setActiveIndex((index) => (index + 1) % suggestions.length); }
          else if (event.key === "ArrowUp" && shouldOpenRecipientSuggestions(query) && suggestions.length) { event.preventDefault(); setOpen(true); setActiveIndex((index) => index <= 0 ? suggestions.length - 1 : index - 1); }
          else if ((event.key === "Enter" || event.key === "Tab") && open && activeIndex >= 0 && suggestions[activeIndex]) { event.preventDefault(); selectSuggestion(suggestions[activeIndex]!); }
          else if (event.key === "Enter" && query.trim()) { event.preventDefault(); addRecipient(query); }
          else if (event.key === "Backspace" && !query && recipients.length) updateRecipients(recipients.slice(0, -1));
          else if (event.key === "Escape" && open && suggestions.length > 0) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        }}
      />
    </div>
    {open && suggestions.length > 0 && <div className="recipient-suggestions" id={listId} role="listbox" aria-label={`${label} contact suggestions`}>
      {suggestions.map((contact, index) => <button
        key={contact.id}
        id={`${listId}-${contact.id}`}
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => selectSuggestion(contact)}
      ><span>{contact.title}</span><small>{contact.subtitle}</small></button>)}
    </div>}
  </div>;
}
