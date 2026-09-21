// Account security — trusted-mobile two-step verification (texts only) and private links.
// v9: reuse pending codes and verify new devices after re-enabling.
// one mobile per account, captured once and locked; an on/off switch; every new
// device enters a texted code once. Codes are Telnyx Verify codes checked by the two-step function — the
// browser never sees or stores a code. Accounts that still hold an authenticator (the Apple review account)
// keep the authenticator code path.
const PHONE_RE = /^\+1[2-9]\d{2}[2-9]\d{6}$/;
export function normalizePhone(raw) {
  let p = String(raw || "").replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(p)) p = "+1" + p; else if (/^1\d{10}$/.test(p)) p = "+" + p;
  return PHONE_RE.test(p) ? p : null;
}
async function twoStep(supa, action, body = {}) {
  const { data, error } = await supa.functions.invoke("two-step", { body: { action, ...body } });
  if (error) {
    let d = null; try { d = await error.context?.json?.(); } catch {}
    const e = new Error(d?.message || "Text-message verification is temporarily unavailable. Please try again in a minute."); e.code = d?.error || "verification_unavailable"; throw e;
  }
  if (data?.error) { const e = new Error(data.message || data.error); e.code = data.error; throw e; }
  return data;
}
export async function twoStepStatus(supa) { return twoStep(supa, "status"); }
// Old-style authenticator (kept only for accounts that still have one).
async function totpNeeds(supa) { const { data } = await supa.auth.mfa.getAuthenticatorAssuranceLevel(); return !!data && data.nextLevel === "aal2" && data.currentLevel !== "aal2"; }
export async function needsMfa(supa) {
  const st = await twoStepStatus(supa);
  if (st.enabled && !st.this_session_trusted) return true;
  return totpNeeds(supa);
}
export async function markTwoStepPrompted(supa) { try { await twoStep(supa, "prompted"); } catch {} }
// One-time offer after the business is set up: no trusted mobile yet and never asked before → the setup dialog, once.
export async function offerTwoStepOnce(supa) {
  const st = await twoStepStatus(supa);
  if (st.has_phone || st.prompted) return;
  await openSecurity(supa, { setup: true });
}
export async function openSecurity(supa, {onVerified = () => {}, required = false, setup = false} = {}) {
  document.getElementById('ledger-security')?.remove();
  const dialog=document.createElement('dialog');dialog.id='ledger-security';
  dialog.style.cssText='width:min(440px,90vw);max-height:90vh;overflow:auto;padding:24px;border-radius:20px;background:#101827;color:#fff;border:1px solid #536078';
  dialog.innerHTML='<h2>'+(setup?'Protect your account':'Account security')+'</h2><p data-status>Loading security settings…</p>'
    +'<label data-switch hidden style="display:flex;align-items:center;gap:10px;margin:10px 0"><input type="checkbox" data-enabled style="width:22px;height:22px"> <span>Two-step verification by text message</span></label>'
    +'<p data-phone-line hidden class="note"></p>'
    +'<form data-phone hidden><label>Mobile number<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="587 555 0100" required aria-label="Mobile number"></label><button class="btn primary" type="submit">Text me a code</button></form>'
    +'<form data-verify hidden><label data-code-label>Code from the text message<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required aria-label="Verification code"></label><button class="btn primary" type="submit">Verify</button> <button class="btn ghost" type="button" data-resend>Send a new code</button></form>'
    +'<form data-totp hidden><label>Authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required aria-label="Authenticator code"></label><button class="btn primary" type="submit">Verify</button></form>'
    +'<p data-note role="status" style="min-height:1.2em"></p><p>Lost access to your mobile? <a href="mailto:supportteam@heyledger.ai?subject=Trusted%20mobile">Contact support</a> from your account email. A person must verify your identity before protection is reset. Email or a password reset alone never turns it off.</p><button class="btn ghost" type="button" data-close>'+(setup?'Not now':(required?'Sign out':'Close'))+'</button>';
  document.body.appendChild(dialog);dialog.showModal();
  const q=(sel)=>dialog.querySelector(sel);
  const status=q('[data-status]'),note=q('[data-note]'),switchRow=q('[data-switch]'),enabledBox=q('[data-enabled]'),phoneLine=q('[data-phone-line]'),phoneForm=q('form[data-phone]'),form=q('form[data-verify]'),totpForm=q('form[data-totp]'),resend=q('[data-resend]');
  let st=null, totpFactor=null, mode='';
  const close=()=>{dialog.close();dialog.remove();};
  q('[data-close]').onclick=async()=>{if(required){await supa.auth.signOut();location.reload();}else{if(setup&&!(st?.has_phone))await markTwoStepPrompted(supa);close();}};
  if(required)dialog.addEventListener('cancel',e=>e.preventDefault());dialog.addEventListener('close',()=>dialog.remove());
  const friendly=(err,fallback)=>String(err?.message||fallback||'Something went wrong.');
  async function sendCode(phone){note.textContent='';const r=await twoStep(supa,'send',phone?{phone}:{});mode='verify';form.hidden=false;form.elements.code.value='';form.elements.code.focus();note.textContent='Code sent to '+r.phone_last4+'. It expires in five minutes.';}
  async function refresh(){
    st=await twoStepStatus(supa);
    const totp=await totpNeeds(supa);
    if(totp){const {data}=await supa.auth.mfa.listFactors();totpFactor=(data?.totp||[]).find(x=>x.status==='verified')?.id||null;}
    switchRow.hidden=!st.has_phone;enabledBox.checked=!!st.enabled;enabledBox.disabled=!st.this_session_trusted&&!!st.enabled;
    phoneLine.hidden=!st.has_phone;phoneLine.textContent=st.has_phone?('Trusted mobile: '+st.phone_last4+' · set once and locked. To change it, email supportteam@heyledger.ai from your account email.'):'';
    if(st.enabled&&!st.this_session_trusted){status.textContent='Confirm it\'s you on this device.';phoneForm.hidden=true;if(mode!=='verify'){if(st.pending){mode='verify';form.hidden=false;note.textContent='Enter the code already sent to '+(st.pending_last4||st.phone_last4)+'.';}else{try{await sendCode();}catch(e){note.textContent=friendly(e);form.hidden=false;mode='verify';}}}}
    else if(!st.has_phone){status.textContent=setup?'One-time setup: add your mobile and Ledger will text you a code the first time you sign in on a new device. That\'s it — no authenticator app.':'Two-step verification is off. Add your mobile once and Ledger will text you a code when you sign in on a new device.';phoneForm.hidden=false;form.hidden=mode!=='verify';phoneForm.elements.phone.focus();}
    else{status.textContent=st.enabled?'Two-step verification is on. New devices get a texted code.':'Two-step verification is off. Switch it on to protect your account.';phoneForm.hidden=true;form.hidden=true;mode='';}
    totpForm.hidden=!(totp&&totpFactor);if(totp&&totpFactor){status.textContent='Enter the code from your authenticator app to continue.';}
  }
  enabledBox.onchange=async()=>{enabledBox.disabled=true;note.textContent='';try{const r=await twoStep(supa,enabledBox.checked?'enable':'disable');note.textContent=r.enabled?'Two-step verification is on.':'Two-step verification is off.';await refresh();}catch(e){note.textContent=friendly(e);enabledBox.checked=!!st?.enabled;}finally{enabledBox.disabled=!!(st?.enabled&&!st?.this_session_trusted);}};
  phoneForm.onsubmit=async e=>{e.preventDefault();const b=phoneForm.querySelector('button');b.disabled=true;note.textContent='';try{const phone=normalizePhone(phoneForm.elements.phone.value);if(!phone)throw Error('Enter a Canadian or US mobile number, like 587 555 0100.');await sendCode(phone);phoneForm.hidden=true;}catch(err){note.textContent=friendly(err);}finally{b.disabled=false;}};
  resend.onclick=async()=>{resend.disabled=true;try{await sendCode(st?.has_phone?undefined:normalizePhone(phoneForm.elements.phone.value));}catch(e){note.textContent=friendly(e);}finally{resend.disabled=false;}};
  form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button[type=submit]');b.disabled=true;note.textContent='';try{const code=form.elements.code.value.trim();if(!/^[0-9]{6}$/.test(code))throw Error('Enter the six-digit code from the text message.');const r=await twoStep(supa,'verify',{code});form.elements.code.value='';mode='';form.hidden=true;note.textContent=r.setup?'Done. Two-step verification is on and this device is trusted.':'Verified. This device is trusted.';await refresh();onVerified();if(required||setup)close();}catch(err){note.textContent=friendly(err);}finally{b.disabled=false;}};
  totpForm.onsubmit=async e=>{e.preventDefault();const b=totpForm.querySelector('button');b.disabled=true;note.textContent='';try{const code=totpForm.elements.code.value.trim();if(!/^[0-9]{6}$/.test(code)||!totpFactor)throw Error('Enter the six-digit code from your authenticator.');const {error}=await supa.auth.mfa.challengeAndVerify({factorId:totpFactor,code});totpForm.elements.code.value='';if(error)throw error;await refresh();onVerified();if(required)close();}catch(err){note.textContent=friendly(err,'Verification failed.');}finally{b.disabled=false;}};
  if(!required) {
    const section=document.createElement('section');section.style.cssText='margin-top:24px;border-top:1px solid #536078;padding-top:16px';
    const heading=document.createElement('h3');heading.textContent='Business private links';
    const explanation=document.createElement('p');explanation.textContent='Owners and admins can revoke or replace crew, customer, invoice, estimate and tracking links. Replacement stops the old link immediately; it is not sent automatically. Inactive people and void documents stay unavailable.';
    const load=document.createElement('button');load.className='btn ghost';load.textContent='Manage private links';
    const list=document.createElement('div'),message=document.createElement('p');message.setAttribute('role','status');section.append(heading,explanation,load,message,list);dialog.append(section);
    let offset=0;
    async function call(action,body={}) {const {data,error}=await supa.functions.invoke('client-hub',{body:{action:'private-links/'+action,...body}});if(error)throw Error('Private links could not be managed. Owner/admin access and a verified two-factor session are required.');if(data?.error)throw Error(data.error);return data;}
    async function render(reset=true) {load.disabled=true;message.textContent='';try{if(reset){offset=0;list.replaceChildren();}const data=await call('list',{offset});for(const link of data.links){
      const row=document.createElement('div');row.style.cssText='padding:12px 0;border-bottom:1px solid #536078';
      const label=document.createElement('p');const expired=Date.parse(link.expires_at)<=Date.now();label.textContent=link.label+' ('+link.kind+') — '+(link.revoked_at?'Revoked':expired?'Expired':'Expires '+new Date(link.expires_at).toLocaleDateString());
      const revoke=document.createElement('button');revoke.className='btn ghost';revoke.textContent='Revoke';revoke.disabled=!!link.revoked_at;
      const renew=document.createElement('button');renew.className='btn ghost';renew.textContent='Replace link';
      revoke.onclick=async()=>{if(!confirm('Stop this private link from working immediately?'))return;revoke.disabled=true;try{await call('revoke',{kind:link.kind,id:link.record_id});await render();message.textContent='Link revoked.';}catch(e){message.textContent=e.message;revoke.disabled=false;}};
      renew.onclick=async()=>{if(!confirm('Replace this link? The old link will stop working. Share the replacement only with its intended recipient.'))return;renew.disabled=true;try{const data=await call('renew',{kind:link.kind,id:link.record_id});await render();message.textContent='Replacement expires '+new Date(data.link.expires_at).toLocaleDateString()+'. Copy and share securely:';const field=document.createElement('input');field.readOnly=true;field.value=data.link.url;field.style.width='100%';message.append(document.createElement('br'),field);field.select();}catch(e){message.textContent=e.message;renew.disabled=false;}};
      row.append(label,revoke,renew);list.append(row);
    }offset=data.nextOffset;load.textContent=data.more?'Load more links':'Refresh links';load.onclick=()=>render(!data.more);if(!data.links.length&&reset)message.textContent='No private links for this business.';}catch(e){message.textContent=e.message;}finally{load.disabled=false;}}
    load.onclick=()=>render();
  }
  try{await refresh();}catch(err){status.textContent='Security settings could not load.';note.textContent=friendly(err);}
}
