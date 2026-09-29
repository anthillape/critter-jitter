/**
 * The info cards under the map: click a card's title to collapse or expand
 * it; drag the title to move the card, and it snaps into its new place in
 * the masonry when you let go. The order and which cards are collapsed are
 * remembered in this browser.
 */

const STORAGE_KEY = "critterJitterCards";
/** Pointer travel (px) before a press on a title becomes a drag rather than a click. */
const DRAG_THRESHOLD = 5;
/** Distance (px) from the top or bottom of the card area where dragging scrolls it. */
const EDGE_SCROLL = 40;

interface Saved {
  order: string[];
  collapsed: string[];
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(container: HTMLElement): void {
  const cards = cardsIn(container);
  const state: Saved = {
    order: cards.map((c) => c.dataset.card!),
    collapsed: cards.filter((c) => c.classList.contains("collapsed")).map((c) => c.dataset.card!),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the layout just isn't remembered.
  }
}

function cardsIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(":scope > .card"));
}

export function setupCards(container: HTMLElement): void {
  const cards = cardsIn(container);
  for (const card of cards) {
    const title = card.querySelector<HTMLElement>(":scope > h2");
    if (!title) continue;
    card.dataset.card ??= (title.firstChild?.textContent ?? "").trim().toLowerCase().replace(/\W+/g, "-");
    title.classList.add("card-title");
    title.tabIndex = 0;
    title.setAttribute("role", "button");
    title.title = "Click to collapse or expand; drag to move";
    title.setAttribute("aria-expanded", "true");
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation(); // don't also pause the world (space)
        toggle(card);
      }
    });
    title.addEventListener("pointerdown", (e) => startPress(e, card, title));
  }

  // Restore the saved order (unknown cards keep their place at the end) and collapsed state.
  const saved = load();
  if (saved) {
    const byId = new Map(cards.map((c) => [c.dataset.card!, c]));
    for (const id of saved.order) {
      const c = byId.get(id);
      if (c) container.appendChild(c);
    }
    for (const c of cards) if (!saved.order.includes(c.dataset.card!)) container.appendChild(c);
    for (const id of saved.collapsed) {
      const c = byId.get(id);
      if (c) setCollapsed(c, true);
    }
  }

  function setCollapsed(card: HTMLElement, collapsed: boolean): void {
    card.classList.toggle("collapsed", collapsed);
    card.querySelector(":scope > h2")?.setAttribute("aria-expanded", String(!collapsed));
  }

  function toggle(card: HTMLElement): void {
    setCollapsed(card, !card.classList.contains("collapsed"));
    save(container);
  }

  function startPress(e: PointerEvent, card: HTMLElement, title: HTMLElement): void {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let drag: Drag | null = null;
    e.preventDefault(); // no text selection while dragging

    // Listen on the window: while dragging, the card ignores the pointer.
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!drag) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        drag = beginDrag(card, startX, startY);
      }
      drag.move(ev.clientX, ev.clientY);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (drag) drag.drop();
      else if (ev.type === "pointerup") toggle(card);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    title.focus({ preventScroll: true });
  }

  interface Drag {
    move(x: number, y: number): void;
    drop(): void;
  }

  /**
   * Lifts the card out of the flow (it follows the pointer) and leaves a
   * placeholder of the same size, which moves among the other cards as the
   * pointer passes over them. Dropping glides the card into the placeholder.
   */
  function beginDrag(card: HTMLElement, startX: number, startY: number): Drag {
    const r = card.getBoundingClientRect();
    const offX = startX - r.left;
    const offY = startY - r.top;
    const placeholder = document.createElement("div");
    placeholder.className = "card-placeholder";
    placeholder.style.height = `${r.height}px`;
    card.after(placeholder);
    // Lift it out of the scrolling columns so nothing clips or offsets it.
    document.body.appendChild(card);
    card.classList.add("dragging");
    Object.assign(card.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
    let lastX = startX;
    let lastY = startY;
    let scrollTimer = 0;

    const place = (x: number, y: number) => {
      card.style.left = `${x - offX}px`;
      card.style.top = `${y - offY}px`;
      // The card under the pointer (the dragged card itself ignores the pointer).
      const under = document.elementFromPoint(x, y)?.closest<HTMLElement>(".card");
      if (!under || under === card || under.parentElement !== container) return;
      const ur = under.getBoundingClientRect();
      const before = y < ur.top + ur.height / 2;
      const ref = before ? under : under.nextSibling;
      if (ref !== placeholder && placeholder.nextSibling !== ref) container.insertBefore(placeholder, ref);
    };

    // Near the top or bottom of the card area, keep scrolling it.
    const autoScroll = () => {
      const cr = container.getBoundingClientRect();
      const dy = lastY < cr.top + EDGE_SCROLL ? -12 : lastY > cr.bottom - EDGE_SCROLL ? 12 : 0;
      if (dy) {
        container.scrollTop += dy;
        place(lastX, lastY);
      }
      scrollTimer = requestAnimationFrame(autoScroll);
    };
    scrollTimer = requestAnimationFrame(autoScroll);

    return {
      move(x, y) {
        lastX = x;
        lastY = y;
        place(x, y);
      },
      drop() {
        cancelAnimationFrame(scrollTimer);
        const target = placeholder.getBoundingClientRect();
        card.classList.add("settling");
        card.style.left = `${target.left}px`;
        card.style.top = `${target.top}px`;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          placeholder.replaceWith(card);
          card.classList.remove("dragging", "settling");
          card.style.removeProperty("width");
          card.style.removeProperty("left");
          card.style.removeProperty("top");
          save(container);
        };
        card.addEventListener("transitionend", finish, { once: true });
        setTimeout(finish, 250); // in case no transition runs
      },
    };
  }
}
