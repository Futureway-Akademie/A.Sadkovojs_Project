import type { ReactNode } from "react";

// Card with a 2px state stripe on top (design rework task-10-3, specification section 02). The stripe
// classifies the content so a page can be scanned by color first:
// danger = hazard/blocking, attention = bottleneck, action = the place to act, neutral = information,
// meta = side information, success = nothing to do (an empty result that is good news).
export type CardStripe = "danger" | "attention" | "action" | "neutral" | "meta" | "success";

type CardProps = {
  stripe?: CardStripe;
  title?: ReactNode;
  // Number shown next to the title (mono), e.g. the count of a list
  count?: number | string;
  description?: ReactNode;
  // Secondary action in the header, usually a link
  action?: ReactNode;
  icon?: ReactNode;
  headingLevel?: 2 | 3;
  id?: string;
  // Content without inner padding (tables)
  flush?: boolean;
  busy?: boolean;
  className?: string;
  children?: ReactNode;
};

export function Card({ stripe = "neutral", title, count, description, action, icon, headingLevel = 3, id, flush, busy, className, children }: CardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headed = title !== undefined || action !== undefined;
  return (
    <article className={`rw-card rw-card--${stripe}${flush ? " rw-card--flush" : ""}${className ? ` ${className}` : ""}`} aria-labelledby={id && title !== undefined ? id : undefined} aria-busy={busy || undefined}>
      {headed && (
        <header className="rw-card__header">
          <div className="rw-card__heading">
            {icon && <span className="rw-card__icon">{icon}</span>}
            <div>
              {title !== undefined && (
                <Heading id={id} className="rw-card__title">
                  {title}
                  {count !== undefined && <> <span className="rw-card__count mono">{count}</span></>}
                </Heading>
              )}
              {description && <p className="rw-card__description">{description}</p>}
            </div>
          </div>
          {action && <div className="rw-card__action">{action}</div>}
        </header>
      )}
      <div className="rw-card__body">{children}</div>
    </article>
  );
}

// Section of a page with heading and a short note on what it covers (e.g. "Stand jetzt")
export function Zone({ id, title, note, controls, children }: { id: string; title: string; note?: ReactNode; controls?: ReactNode; children: ReactNode }) {
  return (
    <section className="rw-zone" aria-labelledby={id}>
      <div className="rw-zone__header">
        <div className="rw-zone__titles">
          <h2 id={id}>{title}</h2>
          {note && <span className="rw-zone__note">{note}</span>}
        </div>
        {controls && <div className="rw-zone__controls">{controls}</div>}
      </div>
      {children}
    </section>
  );
}
