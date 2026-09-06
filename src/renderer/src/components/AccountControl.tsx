import { Check, ChevronDown, CircleUserRound } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AccountProfilesState } from "../../../shared/contracts";
import { assertProfileStorageReady } from "../profile-storage";
import { appSound } from "../sound";

export default function AccountControl({ state, initial = false }: { state: AccountProfilesState; initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [position, setPosition] = useState<{ left: number; bottom: number }>();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { if (!initial) { setOpen(false); trigger.current?.focus(); } };
  useLayoutEffect(() => {
    if (!open || initial) return;
    const place = () => { const rect = root.current!.getBoundingClientRect(); setPosition({ left: Math.max(12, Math.min(rect.left + 3, window.innerWidth - 292)), bottom: window.innerHeight - rect.top + 6 }); };
    place(); window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, initial]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !initial) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    root.current?.querySelector<HTMLButtonElement>(".account-options button")?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, initial]);
  const switchAccount = async (key: string) => {
    if (busy) return;
    setError(undefined);
    try {
      assertProfileStorageReady(); setBusy(true);
      if (document.querySelector(".helper-editor, [role='dialog']:not(.mail-composer-dialog)")) throw new Error("Finish or close the open editor before switching accounts.");
      appSound.play("select", "interface");
      await window.heyAgent.profiles.switchAccount(key);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not switch accounts."); setBusy(false); }
  };
  const account = state.active;
  const identity = <><span className="account-avatar" aria-hidden="true">{account ? account.name.split(/\s+/).map((word) => word[0]).slice(0, 2).join("").toUpperCase() : <CircleUserRound size={17} />}</span><span className="account-copy"><strong>{account?.name ?? "Choose account"}</strong><small>{account?.email ?? "Linked HEY accounts"}</small></span></>;
  return <div className="account-control" ref={root} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); close(); }
    if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const choices = [...root.current!.querySelectorAll<HTMLButtonElement>(".account-options button:not(:disabled)")];
      const index = choices.indexOf(document.activeElement as HTMLButtonElement);
      choices[event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length]?.focus();
    }
  }}>
    {!initial && (state.accounts.length > 1 ? <button ref={trigger} type="button" className="account-row" title={`${account?.name}\n${account?.email}`} aria-expanded={open} aria-label={`Switch account, ${account?.email}`} onClick={() => { appSound.play(open ? "close" : "open", "interface"); setOpen(!open); }}>{identity}<ChevronDown size={14} /></button> : <div className="account-row" title={`${account?.name}\n${account?.email}`}>{identity}</div>)}
    {open && <div className="account-options" style={initial ? undefined : position} aria-label="Linked accounts">
      {state.accounts.map((item) => <button key={item.key} type="button" title={item.email} disabled={busy} aria-pressed={item.key === account?.key} onClick={() => item.key === account?.key ? close() : void switchAccount(item.key)}><span><strong>{item.name}</strong><small>{item.email}</small></span>{item.key === account?.key && <Check size={14} />}</button>)}
      {busy && <p role="status">Switching account…</p>}
      {error && <p role="alert">{error}</p>}
      {error?.includes("A HEY change needs checking") && <button type="button" onClick={() => { void window.heyAgent.profiles.acknowledgeWrites().then(() => setError(undefined)).catch((reason) => setError(String(reason))); }}>I've checked the outcome in HEY</button>}
    </div>}
  </div>;
}

export function AccountGate() {
  const state = window.heyAgent.profiles.current;
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return <main className="account-gate"><h1>{state.needsSelection ? "Choose your HEY account" : "HEY account unavailable"}</h1><p>{error ?? state.error ?? "Your mail and chats stay with the account you choose. Existing local history will be assigned to this first profile."}</p>{state.accounts.length > 0 && <AccountControl state={state} initial />}<button type="button" className="secondary-button" disabled={busy} onClick={() => { setBusy(true); void window.heyAgent.profiles.retry().catch((reason) => { setError(String(reason)); setBusy(false); }); }}>{busy ? "Checking…" : "Try again"}</button></main>;
}
