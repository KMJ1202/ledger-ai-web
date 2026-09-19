// Run from this repository: node tests/first-working-day.mjs
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');const start=source.indexOf('function firstWorkingDaySheet(){');const end=source.indexOf('\n}',start)+2;assert(start>0&&end>start);const actual=source.slice(start,end);
for(const provider of ['native','quickbooks']){
 const button={dataset:{first:'invoice'}};let result,ready;
 const ctx={S:{},OB_PLAN_ACTIONS:{},api:async()=>({provider,steps:[{id:'invoice',title:'Create your first invoice',done:false}],note:'Review before real work'}),esc:x=>x,
 sheet:(_html,callback)=>{ready=callback({querySelector:()=>({innerHTML:'',querySelectorAll:()=>[button],querySelector:()=>({})})})},
 nativeComposerSheet:()=>result='native',composerSheet:()=>result='quickbooks',shopProfileSheet(){},bringDataSheet(){},catalogImportSheet(){},booksSettingsSheet(){},bookingSheet(){},schedulingResourcesSheet(){},phoneGuidedDemo(){}};
 vm.createContext(ctx);vm.runInContext(actual+';firstWorkingDaySheet()',ctx);await ready;button.onclick();assert.equal(result,provider,'The checklist must use the owner-selected books, without asking for an unrelated connection');console.log('PASS first-day invoice uses',provider);
}

const bookingStart=source.indexOf('function bookingSheet(');const bookingEnd=source.indexOf('async function loadReceipts()',bookingStart);assert(bookingStart>0&&bookingEnd>bookingStart);
for(const args of [[],['2026-10-01'],[null,{start:'2026-10-02T10:00:00',end:'2026-10-02T11:00:00',title:'Existing appointment'}]]){
 let html;const ctx={sheet:text=>html=text,isAuto:()=>false,esc:x=>x,BOOK_SOURCES:['Phone'],args};vm.createContext(ctx);vm.runInContext(source.slice(bookingStart,bookingEnd)+';bookingSheet(...args)',ctx);
 assert.match(html,/id="bkStart"[^>]*value="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}"/,'Every entry point must open a usable date form, including setup without a calendar selection');console.log('PASS booking date entry',args.length?JSON.stringify(args):'first-day default');
}
