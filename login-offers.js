// Pending selection is not an entitlement. Only the signed-in server can grant one.
const KEY='ledger.offer.pending',TTL=30*60*1000;
export function pendingOffer(storage=sessionStorage,now=Date.now()) {
 try { const p=JSON.parse(storage.getItem(KEY)||'null');
  if(!p||!['invitation','promotion'].includes(p.kind)||typeof p.code!=='string'||p.code.length>80||!Number.isFinite(p.started)||now<p.started||now-p.started>TTL){storage.removeItem(KEY);return null;}return p;
 }catch{storage.removeItem(KEY);return null;}
}
export function saveOffer(kind,code,user=null,storage=sessionStorage) {
 code=code.trim().toUpperCase();
 if(!['invitation','promotion'].includes(kind)||!code||code.length>80||!/^[A-Z0-9_-]+$/.test(code))throw Error('Enter a valid offer code.');
 if(kind==='invitation'&&!/^LEDGER-[A-Z0-9]{24,48}$/.test(code))throw Error('Check your Ledger invitation code. Paid promotions use the subscription promo option.');
 storage.setItem(KEY,JSON.stringify({kind,code,user,started:Date.now()}));
}
export function clearOffer(storage=sessionStorage){storage.removeItem(KEY);}
export function bindOffer(user,storage=sessionStorage) {
 const p=pendingOffer(storage);if(!p)return null;if(p.user&&p.user!==user){clearOffer(storage);return null;}
 p.user=user;storage.setItem(KEY,JSON.stringify(p));return p;
}
