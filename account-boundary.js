// Account/workspace isolation. UI state fencing is never an auth substitute.
export function createAccountBoundary({ storage, onInvalidate }) {
  let identity, prefix = null, stopped = false;
  const controller = new AbortController();
  const deviceKeys = new Set(["ledger.appearance", "ledger.androidApp", "ledger.wakeWord", "ledger.printAfterPosting"]);
  function sessionIdentity(session) {
    if (!session?.user?.id) return null;
    let sid = "";
    try {
      const encoded = session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      sid = JSON.parse(atob(encoded)).session_id || "";
    } catch {}
    return session.user.id + ":" + sid;
  }
  function removeWhere(test) {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key && test(key)) storage.removeItem(key);
    }
  }
  // Legacy data has no trustworthy owner. Never migrate it into a new account.
  removeWhere(key => !deviceKeys.has(key) && !key.startsWith("ledger.account.") && /^(ledger\.|crew\.|kmj\.)/.test(key));
  function invalidate() {
    if (stopped) return;
    stopped = true; controller.abort();
    if (prefix) removeWhere(key => key.startsWith(prefix));
    prefix = null; onInvalidate();
  }
  function accept(session) {
    if (stopped) return false;
    const next = sessionIdentity(session);
    if (identity && next !== identity) { invalidate(); return false; }
    identity = next; return true;
  }
  function assertCurrent(expected = identity) {
    if (stopped || !identity || expected !== identity) throw new DOMException("Account changed", "AbortError");
  }
  // A document restored from the back/forward cache: keep it only when the
  // stored session still names the same user and sign-in session this page
  // was bound to. Anything else (a sign-out, another account, a page that had
  // no account yet but now does) is invalidated exactly as before.
  function resume(session) {
    if (stopped) return false;
    if (sessionIdentity(session) !== (identity ?? null)) { invalidate(); return false; }
    return true;
  }
  const accountStorage = {
    getItem(key) { return !stopped && (deviceKeys.has(key) || prefix) ? storage.getItem(deviceKeys.has(key) ? key : prefix + key) : null; },
    setItem(key, value) { if (!stopped && (deviceKeys.has(key) || prefix)) storage.setItem(deviceKeys.has(key) ? key : prefix + key, value); },
    removeItem(key) { if (!stopped && (deviceKeys.has(key) || prefix)) storage.removeItem(deviceKeys.has(key) ? key : prefix + key); },
  };
  return {
    accept, invalidate, assertCurrent, sessionIdentity, resume, accountStorage,
    get identity() { return identity; }, get stopped() { return stopped; }, get signal() { return controller.signal; },
    bindWorkspace(session, workspace) {
      if (!accept(session) || !session?.user?.id || !workspace) return false;
      const next = "ledger.account." + encodeURIComponent(session.user.id) + "." + encodeURIComponent(workspace) + ".";
      if (prefix && prefix !== next) { invalidate(); return false; }
      prefix = next; return true;
    },
  };
}
