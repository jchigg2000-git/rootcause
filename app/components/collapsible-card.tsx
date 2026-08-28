"use client";

import { ReactNode } from "react";
import { useCollapsed } from "../lib/prefs.ts";

/**
 * A settings section. Open/closed state is per-card and persisted locally, so
 * the page reopens the way the operator left it.
 */
export function CollapsibleCard({
  collapseKey,
  title,
  subtitle,
  badge,
  defaultCollapsed = false,
  children,
}: {
  collapseKey: string;
  title: string;
  subtitle?: string;
  badge?: string;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, toggle] = useCollapsed(collapseKey, defaultCollapsed);
  const bodyId = `card-${collapseKey}`;

  return (
    <section className={`settings-card${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="settings-card-head"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
      >
        <span className="settings-card-title">
          <strong>{title}</strong>
          {badge && <span className="settings-badge">{badge}</span>}
          {subtitle && <small>{subtitle}</small>}
        </span>
        <span className="settings-chevron" aria-hidden="true">{collapsed ? "+" : "−"}</span>
      </button>
      {!collapsed && (
        <div className="settings-card-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}
