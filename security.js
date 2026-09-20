// Account security — two-step verification (text message or authenticator app) and private links.
// v5 (Kyle 2026-09-20): a texted code is the default; an authenticator app stays available.
// TOTP secrets and one-time codes are shown only to the account owner, never logged or persisted here.
const PHONE_RE = /^\+1[2-9]\d{2}[2-9]\d{6}$/;
export function normalizePhone(raw) {
  let p = String(raw || "").replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(p)) p = "+1" + p; else if (/^1\d{10}$/.test(p)) p = "+" + p;
  return PHONE_RE.test(p) ? p : null;
}
const last4 = (phone) => "···" + String(phone || "").slice(-4);
const friendly = (err, fallback) => {
  const m = String(err?.message || err || "");
  if (/rate limit|too many|over_sms_send_rate_limit|seconds/i.test(m)) return "A code was sent a moment ago. Wait a minute, then try again.";
  if (/invalid|incorrect|expired|mismatch/i.test(m) && /code|otp|token|challenge/i.test(m)) return "That code didn't match or has expired. Send a new code and try again.";
  if (/phone/i.test(m) && /invalid|format/i.test(m)) return "Enter a Canadian or US mobile number, like 587 555 0100.";
  return m || fallback;
};
export async function openSecurity(supa, {onVerified = () => {}, required = false} = {}) {
  document.getElementById('ledger-security')?.remove();
  const dialog=document.createElement('dialog');dialog.id='ledger-security';
  dialog.style.cssText='width:min(440px,90vw);max-height:90vh;overflow:auto;padding:24px;border-radius:20px;background:#101827;color:#fff;border:1px solid #536078';
  dialog.innerHTML='<h2>Account security</h2><p data-status>Loading security settings…</p><div data-factors></div>'
    +'<div data-methods hidden><p class="note">Choose how to confirm it\'s you.</p><button class="btn primary" type="button" data-add-phone>Text me a code</button> <button class="btn ghost" type="button" data-add>Use an authenticator app</button></div>'
    +'<form data-phone hidden><label>Mobile number<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="587 555 0100" required aria-label="Mobile number"></label><button class="btn primary" type="submit">Send code</button> <button class="btn ghost" type="button" data-phone-cancel>Back</button></form>'
    +'<div data-enroll></div>'
    +'<form data-verify hidden><label data-code-label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required aria-label="Verification code"></label><button class="btn primary" type="submit">Verify</button> <button class="btn ghost" type="button" data-resend hidden>Send a new code</button></form>'
    +'<p data-note role="status" style="min-height:1.2em"></p><button class="btn ghost" type="button" data-close>Close</button>';
  document.body.appendChild(dialog);dialog.showModal();
  const status=dialog.querySelector('[data-status]'),note=dialog.querySelector('[data-note]'),factors=dialog.querySelector('[data-factors]'),methods=dialog.querySelector('[data-methods]'),setup=dialog.querySelector('[data-enroll]'),form=dialog.querySelector('form[data-verify]'),phoneForm=dialog.querySelector('form[data-phone]'),codeLabel=dialog.querySelector('[data-code-label]'),resend=dialog.querySelector('[data-resend]');
  let chosen=null, chosenType='totp', challengeId=null;
  const close=()=>{dialog.close();dialog.remove();};dialog.querySelector('[data-close]').textContent=required?'Sign out':'Close';dialog.querySelector('[data-close]').onclick=async()=>{if(required){await supa.auth.signOut();location.reload();}else close();};if(required)dialog.addEventListener('cancel',e=>e.preventDefault());dialog.addEventListener('close',()=>dialog.remove());
  // A texted code: the challenge sends the SMS; the code is then verified against that challenge.
  async function sendCode(){note.textContent='';const {data,error}=await supa.auth.mfa.challenge({factorId:chosen});if(error)throw error;challengeId=data.id;note.textContent='Code sent by text. It expires in five minutes.';}
  async function choose(id,type){chosen=id;chosenType=type;challengeId=null;form.hidden=false;form.elements.code.value='';codeLabel.firstChild.textContent=type==='phone'?'Code from the text message':'Authenticator code';resend.hidden=type!=='phone';
    if(type==='phone'){try{await sendCode();}catch(e){note.textContent=friendly(e,'Could not send the code.');}}form.elements.code.focus();}
  resend.onclick=async()=>{resend.disabled=true;try{await sendCode();}catch(e){note.textContent=friendly(e,'Could not send the code.');}finally{resend.disabled=false;}};
  async function refresh(){const {data,error}=await supa.auth.mfa.listFactors();if(error)throw error;
    const verified=(data?.all||[]).filter(x=>x.status==='verified'&&(x.factor_type==='totp'||x.factor_type==='phone'));
    const {data:aal,error:ae}=await supa.auth.mfa.getAuthenticatorAssuranceLevel();if(ae)throw ae;
    status.textContent=verified.length ? (aal.currentLevel==='aal2'?'Two-step verification is active for this session.':'Confirm it\'s you to continue.') : 'Two-step verification is required for every Ledger account. Pick a method to continue.';
    factors.replaceChildren();
    for(const f of verified){const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;align-items:center;margin:6px 0';
      const b=document.createElement('button');b.type='button';b.className='btn ghost';b.textContent=(f.factor_type==='phone'?'Text a code to '+last4(f.phone):(f.friendly_name||'Authenticator app'));b.onclick=()=>choose(f.id,f.factor_type);row.append(b);
      if(verified.length>1&&aal.currentLevel==='aal2'){const rm=document.createElement('button');rm.type='button';rm.className='btn ghost';rm.textContent='Remove';rm.title='Remove this method';rm.onclick=async()=>{if(!confirm('Remove this two-step method? You can add it again any time.'))return;rm.disabled=true;try{const {error}=await supa.auth.mfa.unenroll({factorId:f.id});if(error)throw error;await refresh();}catch(e){note.textContent=friendly(e,'Could not remove it.');rm.disabled=false;}};row.append(rm);}
      factors.append(row);}
    methods.hidden=false;methods.querySelector('.note').textContent=verified.length?'Add another way to confirm it\'s you:':'Choose how to confirm it\'s you.';
    // One verified phone factor and a session that still needs it: send the text right away.
    if(aal.currentLevel!=='aal2'&&verified.length===1&&verified[0].factor_type==='phone'&&!chosen)await choose(verified[0].id,'phone');
  }
  // Every abandoned "Add" leaves an unverified factor behind and each one counts
  // toward GoTrue's enrolled-factor cap (audit 01.5). Clear those first — only
  // rows whose status is unverified; a verified factor is never touched.
  async function discardUnverified(){const {data,error}=await supa.auth.mfa.listFactors();if(error)return;for(const f of (data?.all||[]).filter(x=>x.status==='unverified'&&x.id)){await supa.auth.mfa.unenroll({factorId:f.id}).catch(()=>{});}}
  dialog.querySelector('[data-add-phone]').onclick=()=>{note.textContent='';setup.replaceChildren();form.hidden=true;phoneForm.hidden=false;phoneForm.elements.phone.focus();};
  dialog.querySelector('[data-phone-cancel]').onclick=()=>{phoneForm.hidden=true;};
  phoneForm.onsubmit=async e=>{e.preventDefault();const button=phoneForm.querySelector('button[type=submit]');button.disabled=true;note.textContent='';try{
      const phone=normalizePhone(phoneForm.elements.phone.value);if(!phone)throw Error('Enter a Canadian or US mobile number, like 587 555 0100.');
      await discardUnverified();
      const {data,error}=await supa.auth.mfa.enroll({factorType:'phone',phone,friendlyName:'Phone '+last4(phone)});if(error)throw error;
      phoneForm.hidden=true;await choose(data.id,'phone');
    }catch(err){note.textContent=friendly(err,'Could not start text-message verification.');}finally{button.disabled=false;}};
  dialog.querySelector('[data-add]').onclick=async e=>{e.target.disabled=true;note.textContent='';phoneForm.hidden=true;try{await discardUnverified();const {data,error}=await supa.auth.mfa.enroll({factorType:'totp',friendlyName:'Authenticator '+new Date().toLocaleDateString()+' '+new Date().toLocaleTimeString()});if(error)throw error;setup.replaceChildren();const p=document.createElement('p');p.textContent='Scan this code with your authenticator app, or type the key below, then enter the six-digit code it shows.';const img=document.createElement('img');img.src=data.totp.qr_code;img.alt='Authenticator setup QR code';img.width=180;img.height=180;img.style.background='#fff';img.style.borderRadius='8px';const key=document.createElement('p');key.style.cssText='font-family:ui-monospace,monospace;word-break:break-all';key.textContent=data.totp.secret;setup.append(p,img,key);await choose(data.id,'totp');}catch(err){note.textContent=friendly(err,'Could not add an authenticator.');}finally{e.target.disabled=false;}};
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;note.textContent='';try{const code=form.elements.code.value.trim();if(!/^[0-9]{6}$/.test(code)||!chosen)throw Error(chosenType==='phone'?'Enter the six-digit code from the text message.':'Enter the six-digit code from your authenticator.');
      let error;
      if(chosenType==='phone'){if(!challengeId)await sendCode();({error}=await supa.auth.mfa.verify({factorId:chosen,challengeId,code}));}
      else ({error}=await supa.auth.mfa.challengeAndVerify({factorId:chosen,code}));
      form.elements.code.value='';if(error)throw error;
      setup.replaceChildren();form.hidden=true;chosen=null;challengeId=null;await refresh();note.textContent='Verified. Two-step verification is on.';onVerified();if(required)close();
    }catch(err){note.textContent=friendly(err,'Verification failed.');}finally{button.disabled=false;}};
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
  try{await refresh();}catch(err){status.textContent='Security settings could not load.';note.textContent=friendly(err,'');}
}
export async function needsMfa(supa){const {data,error}=await supa.auth.mfa.getAuthenticatorAssuranceLevel();if(error)throw error;if(!data?.currentLevel)throw Error('Account security could not be verified. Please retry.');return data.currentLevel!=='aal2'||data.nextLevel!=='aal2';}
