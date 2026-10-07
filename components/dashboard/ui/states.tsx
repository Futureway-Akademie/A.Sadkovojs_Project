import type { ReactNode } from "react";
import { Icon } from "@/components/ui";

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

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="dash-state dash-state--empty">
      <Icon name="info" size={22} />
      <div>
        <p className="dash-state__title">{title}</p>
        {children && <div className="dash-state__body">{children}</div>}
        {action && <div className="dash-state__action">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorState({ title = "Daten konnten nicht geladen werden.", children, action }: { title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="dash-state dash-state--error" role="alert">
      <Icon name="alert" size={22} />
      <div>
        <p className="dash-state__title">{title}</p>
        {children && <div className="dash-state__body">{children}</div>}
        {action && <div className="dash-state__action">{action}</div>}
      </div>
    </div>
  );
}

// Placeholder while server data loads; announced once to screen readers.
// Use as <Suspense fallback={<LoadingState />}> around the slow part of a page after the access check,
// not as loading.tsx: a segment-wide loading boundary would turn access redirects into streamed redirects.
export function LoadingState({ label = "Wird geladen …", rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="dash-loading" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="dash-skeleton" aria-hidden="true" />
      ))}
    </div>
  );
}
