// Wallet plumbing built on EIP-6963: providers announce themselves, we keep a
// running register of every one we hear from and let the studio pick a channel.

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isRabby?: boolean;
  isMetaMask?: boolean;
}

interface ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

// Persisted-key derivation. Rather than hard-coding the literal string we build
// it from a surface tag + a slot name so the scheme reads consistently here.
const SURFACE_TAG = "studio.surface";
const slot = (name: string) => `${SURFACE_TAG}#${name}`;
const PINNED_RDNS_SLOT = slot("rdns");

// Wallets we reach for first when the user hasn't pinned a specific one.
const PREFERENCE = ["io.rabby", "io.metamask"];

// The live register of announced providers, keyed implicitly by rdns.
const register: ProviderDetail[] = [];

function remember(detail?: ProviderDetail) {
  if (!detail?.info?.rdns || !detail.provider) return;
  const at = register.findIndex((d) => d.info.rdns === detail.info.rdns);
  if (at === -1) register.push(detail);
  else register[at] = detail;
}

// Wire up the announce/request handshake as soon as this module loads client-side.
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e: Event) => {
    remember((e as CustomEvent<ProviderDetail>).detail);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

// --- persistence of the chosen wallet -------------------------------------

export function setChosenRdns(rdns: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_RDNS_SLOT, rdns);
  } catch {
    /* ignore */
  }
}

export function getChosenRdns(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PINNED_RDNS_SLOT) || "";
  } catch {
    return "";
  }
}

// --- discovery / refresh --------------------------------------------------

export function refreshWallets() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function ensureDiscovered(timeoutMs = 250): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (register.length) {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve();
    };
    const onAnnounce = () => finish();
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(finish, timeoutMs);
  });
}

export function listWallets() {
  refreshWallets();
  return register.map((d) => ({ name: d.info.name, rdns: d.info.rdns, icon: d.info.icon }));
}

// --- selection ------------------------------------------------------------

export function pickDetail(rdns?: string): { provider: Eip1193Provider; rdns: string } | undefined {
  refreshWallets();
  const want = rdns ?? getChosenRdns();
  if (want) {
    const hit = register.find((d) => d.info.rdns === want);
    if (hit) return { provider: hit.provider, rdns: hit.info.rdns };
  }
  for (const r of PREFERENCE) {
    const hit = register.find((d) => d.info.rdns === r);
    if (hit) return { provider: hit.provider, rdns: hit.info.rdns };
  }
  if (register[0]) return { provider: register[0].provider, rdns: register[0].info.rdns };
  return undefined;
}

export function pickProvider(rdns?: string): Eip1193Provider | undefined {
  const d = pickDetail(rdns);
  if (d) return d.provider;
  return typeof window !== "undefined" ? (window.ethereum as Eip1193Provider | undefined) : undefined;
}
