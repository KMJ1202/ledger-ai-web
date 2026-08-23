// Ledger AI — support chat widget for support.html.
// STAGED DRAFT — not deployed. Path-ready as webapp/assets/support-widget.js.
// No build step, matches the rest of this site: plain script tag, no bundler.
//
// Talks directly to the public, no-auth support-agent edge function. This is
// NOT the in-app Ledger AI copilot and has no session, no Supabase auth, and
// no access to any signed-in account — it only ever sees what the visitor
// types into this widget.

(() => {
  const FN = "https://lbzkyyehmgudlxmfpzzh.supabase.co/functions/v1";
  const ENDPOINT = `${FN}/support-agent`;
  const STORAGE_KEY = "ledger.supportChat.v1";
  const MAX_MESSAGE_CHARS = 4000;

  const GREETING = "Hey — I'm the Ledger AI support agent. Ask me anything about how the product works, or tell me what's going wrong and I'll help or get you to a human.";

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function loadHistory() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function saveHistory(history) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-40))); } catch { /* storage unavailable — chat still works, just doesn't persist */ }
  }

  let history = loadHistory();
  let sending = false;

  function buildMarkup() {
    const wrap = document.createElement("div");
    wrap.className = "lsw-root";
    wrap.innerHTML = `
      <button class="lsw-launcher" id="lswLauncher" aria-label="Ask Ledger Support">
        <span class="lsw-launcher-ic">&#9998;</span>
        <span class="lsw-launcher-label">Ask Ledger Support</span>
      </button>
      <div class="lsw-panel" id="lswPanel" hidden>
        <div class="lsw-head">
          <div class="lsw-head-title"><span class="lsw-dot"></span>Ledger Support</div>
          <button class="lsw-close" id="lswClose" aria-label="Close">&times;</button>
        </div>
        <div class="lsw-messages" id="lswMessages"></div>
        <div class="lsw-typing" id="lswTyping" hidden><span></span><span></span><span></span></div>
        <form class="lsw-inputrow" id="lswForm">
          <input class="lsw-input" id="lswInput" type="text" placeholder="Type a message…" autocomplete="off" maxlength="${MAX_MESSAGE_CHARS}">
          <button class="lsw-send" id="lswSend" type="submit" aria-label="Send">&#8593;</button>
        </form>
        <div class="lsw-foot">Public support chat · no account data visible here · <a href="mailto:supportteam@heyledger.ai">email a human</a></div>
      </div>`;
    return wrap;
  }

  function bubble(role, html) {
    const el = document.createElement("div");
    el.className = `lsw-msg ${role === "user" ? "lsw-msg-user" : "lsw-msg-agent"}`;
    el.innerHTML = html;
    return el;
  }

  function renderTicket(ticket) {
    return `<div class="lsw-ticket">
      <div class="lsw-ticket-ic">&#9989;</div>
      <div><b>Ticket ${esc(ticket.ticket_id)} opened</b><br>A human will follow up at ${esc(ticket.email)} — usually within 1 business day.</div>
    </div>`;
  }

  function renderError(message, canRetry) {
    return `<div class="lsw-error">${esc(message)}${canRetry ? ' <button class="lsw-retry" data-retry>Try again</button>' : ""} — or email <a href="mailto:supportteam@heyledger.ai">supportteam@heyledger.ai</a> any time.</div>`;
  }

  function scrollToBottom(messagesEl) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function mount() {
    if (document.getElementById("lswLauncher")) return;
    document.body.appendChild(buildMarkup());

    const launcher = document.getElementById("lswLauncher");
    const panel = document.getElementById("lswPanel");
    const closeBtn = document.getElementById("lswClose");
    const messagesEl = document.getElementById("lswMessages");
    const typingEl = document.getElementById("lswTyping");
    const form = document.getElementById("lswForm");
    const input = document.getElementById("lswInput");

    function renderHistory() {
      messagesEl.innerHTML = "";
      messagesEl.appendChild(bubble("agent", esc(GREETING)));
      for (const turn of history) {
        if (turn.role === "user") messagesEl.appendChild(bubble("user", esc(turn.content)));
        else messagesEl.appendChild(bubble("agent", esc(turn.content)));
      }
      scrollToBottom(messagesEl);
    }

    let lastFailedText = null;

    async function sendMessage(text) {
      if (sending) return;
      const trimmed = text.trim().slice(0, MAX_MESSAGE_CHARS);
      if (!trimmed) return;
      sending = true;
      lastFailedText = null;
      history.push({ role: "user", content: trimmed });
      saveHistory(history);
      messagesEl.appendChild(bubble("user", esc(trimmed)));
      scrollToBottom(messagesEl);
      input.value = "";
      typingEl.hidden = false;
      scrollToBottom(messagesEl);

      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history }),
        });
        const data = await response.json().catch(() => ({}));
        typingEl.hidden = true;
        if (!response.ok || data?.error) {
          const message = data?.message || "Something went wrong reaching support just now.";
          messagesEl.appendChild(bubble("agent", renderError(message, true)));
          lastFailedText = trimmed;
          history.pop(); // don't persist a turn that never got a real reply
          saveHistory(history);
        } else {
          history.push({ role: "assistant", content: data.reply });
          saveHistory(history);
          let html = esc(data.reply).replace(/\n/g, "<br>");
          if (data.ticket) html += renderTicket(data.ticket);
          messagesEl.appendChild(bubble("agent", html));
        }
      } catch (err) {
        typingEl.hidden = true;
        messagesEl.appendChild(bubble("agent", renderError("Couldn't reach support — check your connection.", true)));
        lastFailedText = trimmed;
        history.pop();
        saveHistory(history);
      }
      sending = false;
      scrollToBottom(messagesEl);
    }

    messagesEl.addEventListener("click", (e) => {
      if (e.target.closest("[data-retry]") && lastFailedText) {
        const text = lastFailedText;
        lastFailedText = null;
        sendMessage(text);
      }
    });

    launcher.addEventListener("click", () => {
      const opening = panel.hasAttribute("hidden");
      if (opening) {
        panel.removeAttribute("hidden");
        launcher.classList.add("lsw-launcher-open");
        renderHistory();
        input.focus();
      } else {
        panel.setAttribute("hidden", "");
        launcher.classList.remove("lsw-launcher-open");
      }
    });
    closeBtn.addEventListener("click", () => {
      panel.setAttribute("hidden", "");
      launcher.classList.remove("lsw-launcher-open");
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      sendMessage(input.value);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
