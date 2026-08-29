"use client";

/**
 * The make / model / machine-type suggestion control.
 *
 * Replaces the native `<datalist>` these fields used to carry. A datalist is
 * browser-owned: it will not open on click, its keyboard handling differs per
 * browser, and it cannot be styled — so the app had four hand-rolled copies
 * that behaved four different ways. This is one control with one behaviour.
 *
 * Two structural decisions here are load-bearing, and both look like
 * over-engineering until you undo one:
 *
 * 1. `ComboField` owns the `.field` wrapper and renders `<div className="field">
 *    <label htmlFor>` — it does NOT nest inside the `<label className="field">`
 *    the other fields use. Inside a labelling `<label>`, the accessible-name
 *    algorithm folds the whole subtree into the input's name, so Make announces
 *    as "Make Caterpillar John Deere Komatsu Volvo …"; and because
 *    `<li role="option">` is not interactive content, an option click bubbles
 *    to the label and re-focuses the input, reopening the soft keyboard on
 *    touch. Neither failure is visible without a screen reader or a phone.
 *
 * 2. The popup is portalled to `document.body` and positioned `fixed`. Three
 *    ancestors in `globals.css` clip an in-flow absolute popup, each on its
 *    own `overflow: hidden` — `.app-shell` (a horizontal-scroll guard),
 *    `.intake-form` and `.settings-card` (both rounded-corner clips).
 *    `.inventory-form` and `.spec-lookup-form` have none, so
 *    "simplifying" the portal away breaks two pages out of four, only near the
 *    bottom of a scrolled form. ARIA wiring is by id reference, so the portal
 *    costs nothing in accessibility terms.
 *
 * Free text is the point of these fields — an unlisted make or model is typed
 * straight in — so nothing here ever coerces the value to a catalog entry.
 * Only two gestures commit: Enter on a highlighted option, and clicking one.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { filterSuggestions } from "../lib/equipment-catalog.ts";

/** Room the popup needs below the field before it flips above instead. */
const FLIP_THRESHOLD = 160;
/** PageUp / PageDown stride through a long model list. */
const PAGE_STRIDE = 8;

type ComboboxProps = {
  id: string;
  /** Names the listbox and the toggle for assistive tech. Not rendered here. */
  label: string;
  value: string;
  /** Fires for typing *and* for a commit, so plain field handlers drop in. */
  onChange: (value: string) => void;
  /** Fires only when an option is committed. Use for make-clears-model. */
  onSelect?: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  maxLength?: number;
};

type Position = { left: number; top: number; width: number; above: boolean };

