// One shared tooltip for every element with `data-tooltip`. A single delegated listener and one
// fixed-position element, so tooltips cost nothing per button and are never clipped by a panel.
// The text is visual only: buttons keep their own aria-label for assistive technology.

const SHOW_DELAY_MS = 300;
const GAP_PX = 6;
const EDGE_PX = 8;

let tip: HTMLDivElement | undefined;
let target: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

const getTip = (): HTMLDivElement => {
  if (tip === undefined) {
    tip = document.createElement("div");
    tip.className = "tooltip";
    tip.setAttribute("aria-hidden", "true");
    document.body.append(tip);
  }
  return tip;
};

const place = (element: HTMLElement): void => {
  const text = element.dataset.tooltip;
  if (text === undefined || text === "" || !element.isConnected) return;
  const node = getTip();
  node.textContent = text;
  node.dataset.visible = "true";
  const anchor = element.getBoundingClientRect();
  const { width, height } = node.getBoundingClientRect();
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2 - width / 2, EDGE_PX),
    window.innerWidth - width - EDGE_PX,
  );
  // Below the element, or above it when there's no room underneath.
  const below = anchor.bottom + GAP_PX;
  const top = below + height > window.innerHeight - EDGE_PX ? anchor.top - GAP_PX - height : below;
  node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
};

const hide = (): void => {
  clearTimeout(timer);
  target = null;
  if (tip !== undefined) delete tip.dataset.visible;
};

const show = (element: HTMLElement, delay: number): void => {
  if (element === target) return;
  hide();
  target = element;
  timer = setTimeout(() => place(element), delay);
};

const tooltipTarget = (node: EventTarget | null): HTMLElement | null =>
  node instanceof Element ? node.closest<HTMLElement>("[data-tooltip]") : null;

/** Starts the shared tooltip. Call once at startup. */
export const installTooltips = (): void => {
  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const element = tooltipTarget(event.target);
    if (element === null) hide();
    else show(element, SHOW_DELAY_MS);
  });
  document.addEventListener("pointerout", (event) => {
    // Leaving the window has no matching pointerover.
    if (event.relatedTarget === null) hide();
  });
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("focusin", (event) => {
    const element = tooltipTarget(event.target);
    // Keyboard focus only; a click already explains itself.
    if (element !== null && element.matches(":focus-visible")) show(element, 0);
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  window.addEventListener("scroll", hide, { capture: true, passive: true });
  window.addEventListener("blur", hide);
};
