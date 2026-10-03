/** Tiny DOM helper shared by the UI modules. textContent only: devil text is untrusted. */
export interface Attrs { class?: string; text?: string; title?: string; id?: string; aria?: Record<string, string> }

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, a: Attrs = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (a.class) el.className = a.class;
  if (a.id) el.id = a.id;
  if (a.text !== undefined) el.textContent = a.text;
  if (a.title) el.title = a.title;
  for (const [k, v] of Object.entries(a.aria ?? {})) el.setAttribute(`aria-${k}`, v);
  el.append(...kids);
  return el;
}

/** A <section> labelled by its own heading, so each region is announced by name. */
export function region(id: string, title: string, cls = ""): { sec: HTMLElement; body: HTMLElement } {
  const sec = h("section", { class: cls, aria: { labelledby: `${id}-h` } });
  const body = h("div", { class: "body" });
  sec.append(h("h2", { id: `${id}-h`, text: title }), body);
  return { sec, body };
}

export const chip = (text: string, tone: string): HTMLElement => h("span", { class: `chip ${tone}`, text });

export function bar(value: number, max: number, pctFill: number, label: string, cls = ""): HTMLElement {
  const b = h("div", { class: `bar ${cls}`, aria: { label: `${label} ${value} of ${max}` } });
  b.setAttribute("role", "progressbar");
  b.setAttribute("aria-valuemin", "0"); b.setAttribute("aria-valuemax", String(max)); b.setAttribute("aria-valuenow", String(value));
  const fill = h("div", { class: "fill" });
  fill.style.width = `${pctFill}%`;
  b.append(fill, h("span", { class: "bar-text", text: `${label} ${value}/${max}` }));
  return b;
}
