import { ArrowLeft, FileQuestion, Search } from "lucide-react";
import type { AgentObjectLink } from "../../../shared/contracts";
import { missingObjectDestination, missingObjectLabel } from "../missing-object";

type MissingObjectViewProps = {
  object: AgentObjectLink;
  finding?: boolean;
  onBack: () => void;
  onFind: () => void;
};

export default function MissingObjectView({ object, finding = false, onBack, onFind }: MissingObjectViewProps) {
  const destination = missingObjectDestination(object.kind);
  return <section className="panel placeholder-panel missing-object-panel" aria-labelledby="missing-object-title">
    <div className="placeholder-content">
      <span className="placeholder-mark"><FileQuestion size={22} /></span>
      <h1 id="missing-object-title">Item not found</h1>
      <p>HEY didn’t return <strong>{object.title}</strong> at its saved {missingObjectLabel(object.kind)} address. It may have been moved or deleted.</p>
      <div className="missing-object-actions">
        <button type="button" className="primary-button" onClick={onFind} disabled={finding}><Search size={14} />{finding ? "HEY Agent is working…" : "Find possible matches"}</button>
        <button type="button" className="secondary-button" onClick={onBack}><ArrowLeft size={14} />Back to {destination}</button>
      </div>
    </div>
  </section>;
}
