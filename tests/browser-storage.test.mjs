import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createBrowserAPI } from '../lib/browser-api.ts';
import { initial, validate, nativeBalances } from '../lib/ledger.ts';
import { sampleLedger } from '../lib/sample-ledger.ts';
import { emptyDigital } from '../lib/digital.ts';
import { MARKET_PRESETS, marketWatchlist } from '../lib/market-watchlist.ts';
const factory=new IDBFactory();let calls=0;
const api=createBrowserAPI(factory,'test-ledger',async()=>{calls++;throw Error('No network permitted in financial storage tests');});
const request=async(path,method='GET',body)=>{const r=await api.request(path,{method,...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
const catalog=(await request('/api/books')).data;assert.equal(catalog.books.length,1);assert.equal(catalog.books[0].id,'default');assert.match(catalog.owner,/^browser-/);
const first=(await request('/api/ledger')).data;assert.equal(first.revision,0);assert.deepEqual(first.ledger,initial);assert.equal(first.owner,catalog.owner);
const ledger=structuredClone(initial);ledger.transactions.push({id:'local-first',date:'2026-10-21',type:'expense',amount:3200,account:'bank',to:'',category:'c0',merchant:'午餐',channel:'',note:'private fixture',status:'posted'});
assert.equal((await request('/api/ledger','PUT',{ledger,revision:0,action:'新增本机流水'})).status,200);
assert.equal((await request('/api/ledger')).data.ledger.transactions.length,1);
const history=(await request('/api/history')).data.history;assert.equal(history.length,1);assert.equal((await request('/api/history?id='+history[0].id)).data.ledger.transactions[0].id,'local-first');
const stale=await request('/api/ledger','PUT',{ledger,revision:0});assert.equal(stale.status,409);assert.equal(stale.data.conflict,true);assert.equal(stale.data.revision,1);
const book=(await request('/api/books','POST',{name:'独立账本'})).data.book;assert.equal((await request('/api/ledger?book='+book.id)).data.ledger.transactions.length,0);
assert.equal((await request('/api/history?book='+book.id+'&id='+history[0].id)).status,404);
assert.equal((await request('/api/books?book='+book.id,'PATCH',{name:'家庭账本'})).status,200);
assert.equal((await request('/api/books','POST',{name:'家庭账本'})).status,409);assert.equal((await request('/api/books','POST',{name:'   '})).status,400);
assert.equal((await request('/api/ledger?book=missing')).status,404);assert.equal((await request('/api/ledger?book=__bad/name')).status,400);
const invalid=structuredClone(ledger);invalid.transactions[0].amount=-1;
assert.equal((await request('/api/ledger','PUT',{ledger:invalid,revision:1})).status,400);assert.equal((await request('/api/ledger')).data.revision,1);
const consent=structuredClone(ledger);consent.preferences={cloudAI:true};await request('/api/ledger','PUT',{ledger:consent,revision:1});assert.equal((await request('/api/ledger')).data.ledger.preferences.cloudAI,false);
for(let revision=2;revision<25;revision++)assert.equal((await request('/api/ledger','PUT',{ledger,revision,action:'历史保留'})).status,200);
assert.equal((await request('/api/history')).data.history.length,20);assert.equal((await request('/api/history?id='+history[0].id)).status,404);
const sample=(await request('/api/books','POST',{name:'示例账本',example:true})).data.book;const sampleData=(await request('/api/ledger?book='+sample.id)).data.ledger;
validate(sampleData);assert.equal(sampleData.transactions.length,6);assert.equal(sampleData.transactions.every(t=>t.note.includes('虚构')),true);assert.equal((await request('/api/ledger')).data.ledger.transactions[0].id,'local-first');
assert.equal(nativeBalances(sampleData).HKD['example-bank'],30000);
// Watchlists are financial-book preferences: persist, restore and isolate them with the ledger.
const marketBook=structuredClone(initial);marketBook.digital={...emptyDigital(),marketWatchlist:[MARKET_PRESETS.find(c=>c.symbol==='BTC')]};
assert.equal((await request('/api/ledger?book='+book.id,'PUT',{ledger:marketBook,revision:0,action:'添加BTC行情'})).status,200);
const marketSaved=(await request('/api/ledger?book='+book.id)).data;
assert.deepEqual(marketWatchlist(marketSaved.ledger.digital),marketBook.digital.marketWatchlist);
const marketHistory=(await request('/api/history?book='+book.id)).data.history;
assert.deepEqual((await request('/api/history?book='+book.id+'&id='+marketHistory[0].id)).data.ledger.digital.marketWatchlist,marketBook.digital.marketWatchlist);
assert.deepEqual(marketWatchlist((await request('/api/ledger')).data.ledger.digital||emptyDigital()),[]);
const marketBookB=(await request('/api/books','POST',{name:'行情隔离账本'})).data.book;
const marketB=structuredClone(initial);marketB.digital={...emptyDigital(),marketWatchlist:[{symbol:'SOL',name:'Solana',priceId:'solana'}]};
assert.equal((await request('/api/ledger?book='+marketBookB.id,'PUT',{ledger:marketB,revision:0})).status,200);
assert.equal((await request('/api/ledger?book='+book.id)).data.ledger.digital.marketWatchlist[0].symbol,'BTC');
assert.equal((await request('/api/ledger?book='+marketBookB.id)).data.ledger.digital.marketWatchlist[0].symbol,'SOL');
const invalidMarket=structuredClone(marketBook);invalidMarket.digital.marketWatchlist=[{symbol:'BTC',name:'Impostor',priceId:'solana'}];
assert.equal((await request('/api/ledger?book='+book.id,'PUT',{ledger:invalidMarket,revision:1})).status,400);
assert.equal((await request('/api/ledger?book='+book.id)).data.revision,1);
const marketBackup=JSON.parse(JSON.stringify({version:4,ledger:marketSaved.ledger}));validate(marketBackup.ledger);
assert.equal((await request('/api/ledger?book='+marketBookB.id,'PUT',{ledger:marketBackup.ledger,revision:1,action:'恢复行情列表备份'})).status,200);
assert.deepEqual((await request('/api/ledger?book='+marketBookB.id)).data.ledger.digital.marketWatchlist,marketBook.digital.marketWatchlist);
marketBackup.ledger.digital.marketWatchlist=[];
assert.equal((await request('/api/ledger?book='+marketBookB.id,'PUT',{ledger:marketBackup.ledger,revision:2,action:'移除全部行情'})).status,200);
assert.deepEqual((await request('/api/ledger?book='+marketBookB.id)).data.ledger.digital.marketWatchlist,[]);
assert.equal((await request('/api/ledger?book='+book.id)).data.ledger.digital.marketWatchlist[0].symbol,'BTC');
// A pre-removal backup can still be restored; the hidden market does not delete saved assets.
const legacyBoxBook=(await request('/api/books','POST',{name:'旧版资产备份'})).data.book;
const oldBoxBackup=structuredClone(initial);oldBoxBackup.digital={
 ...emptyDigital(),marketWatchlist:[{symbol:'BOX',name:'BOX（李笑来）',priceId:''}],
 wallets:[{id:'old-wallet',name:'Synthetic wallet',kind:'wallet',network:''}],
 assets:[{id:'old-box',symbol:'BOX',name:'BOX',priceId:'',network:''}],
 events:[{id:'old-opening',type:'opening',date:'2026-10-21',created:'2026-10-21T00:00:00Z',wallet:'old-wallet',asset:'old-box',quantity:'2',fiatCNY:10000,txHash:'',note:'Saved synthetic transaction',status:'posted'}],
 manualBalances:[{id:'old-wallet|old-box',wallet:'old-wallet',asset:'old-box',quantity:'3.123456789012345678',updated:'2026-10-21T00:00:00Z',note:'Saved synthetic balance'}],
 quotes:{'old-box':{priceCNY:'50',source:'手动录入',at:'2026-10-21T00:00:00Z'}},
};
validate(oldBoxBackup);
assert.equal((await request('/api/ledger?book='+legacyBoxBook.id,'PUT',{ledger:oldBoxBackup,revision:0,action:'恢复旧版备份'})).status,200);
const restoredOldBox=(await request('/api/ledger?book='+legacyBoxBook.id)).data.ledger.digital;
assert.deepEqual(marketWatchlist(restoredOldBox),[]);
for(const field of ['assets','events','manualBalances','quotes'])assert.deepEqual(restoredOldBox[field],oldBoxBackup.digital[field]);
const api2=createBrowserAPI(factory,'test-ledger');const base=(await request('/api/ledger')).data;
const concurrent=await Promise.all([api.request('/api/ledger',{method:'PUT',body:JSON.stringify({ledger,revision:base.revision})}),api2.request('/api/ledger',{method:'PUT',body:JSON.stringify({ledger,revision:base.revision})})]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
await api2.close();await api.close();
const reopened=createBrowserAPI(factory,'test-ledger');const reopenedData=await(await reopened.request('/api/ledger')).json();assert.equal(reopenedData.ledger.transactions[0].id,'local-first');assert.equal(reopenedData.owner,catalog.owner);
assert.equal((await(await reopened.request('/api/ledger?book='+book.id)).json()).ledger.digital.marketWatchlist[0].symbol,'BTC');
assert.deepEqual((await(await reopened.request('/api/ledger?book='+marketBookB.id)).json()).ledger.digital.marketWatchlist,[]);
const reopenedOldBox=(await(await reopened.request('/api/ledger?book='+legacyBoxBook.id)).json()).ledger.digital;
assert.deepEqual(marketWatchlist(reopenedOldBox),[]);
for(const field of ['assets','events','manualBalances','quotes'])assert.deepEqual(reopenedOldBox[field],oldBoxBackup.digital[field]);
const separate=createBrowserAPI(new IDBFactory(),'test-ledger');const separateData=await(await separate.request('/api/ledger')).json();assert.equal(separateData.ledger.transactions.length,0);assert.notEqual(separateData.owner,catalog.owner);
assert.equal(calls,0);assert.equal((await request('/api/ai/config','PUT',{apiKey:'synthetic-test-not-a-secret'})).status,405);assert.equal(calls,0);
const unavailable=createBrowserAPI(undefined,'disabled');assert.equal((await unavailable.request('/api/books')).status,503);
for(let n=1;n<50;n++)assert.equal((await separate.request('/api/books',{method:'POST',body:JSON.stringify({name:'账本'+n})})).status,201);
assert.equal((await separate.request('/api/books',{method:'POST',body:JSON.stringify({name:'超过上限'})})).status,400);
validate(sampleLedger());await reopened.close();await separate.close();await api.close();
console.log('PASS: IndexedDB persistence, browser isolation, atomic CAS across tabs, book isolation, validation rollback, original histories and 20-version retention, synthetic sample separation, zero financial network requests, no API-key storage, watchlist persistence/history/JSON restoration, removed BOX backup/holding preservation and book isolation');