export function Combobox({
  id,
  label,
  value,
  onChange,
  onSelect,
  options,
  placeholder,
  required,
  disabled,
  maxLength,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [position, setPosition] = useState<Position | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const listId = `${id}-list`;
  // Opening from the toggle or a click shows everything; only typing filters.
  // Otherwise "click to see the full list" would show one entry after a pick.
  const visible = useMemo(
    () => (filtering ? filterSuggestions(options, value) : [...options]),
    [filtering, options, value],
  );

  const close = useCallback(() => {
    setOpen(false);
    setFiltering(false);
    setHighlighted(-1);
  }, []);

  // A field with nothing to suggest is a plain input: no combobox role, no
  // toggle, nothing openable. Preserves what the conditional `list=` attribute
  // did on intake, and fixes the two views that attached an empty datalist.
  const suggestible = options.length > 0 && !disabled;

  const openWith = useCallback(
    (index: number) => {
      if (!suggestible) return;
      setOpen(true);
      setFiltering(false);
      setHighlighted(index);
    },
    [suggestible],
  );

  function commit(next: string) {
    onChange(next);
    onSelect?.(next);
    close();
    inputRef.current?.focus();
  }

  /** Index of the option matching the current value, for a browse-in-place open. */
  function currentIndex() {
    const needle = value.trim().toLowerCase();
    if (!needle) return -1;
    return visible.findIndex((option) => option.trim().toLowerCase() === needle);
  }

  function handleChange(next: string) {
    onChange(next);
    if (!suggestible) return;
    setOpen(true);
    setFiltering(true);
    // Never auto-highlight index 0: Enter would then silently replace what the
    // operator typed, which is exactly the free-text entry this field exists for.
    setHighlighted(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!suggestible) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        // Alt+Down opens without committing to a highlight (ARIA APG).
        openWith(event.altKey ? currentIndex() : event.key === "ArrowDown" ? 0 : visible.length - 1);
        return;
      }
      if (event.key === "ArrowUp" && event.altKey) {
        close();
        return;
      }
      if (!visible.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      // Wrap at both ends, treating -1 as "before the first".
      const next = (highlighted + step + visible.length + 1) % (visible.length + 1);
      setHighlighted(next === visible.length ? 0 : next);
      return;
    }

    if (!open) return;

    if (event.key === "Home" || event.key === "End") {
      if (!visible.length) return;
      event.preventDefault();
      setHighlighted(event.key === "Home" ? 0 : visible.length - 1);
      return;
    }

    if (event.key === "PageDown" || event.key === "PageUp") {
      if (!visible.length) return;
      event.preventDefault();
      const from = highlighted < 0 ? 0 : highlighted;
      const step = event.key === "PageDown" ? PAGE_STRIDE : -PAGE_STRIDE;
      setHighlighted(Math.min(Math.max(from + step, 0), visible.length - 1));
      return;
    }

    if (event.key === "Enter") {
      // With no highlight the popup just closes and the event carries on, so
      // the form submits. Swallowing that first Enter reads as a broken button.
      if (highlighted >= 0 && highlighted < visible.length) {
        event.preventDefault();
        commit(visible[highlighted]);
        return;
      }
      close();
      return;
    }

    if (event.key === "Escape") {
      // Close only. Reverting to the last catalog value would destroy the
      // free text this field exists to accept.
      event.stopPropagation();
      close();
      return;
    }

    if (event.key === "Tab") close();
  }

  // Position against the anchor, flipping above when the soft keyboard or the
  // viewport edge would bury the list. Measured in a layout effect so the
  // popup never paints at the wrong place first.
  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    // Scrolled clear of the viewport: there is nothing to anchor to any more.
    if (rect.bottom < 0 || rect.top > viewportHeight) {
      close();
      return;
    }
    const above = viewportHeight - rect.bottom < FLIP_THRESHOLD && rect.top > FLIP_THRESHOLD;
    setPosition({
      left: rect.left,
      top: above ? rect.top : rect.bottom,
      width: rect.width,
      above,
    });
  }, [close]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure, visible.length]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const reposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    // Capture phase so every scrolling ancestor is caught, not just the window.
    window.addEventListener("scroll", reposition, { capture: true, passive: true });
    window.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", reposition, { capture: true });
      window.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open, measure]);

  // Outside dismiss. pointerdown rather than click so it beats focus changes;
  // an option's own handler lives inside the portal, so containment excludes it.
  useEffect(() => {
    if (!open) return;
    const isInside = (target: EventTarget | null) =>
      target instanceof Node &&
      (anchorRef.current?.contains(target) || popupRef.current?.contains(target));
    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) close();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!isInside(event.target)) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [open, close]);

  // Keep the highlighted row in view when the keyboard moves it.
  useEffect(() => {
    if (!open || highlighted < 0) return;
    popupRef.current
      ?.querySelector(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted]);

  function optionPointerDown(event: ReactPointerEvent<HTMLLIElement>, option: string) {
    if (!event.isPrimary || event.button !== 0) return;
    // pointerdown, not click: on iOS a click lets the input blur first, the
    // keyboard collapses, the layout reflows under the finger, and the tap
    // lands on the wrong row.
    event.preventDefault();
    commit(option);
  }

  const input = (
    <input
      ref={inputRef}
      id={id}
      value={value}
      onChange={(event) => handleChange(event.target.value)}
      onKeyDown={handleKeyDown}
      onPointerDown={() => {
        if (!open) openWith(currentIndex());
      }}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      maxLength={maxLength}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      // iOS autocorrect mangles model numbers like 344K and 350G LC.
      spellCheck={false}
      {...(suggestible
        ? {
            role: "combobox",
            "aria-expanded": open,
            "aria-controls": listId,
            // "list", never "both" — there is no inline completion, and saying
            // otherwise misleads a screen-reader user about what Enter does.
            "aria-autocomplete": "list" as const,
            "aria-activedescendant":
              open && highlighted >= 0 ? `${id}-opt-${highlighted}` : undefined,
          }
        : {})}
    />
  );

  if (!suggestible) return input;

  return (
    <div className="combo" ref={anchorRef}>
      {input}
      <button
        type="button"
        className={`combo-toggle${open ? " is-open" : ""}`}
        // One tab stop per field, per the ARIA combobox pattern: keyboard
        // users open with ArrowDown, pointer users click here.
        tabIndex={-1}
        aria-label={`Show ${label} suggestions`}
        aria-expanded={open}
        aria-controls={listId}
        onPointerDown={(event) => {
          event.preventDefault();
          if (open) close();
          else openWith(currentIndex());
        }}
      >
        <span aria-hidden="true" />
      </button>
      {/* NVDA and JAWS do not reliably announce a filtered result count from
          aria-activedescendant alone. */}
      <span className="combo-status" role="status" aria-live="polite">
        {open ? (visible.length ? `${visible.length} suggestions` : "No matches") : ""}
      </span>
      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <ul
            ref={popupRef}
            id={listId}
            role="listbox"
            aria-label={`${label} suggestions`}
            className={`combo-popup${position.above ? " is-above" : ""}`}
            style={{
              left: position.left,
              width: position.width,
              ...(position.above
                ? { bottom: `calc(100% - ${position.top}px)`, top: "auto" }
                : { top: position.top }),
            }}
          >
            {visible.length === 0 ? (
              // The one place that actively confirms free text is accepted.
              // role="presentation" keeps it out of the option set — there is
              // nothing here to select, and the live region above already
              // announces "No matches".
              <li className="combo-empty" role="presentation">
                No matches — “{value.trim()}” will be used as typed.
              </li>
            ) : (
              visible.map((option, index) => (
                <li
                  key={option}
                  id={`${id}-opt-${index}`}
                  data-index={index}
                  role="option"
                  // Selection follows the highlight, not the committed value —
                  // exactly one option is ever selected. The committed value
                  // gets a visual-only marker so it cannot compete.
                  aria-selected={index === highlighted}
                  className={
                    "combo-option" +
                    (index === highlighted ? " is-active" : "") +
                    (option.trim().toLowerCase() === value.trim().toLowerCase()
                      ? " is-current"
                      : "")
                  }
                  // pointermove, not mouseenter: arrow-keying a list that
                  // scrolls under a stationary cursor must not fight itself.
                  onPointerMove={() => setHighlighted(index)}
                  onPointerDown={(event) => optionPointerDown(event, option)}
                >
                  {option}
                </li>
              ))
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}

/**
 * `Combobox` plus the `.field` wrapper the surrounding forms use. Mirrors the
 * `Field` helper in diagnostic-app.tsx, except the label is a sibling with
 * `htmlFor` rather than a wrapper — see the note at the top of this file.
 */
export function ComboField({
  label,
  required,
  hint,
  ...props
}: Omit<ComboboxProps, "id" | "required"> & {
  required?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <b aria-hidden="true"> *</b>}
      </label>
      <Combobox id={id} label={label} required={required} {...props} />
      {hint && <small>{hint}</small>}
    </div>
  );
}
