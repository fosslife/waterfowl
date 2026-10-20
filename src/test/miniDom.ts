/**
 * Enough of a document for React to mount a small screen in Vitest.
 * The project has no DOM test dependency, so these tests stay inside Node.
 */

type Listener = (event: MiniEvent) => void;

export class MiniEvent {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  defaultPrevented = false;
  timeStamp = 0;
  target: MiniNode | null = null;
  currentTarget: MiniNode | null = null;

  constructor(type: string, bubbles = true) {
    this.type = type;
    this.bubbles = bubbles;
    this.cancelable = true;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.bubbles = false;
  }
}

export class MiniNode {
  nodeType: number;
  nodeName: string;
  parentNode: MiniNode | null = null;
  childNodes: MiniNode[] = [];
  ownerDocument: MiniDocument | null = null;
  nodeValue: string | null = null;
  private listeners = new Map<string, Set<Listener>>();

  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
  }

  addEventListener(type: string, listener: Listener): void {
    const group = this.listeners.get(type) ?? new Set<Listener>();
    group.add(listener);
    this.listeners.set(type, group);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: MiniEvent): boolean {
    event.target = event.target ?? this;
    const path: MiniNode[] = [];
    let current: MiniNode | null = this;
    while (current) {
      path.push(current);
      current = current.parentNode;
    }
    for (const node of path) {
      event.currentTarget = node;
      for (const listener of node.listeners.get(event.type) ?? []) {
        listener(event);
      }
      if (!event.bubbles) break;
    }
    return !event.defaultPrevented;
  }

  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null;
  }

  get nextSibling(): MiniNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue ?? "";
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.childNodes = [];
    if (value) {
      const text = new MiniNode(3, "#text");
      text.nodeValue = value;
      text.ownerDocument = this.ownerDocument;
      text.parentNode = this;
      this.childNodes.push(text);
    }
  }

  appendChild(child: MiniNode): MiniNode {
    return this.insertBefore(child, null);
  }

  insertBefore(child: MiniNode, before: MiniNode | null): MiniNode {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    if (!before) {
      this.childNodes.push(child);
      return child;
    }
    const index = this.childNodes.indexOf(before);
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
    return child;
  }

  removeChild(child: MiniNode): MiniNode {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  contains(node: MiniNode | null): boolean {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }
}

export class MiniElement extends MiniNode {
  tagName: string;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  attributes = new Map<string, string>();
  className = "";
  id = "";
  title = "";
  style: { setProperty: (name: string, value: string) => void } = {
    setProperty: () => undefined,
  };
  disabled = false;

  constructor(tagName: string) {
    super(1, tagName.toUpperCase());
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
    if (name === "id") this.id = String(value);
    if (name === "title") this.title = String(value);
    if (name === "disabled") this.disabled = true;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === "disabled") this.disabled = false;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttributeNS(_namespace: string, name: string, value: string): void {
    this.setAttribute(name, value);
  }

  removeAttributeNS(_namespace: string, name: string): void {
    this.removeAttribute(name);
  }

  focus(): void {}

  blur(): void {}
}

export class MiniInput extends MiniElement {
  type = "text";
  value = "";
  private boxChecked = false;

  constructor() {
    super("input");
  }

  get checked(): boolean {
    return this.boxChecked;
  }

  set checked(value: boolean) {
    this.boxChecked = value;
  }
}

export class MiniDocument extends MiniNode {
  body: MiniElement;
  documentElement: MiniElement;
  defaultView: MiniWindow;
  activeElement: MiniElement;

  constructor(defaultView: MiniWindow) {
    super(9, "#document");
    this.defaultView = defaultView;
    this.ownerDocument = this;
    this.documentElement = new MiniElement("html");
    this.documentElement.ownerDocument = this;
    this.body = new MiniElement("body");
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
  }

  createElement(tagName: string): MiniElement {
    const element =
      tagName.toLowerCase() === "input" ? new MiniInput() : new MiniElement(tagName);
    element.ownerDocument = this;
    return element;
  }

  createElementNS(_namespace: string, tagName: string): MiniElement {
    return this.createElement(tagName);
  }

  createTextNode(text: string): MiniNode {
    const node = new MiniNode(3, "#text");
    node.nodeValue = text;
    node.ownerDocument = this;
    return node;
  }
}

