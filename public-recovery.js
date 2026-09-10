/* Shared response classification for customer and worker links. */
window.LinkRecovery = {
  async request(url, body) {
    let response;
    try {
      response = await fetch(url, body === undefined ? {signal: AbortSignal.timeout(20000)} : {
        method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(body), signal: AbortSignal.timeout(20000)
      });
    } catch { throw Object.assign(new Error("Could not connect. Check your connection and try again."), {status:0}); }
    let data;
    try {data=await response.json();} catch {throw Object.assign(new Error("The response could not be read. Try again."),{status:503});}
    if(!response.ok) throw Object.assign(new Error(data.error || "Temporarily unavailable. Try again."),{status:response.status,data});
    return data;
  },
  terminal(error) {return error.status===404 || error.status===410;},
  message(error,kind) {
    if(this.terminal(error))return `This ${kind} link is no longer active. Ask the business for a new one.`;
    if(error.status===402)return error.message || "This service is paused. Contact the business.";
    if(error.status===401 || error.status===403)return "Access is unavailable. Contact the business or try again.";
    return error.message || "Temporarily unavailable. Try again.";
  }
};
