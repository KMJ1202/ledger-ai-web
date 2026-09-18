// Hosted invoice / pay page. Audit 14.3: lives in its own file (CSP allows
// same-origin scripts without a hash). A customer returning from Stripe after
// the owner revoked or replaced the link still gets "Payment received" — the
// server settled the session — instead of a bare "link no longer active".
const FN = "https://lbzkyyehmgudlxmfpzzh.supabase.co/functions/v1/books";
const params = new URLSearchParams(location.search);
const token = params.get("t") || "";
let sessionId = params.get("session_id") || "";
const card = document.getElementById("card");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cur = (n, c) => new Intl.NumberFormat("en-CA", {style:"currency", currency:c||"CAD"}).format(Number(n)||0);

let lastData=null,loading=false;
const checkoutStorage="ledger.checkout."+token;
let checkoutRef;
try {checkoutRef=sessionStorage.getItem(checkoutStorage);if(!checkoutRef){checkoutRef=crypto.randomUUID();sessionStorage.setItem(checkoutStorage,checkoutRef);}}catch{checkoutRef=crypto.randomUUID();}
function render(data, justPaid){
  lastData=data;
  const inv = data.invoice, biz = data.business;
  const c = inv.currency;
  // Owner branding: template picks the shell, accent recolors the money
  // surfaces. Text on the accent flips by luminance so any brand color reads.
  document.body.className = biz.template === "minimal" ? "minimal" : biz.template === "modern" ? "modern" : "";
  const accent = /^#[0-9a-fA-F]{6}$/.test(biz.accent_color || "") ? biz.accent_color : "";
  if (accent) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
    const rs = document.documentElement.style;
    rs.setProperty("--accent-bg", accent);
    rs.setProperty("--accent-text", (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#14181d" : "#ffffff");
    rs.setProperty("--accent-soft", `rgba(${r},${g},${b},.18)`);
  }
  const contact = [biz.address, biz.phone, biz.tax_registration ? `GST/HST # ${biz.tax_registration}` : ""].filter(Boolean).join(" · ");
  const taxRows = (Array.isArray(inv.taxes) && inv.taxes.length ? inv.taxes : (inv.tax_total > 0 ? [{ name: inv.tax_name, rate: inv.tax_rate, total: inv.tax_total }] : []))
    .filter((t) => t.total > 0)
    .map((t) => { const pct = Math.round(t.rate * 100000) / 1000; return `<tr><td>${esc(t.name || "Tax")} (${pct.toFixed(pct % 1 ? ((pct * 100) % 1 ? 3 : 2) : 0)}%)</td><td class="num">${cur(t.total, c)}</td></tr>`; }).join("");
  const chip = inv.status === "paid" ? ["paid","PAID"] : inv.status === "partial" ? ["partial","PARTIALLY PAID"] : inv.status === "void" ? ["due","VOID"] : ["due","DUE"];
  card.innerHTML = `
    <div class="biz">${biz.logo_url ? `<img src="${esc(biz.logo_url)}" alt="">` : ""}<div><div class="name">${esc(biz.name)}</div>${contact ? `<div class="bizmeta">${esc(contact)}</div>` : ""}</div></div>
    <div class="head"><h1>Invoice ${esc(inv.number)}</h1><span class="chip ${chip[0]}">${chip[1]}</span></div>
    <div class="meta">${inv.customer ? esc(inv.customer.name) + (inv.customer.company ? " · " + esc(inv.customer.company) : "") + " · " : ""}Issued ${esc(inv.issue_date)}${inv.terms ? " · " + esc(inv.terms) : ""}${inv.due_date ? " · Due " + esc(inv.due_date) : ""}</div>
    <table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>
    ${inv.lines.map((l) => `<tr><td>${esc(l.name)}${l.description ? `<div class="desc">${esc(l.description)}</div>` : ""}${Number(l.discount_amount)>0?`<div class="desc">Original ${cur(l.gross_amount,c)} · Discount −${cur(l.discount_amount,c)}</div>`:""}</td><td class="num">${esc(l.quantity)}</td><td class="num">${cur(l.rate, c)}</td><td class="num">${cur(l.amount, c)}</td></tr>`).join("")}
    </tbody></table>
    <table class="totals"><tbody>
      ${inv.discount_kind && inv.discount_kind!=="none"?`<tr><td>Before discount</td><td class="num">${cur(inv.gross_subtotal,c)}</td></tr><tr><td>Discount${inv.discount_kind==="percent"?" ("+Number(inv.discount_value)+"%)":""}</td><td class="num">−${cur(inv.discount_total,c)}</td></tr>`:""}
      <tr><td>Subtotal</td><td class="num">${cur(inv.subtotal, c)}</td></tr>
      ${taxRows}
      <tr class="grand"><td>Total</td><td class="num">${cur(inv.total, c)}</td></tr>
      ${inv.balance > 0 && inv.balance < inv.total ? `<tr><td class="balance">Balance due</td><td class="num balance">${cur(inv.balance, c)}</td></tr>` : ""}
    </tbody></table>
    ${inv.payments.length ? `<div class="pays">${inv.payments.map((p) => `${Number(p.amount)<0 ? "Reversed " + cur(-Number(p.amount), c) : "Payment " + cur(p.amount, c)} · ${esc(p.method)} · ${esc(p.business_date || new Intl.DateTimeFormat("en-CA",{timeZone:inv.timezone||"America/Edmonton",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(p.received_at)))}`).join("<br>")}</div>` : ""}
    ${Number(inv.overpayment)>0 ? `<div class="instructions"><b>Overpayment ${cur(inv.overpayment,c)}</b>Contact ${esc(biz.name||"the business")} to arrange a refund.</div>` : ""}
    ${inv.memo ? `<div class="memo">${esc(inv.memo)}</div>` : ""}
    ${justPaid ? `<div class="paidbanner">✓ Payment received — thank you!</div>` : ""}
    ${!justPaid && inv.balance > 0 && data.can_pay ? `<button class="paybtn" id="pay">Pay ${cur(inv.balance, c)}</button>` : ""}
    ${!justPaid && inv.balance > 0 && !data.can_pay && data.payment_instructions ? `<div class="instructions"><b>How to pay</b>\n${esc(data.payment_instructions)}</div>` : ""}
    ${!justPaid && inv.balance > 0 && !data.can_pay && !data.payment_instructions ? `<div class="instructions"><b>How to pay</b>\nContact ${esc(biz.name || "the business")}${biz.phone ? ` at ${esc(biz.phone)}` : ""} to arrange payment.</div>` : ""}
    ${biz.footer_note ? `<div class="footnote">${esc(biz.footer_note)}</div>` : ""}
  `;
  const btn = document.getElementById("pay");
  if (btn) btn.onclick = async () => {
    if(btn.disabled)return;btn.disabled=true;btn.textContent="Opening secure checkout…";
    try {
      const d=await LinkRecovery.request(FN,{action:"pay",token,request_ref:checkoutRef});
      if(!d.url)throw new Error(d.error || "Checkout could not be opened. Try again.");
      const url=new URL(d.url);if(url.protocol!=="https:" || url.hostname!=="checkout.stripe.com")throw new Error("Checkout could not be verified. Try again.");
      location.href=url.href;
    }catch(error){
      const old=document.getElementById("payerror");if(old)old.remove();
      btn.insertAdjacentHTML("beforebegin",`<p id="payerror" role="status">${esc(LinkRecovery.message(error,"invoice"))}</p>`);
      btn.textContent="Retry secure checkout";btn.disabled=false;
      if(error.status===409)await loadInvoice();
    }
  };
}
async function loadInvoice(){
 if(loading)return;loading=true;
 // Audit 14.3: the server confirms the Stripe session even when the link has
 // since been revoked, replaced or expired; the page must say so.
 let paidOnInactiveLink=false;
 try{
  let paid=false;
  if(sessionId){const confirmation=await LinkRecovery.request(FN,{action:"pay-confirm",token,session_id:sessionId});paid=confirmation.paid===true;paidOnInactiveLink=paid && confirmation.link_active===false;sessionId="";history.replaceState(null,"",location.pathname+"?t="+encodeURIComponent(token));}
  const d=await LinkRecovery.request(`${FN}?action=public&t=${encodeURIComponent(token)}`);
  if(!d.invoice || !d.business || !Array.isArray(d.invoice.lines) || !Array.isArray(d.invoice.payments))throw new Error("The invoice could not be read. Try again.");
  render(d,paid);
 }catch(error){
  if(lastData)render(lastData,false);
  else card.innerHTML="";
  const terminal=LinkRecovery.terminal(error);
  const pay=document.getElementById("pay");if(pay)pay.disabled=true;
  card.insertAdjacentHTML("beforeend",`${paidOnInactiveLink?'<div class="paidbanner" role="status">✓ Payment received — thank you! The business has your payment on record.</div>':""}<div class="err" role="status">${esc(LinkRecovery.message(error,"invoice"))}${lastData?" Previously loaded details are shown above.":""}${terminal?"":'<button class="paybtn" id="loadretry">Retry</button>'}</div>`);
  const retry=document.getElementById("loadretry");if(retry)retry.onclick=loadInvoice;
 }finally{loading=false;}
}
loadInvoice();
