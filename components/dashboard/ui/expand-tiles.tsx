"use client";

import { Fragment, useId, useState, type CSSProperties, type ReactNode } from "react";
import type { CardStripe } from "@/components/dashboard/ui/card";
import { Icon } from "@/components/ui";

export type ExpandTile = {
  key: string;
  stripe: CardStripe;
  label: string;
  // The one figure that matters, then one line of context
  value: ReactNode;
  note: ReactNode;
  // Details shown full width below the row (rendered on the server, only toggled here)
  panel: ReactNode;
};

// Row of equal summary tiles (task-10-3, user request 09.10.2026): the row stays even whatever the data;
// a click opens the details of one tile below the row, a second click closes them. All start closed.
export function ExpandTiles({ tiles, label }: { tiles: ExpandTile[]; label: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const base = useId();
  // One flat grid: on wide screens the tiles form a row and the open panel spans it below; on narrow
  // screens (one column) each panel is ordered directly after its tile (CSS order from --i)
  return (
    <div className="rw-tiles" role="group" aria-label={label}>
      {tiles.map((tile, index) => {
        const expanded = open === tile.key;
        const order = { "--i": index } as CSSProperties;
        return (
          <Fragment key={tile.key}>
            <button
              type="button"
              className={`rw-card rw-card--${tile.stripe} rw-tile`}
              style={order}
              aria-expanded={expanded}
              aria-controls={`${base}-${tile.key}`}
              onClick={() => setOpen(expanded ? null : tile.key)}
            >
              <span className="rw-tile__label">{tile.label}</span>
              <span className="rw-tile__value mono">{tile.value}</span>
              <span className="rw-card__note">{tile.note}</span>
              <span className="rw-tile__more">
                {expanded ? "Details schließen" : "Details anzeigen"}
                <Icon name="chevron-down" size={16} />
              </span>
            </button>
            <div id={`${base}-${tile.key}`} className="rw-tiles__panel" style={order} hidden={!expanded}>
              {tile.panel}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
