// heyledger.ai home — "not ready to talk yet?" email capture (Kyle 2026-09-05, override 1202).
// Posts to founder-booking {action:"subscribe"}; the function saves a lead and emails the walkthrough.
(function(){
  var f=document.getElementById("captureForm"),e=document.getElementById("captureEmail"),b=document.getElementById("captureBtn"),m=document.getElementById("captureMsg");
  if(!f)return;
  function say(t,c){m.textContent=t;m.className="cmsg"+(c?" "+c:"");}
  f.addEventListener("submit",function(ev){
    ev.preventDefault();
    var v=(e.value||"").trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)){say("Enter a valid email and we'll send the walkthrough there.","err");e.focus();return;}
    b.disabled=true;var was=b.textContent;b.textContent="Sending…";say("");
    fetch("https://lbzkyyehmgudlxmfpzzh.supabase.co/functions/v1/founder-booking",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({action:"subscribe",email:v,website:(f.querySelector(".hp")||{}).value||""})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(x){
      if(x.ok&&x.j&&x.j.ok){say("Sent — check your inbox for \"Ledger AI in 5 minutes\".","ok");e.value="";b.textContent="Sent ✓";}
      else{say((x.j&&x.j.error)||"Something went wrong — please try again.","err");b.disabled=false;b.textContent=was;}
    })
    .catch(function(){say("Couldn't reach us just now — please try again in a minute.","err");b.disabled=false;b.textContent=was;});
  });
})();
