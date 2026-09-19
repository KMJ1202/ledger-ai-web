// Run from this repository: node tests/first-working-day.mjs
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');const start=source.indexOf('function firstWorkingDaySheet(');const end=source.indexOf('\n}',start)+2;assert(start>0&&end>start);const actual=source.slice(start,end);
// The sheet's words and the "already set up" block come from the onboarding tables (round 2).
const sliceOf=(from,to)=>{const a=source.indexOf(from);const b=source.indexOf(to,a);assert(a>0&&b>a,from);return source.slice(a,b);};
const copyTables=sliceOf('const OB_TITLE = ','\n// Screen order per section')+sliceOf('const OB_COPY = {','\n};')+'\n};'+sliceOf('const obFill = ','\n')+sliceOf('function obAppliedHtml(','\n}')+'\n}';
const esc=x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
for(const provider of ['native','quickbooks']){
 const button={dataset:{first:'invoice'}};let result,ready,html;
 const ctx={S:{},OB_SECTIONS:[['confirm',"Here's what Ledger understands"]],BUSINESS_TYPES:[],OB_PLAN_ACTIONS:{},api:async()=>({provider,steps:[{id:'invoice',title:'Create your first invoice',done:false}],note:'Review before real work'}),esc,
 sheet:(h,callback)=>{html=h;ready=callback({querySelector:()=>({innerHTML:'',querySelectorAll:()=>[button],querySelector:()=>({})})})},
 nativeComposerSheet:()=>result='native',composerSheet:()=>result='quickbooks',shopProfileSheet(){},bringDataSheet(){},catalogImportSheet(){},booksSettingsSheet(){},bookingSheet(){},schedulingResourcesSheet(){},phoneGuidedDemo(){}};
 vm.createContext(ctx);vm.runInContext(copyTables+'\n'+actual+';firstWorkingDaySheet()',ctx);await ready;button.onclick();assert.equal(result,provider,'The checklist must use the owner-selected books, without asking for an unrelated connection');console.log('PASS first-day invoice uses',provider);
 assert.match(html,/<h2>Your first working day<\/h2>/);assert.ok(!html.includes('Already set up from your answers'),'nothing applied → no block');
 // What onboarding-complete applied shows once, under the intro, one line each (round 2, Q3).
 vm.runInContext('firstWorkingDaySheet({applied:["Tax set to GST 5% for Alberta","Payment terms: due on receipt"]})',ctx);await ready;
 assert.match(html,/<\/p><div class="cmpsect obapplied"><b>Already set up from your answers<\/b><ul[^>]*><li>Tax set to GST 5% for Alberta<\/li><li>Payment terms: due on receipt<\/li><\/ul><\/div><div id="first-steps">/);
 vm.runInContext('firstWorkingDaySheet({applied:[]})',ctx);await ready;assert.ok(!html.includes('obapplied'),'empty list → nothing');
 console.log('PASS first-day sheet shows what was applied once, under the intro');
}

const bookingStart=source.indexOf('function bookingSheet(');const bookingEnd=source.indexOf('async function loadReceipts()',bookingStart);assert(bookingStart>0&&bookingEnd>bookingStart);
for(const args of [[],['2026-10-01'],[null,{start:'2026-10-02T10:00:00',end:'2026-10-02T11:00:00',title:'Existing appointment'}]]){
 let html;const ctx={sheet:text=>html=text,isAuto:()=>false,esc:x=>x,BOOK_SOURCES:['Phone'],args};vm.createContext(ctx);vm.runInContext(source.slice(bookingStart,bookingEnd)+';bookingSheet(...args)',ctx);
 assert.match(html,/id="bkStart"[^>]*value="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}"/,'Every entry point must open a usable date form, including setup without a calendar selection');console.log('PASS booking date entry',args.length?JSON.stringify(args):'first-day default');
}
