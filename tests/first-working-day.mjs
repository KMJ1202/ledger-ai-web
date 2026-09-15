// Run from this repository: node tests/first-working-day.mjs
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');const start=source.indexOf('function firstWorkingDaySheet(){');const end=source.indexOf('\n}',start)+2;assert(start>0&&end>start);const actual=source.slice(start,end);
for(const provider of ['native','quickbooks']){
 const button={dataset:{first:'invoice'}};let result,ready;
 const ctx={api:async()=>({provider,steps:[{id:'invoice',title:'Create your first invoice',done:false}],note:'Review before real work'}),esc:x=>x,
 sheet:(_html,callback)=>{ready=callback({querySelector:()=>({innerHTML:'',querySelectorAll:()=>[button],querySelector:()=>({})})})},
 nativeComposerSheet:()=>result='native',composerSheet:()=>result='quickbooks',shopProfileSheet(){},bringDataSheet(){},catalogImportSheet(){},booksSettingsSheet(){},bookingSheet(){},schedulingResourcesSheet(){},phoneGuidedDemo(){}};
 vm.createContext(ctx);vm.runInContext(actual+';firstWorkingDaySheet()',ctx);await ready;button.onclick();assert.equal(result,provider,'The checklist must use the owner-selected books, without asking for an unrelated connection');console.log('PASS first-day invoice uses',provider);
}
