import type { ReactNode } from "react";
import { Icon } from "@/components/ui";

// Empty, loading and error states (design rework task-10-3, canvas "Zustände"). Inside a card the
// frame, title and space stay; only the content changes, so the page does not jump.

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="dash-page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="dash-page-header__actions">{actions}</div>}
    </header>
  );
}

// "Nothing to do" is good news (tone good) and worded as such; "no matches" after a filter names the
// active filters and offers the way back (action). Never just "Keine Daten".
export function EmptyState({ title, children, action, tone = "neutral" }: { title: string; children?: ReactNode; action?: ReactNode; tone?: "neutral" | "good" }) {
  return (
    <div className={`dash-state dash-state--empty${tone === "good" ? " dash-state--good" : ""}`}>
      <p className="dash-state__title">
        {tone === "good" && <Icon name="check-circle" size={18} />}
        {title}
      </p>
      {children && <div className="dash-state__body">{children}</div>}
      {action && <div className="dash-state__action">{action}</div>}
    </div>
  );
}

// Says what failed, what is kept and what one can do. Affects only its block; no technical codes.
export function ErrorState({ title = "Daten konnten nicht geladen werden.", children, action }: { title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="dash-state-error">
      <div className="dash-state dash-state--error" role="alert">
        <Icon name="alert" size={18} />
        <div>
          <p className="dash-state__title">{title}</p>
          {children && <div className="dash-state__body">{children}</div>}
        </div>
      </div>
      {action && <div className="dash-state__action">{action}</div>}
    </div>
  );
}

// Note without error character, e.g. offline on the technician's phone
export function NoticeState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="dash-state dash-state--notice" role="status">
      <Icon name="offline" size={18} />
      <div><strong>{title}</strong> {children}</div>
    </div>
  );
}

// Placeholder in the shape of the later content: flat steel-100 surface, gentle pulse (static with
// reduced motion). Titles and period stay visible outside of it. Announced once to screen readers.
// Use as <Suspense fallback={<LoadingState />}> around the slow part of a page after the access check,
// not as loading.tsx: a segment-wide loading boundary would turn access redirects into streamed redirects.
export function LoadingState({ label = "Wird geladen …", rows = 4, shape = "rows" }: { label?: string; rows?: number; shape?: "rows" | "kpi" | "table" | "chart" }) {
  return (
    <div className={`dash-loading dash-loading--${shape}`} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {shape === "kpi" && (
        <>
          <span className="dash-skeleton" style={{ width: 90, height: 40 }} aria-hidden="true" />
          <span className="dash-skeleton" style={{ width: 180, height: 14 }} aria-hidden="true" />
        </>
      )}
      {shape === "table" && Array.from({ length: rows }, (_, index) => (
        <span key={index} className="dash-loading__row" aria-hidden="true">
          <span className="dash-skeleton" />
          <span className="dash-skeleton" style={{ width: `${[100, 70, 85][index % 3]}%` }} />
          <span className="dash-skeleton" />
        </span>
      ))}
      {shape === "chart" && (
        <span className="dash-loading__bars" aria-hidden="true">
          {[40, 60, 50, 75, 55, 65].map((height, index) => <span key={index} className="dash-skeleton" style={{ height: `${height}%` }} />)}
        </span>
      )}
      {shape === "rows" && Array.from({ length: rows }, (_, index) => (
        <span key={index} className="dash-skeleton dash-skeleton--row" aria-hidden="true" />
      ))}
    </div>
  );
}