export class MiniWindow {
  document: MiniDocument;
  HTMLElement = MiniElement;
  Element = MiniElement;
  Node = MiniNode;
  HTMLIFrameElement = class MiniIframe {};
  Event = MiniEvent;
  private listeners = new Map<string, Set<Listener>>();

  constructor() {
    this.document = new MiniDocument(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const group = this.listeners.get(type) ?? new Set<Listener>();
    group.add(listener);
    this.listeners.set(type, group);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  getComputedStyle(): { getPropertyValue: () => string } {
    return { getPropertyValue: () => "" };
  }
}

const GLOBAL_NAMES = [
  "window",
  "document",
  "HTMLElement",
  "Element",
  "Node",
  "HTMLIFrameElement",
  "Event",
  "getComputedStyle",
] as const;

type GlobalName = (typeof GLOBAL_NAMES)[number];

let installed = false;
let savedGlobals: { name: GlobalName; descriptor: PropertyDescriptor | undefined }[] | null =
  null;
const mountedReleases: Array<() => void> = [];

function waitForScheduledWork(): Promise<void> {
  return new Promise((resolve) => {
    const timers = globalThis as { setImmediate?: (callback: () => void) => void };
    if (timers.setImmediate) {
      timers.setImmediate(resolve);
      return;
    }
    setTimeout(resolve, 0);
  });
}

export function installMiniDom(): MiniWindow {
  if (installed) return globalThis.window as unknown as MiniWindow;
  if (!savedGlobals) {
    savedGlobals = GLOBAL_NAMES.map((name) => ({
      name,
      descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
    }));
  }
  const miniWindow = new MiniWindow();
  const view = miniWindow as unknown as Window & typeof globalThis;
  globalThis.window = view;
  globalThis.document = miniWindow.document as unknown as Document;
  globalThis.HTMLElement = MiniElement as unknown as typeof HTMLElement;
  globalThis.Element = MiniElement as unknown as typeof Element;
  globalThis.Node = MiniNode as unknown as typeof Node;
  globalThis.HTMLIFrameElement =
    miniWindow.HTMLIFrameElement as unknown as typeof HTMLIFrameElement;
  globalThis.Event = MiniEvent as unknown as typeof Event;
  globalThis.getComputedStyle =
    miniWindow.getComputedStyle as unknown as typeof getComputedStyle;
  installed = true;
  return miniWindow;
}

type Unmountable = { unmount: () => void };

export function trackMountedRoot(root: Unmountable, container: MiniElement): void {
  let released = false;
  const unmount = root.unmount.bind(root);
  const release = () => {
    if (released) return;
    released = true;
    try {
      unmount();
    } finally {
      if (container.parentNode) container.parentNode.removeChild(container);
    }
  };
  root.unmount = release;
  mountedReleases.push(release);
}

export function releaseMountedRoots(): void {
  const pending = mountedReleases.splice(0, mountedReleases.length);
  for (const release of pending) release();
}

export async function restoreMiniDom(): Promise<void> {
  releaseMountedRoots();
  // React reads `window` from a timer scheduled by unmount. Let that timer
  // finish before the real globals are put back.
  await waitForScheduledWork();
  await waitForScheduledWork();
  const saved = savedGlobals;
  savedGlobals = null;
  installed = false;
  if (!saved) return;
  for (const entry of saved) {
    if (entry.descriptor) {
      Object.defineProperty(globalThis, entry.name, entry.descriptor);
    } else {
      Reflect.deleteProperty(globalThis, entry.name);
    }
  }
}

export function textOf(node: MiniNode): string {
  return node.textContent;
}

export function walkElements(
  node: MiniNode,
  visit: (element: MiniElement) => void,
): void {
  if (node instanceof MiniElement) visit(node);
  for (const child of node.childNodes) walkElements(child, visit);
}

export function reactHandler(
  element: MiniElement,
  name: "onClick" | "onChange",
): ((event: { target: MiniElement }) => void) | undefined {
  const key = Object.keys(element).find((entry) => entry.startsWith("__reactProps"));
  if (!key) return undefined;
  const props = (element as unknown as Record<string, unknown>)[key] as
    | Record<string, ((event: { target: MiniElement }) => void) | undefined>
    | undefined;
  return props?.[name];
}
