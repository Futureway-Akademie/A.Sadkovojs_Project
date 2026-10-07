import Link from "next/link";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import type { TechnicianVisit } from "@/lib/dashboard/technician";
import { formatTimeRange } from "@/lib/format";
import { label } from "@/lib/status";

// Visit with everything a technician needs on site: time, customer, address, contact, equipment, risk
export function VisitCard({ visit, emphasis = false }: { visit: TechnicianVisit; emphasis?: boolean }) {
  const r = visit.request;
  const address = `${r.street_house_number}, ${r.postal_code} ${r.city}`;
  return (
    <article className={`visit-card${emphasis ? " visit-card--next" : ""}`}>
      <header className="visit-card__head">
        <span className="visit-card__time">{formatTimeRange(visit.scheduled_start, visit.scheduled_end)}</span>
        <StatusBadge kind="visit_status" value={visit.status} />
      </header>
      <h3><Link href={`/dashboard/anfragen/${r.id}`}>{r.company_name}</Link></h3>
      <p className="visit-card__meta"><span className="mono">{r.request_number}</span> · {label("service_kind", r.service_kind)} · {label("equipment_kind", r.equipment_kind)}</p>
      {r.safety_risk !== "none_known" && <p className="hint hint--danger visit-card__risk">Sicherheitsgefahr: {label("safety_risk", r.safety_risk)}</p>}
      {visit.status === "waiting_parts" && visit.waiting_reason && <p className="hint hint--warning visit-card__risk">Wartet auf Teile: {visit.waiting_reason}</p>}
      <dl className="visit-card__facts">
        <div><dt>Adresse</dt><dd><a href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`} target="_blank" rel="noopener noreferrer">{address}</a>{r.site_label && <span className="cell-sub">{r.site_label}</span>}</dd></div>
        <div><dt>Kontakt</dt><dd>{r.contact_name} · <a href={`tel:${r.phone_number.replace(/[^\d+]/g, "")}`}>{r.phone_number}</a></dd></div>
      </dl>
      <p className="visit-card__description">{r.description}</p>
      {visit.status !== "cancelled" && <Link className="visit-card__open" href={`/dashboard/einsatz/${visit.id}`}>Einsatz öffnen →</Link>}
    </article>
  );
}
