import assert from 'node:assert/strict';
import {initial,validate,balances,totals} from '../lib/ledger.ts';
import {guessMapping,buildImport,parseImportDate,parseCSV,toCSV,rollbackBatch} from '../lib/importer.ts';
import {splitExpense,bulkUpdate} from '../lib/transactions.ts';
import {readWorkbook} from '../lib/workbooks.ts';
import * as XLSX from 'xlsx';
const headers=['日期','收支类型','金额','资金账户','转入账户','分类','商户','外部流水号','币种'];
const raw=[headers,['2026/10/1','支出','￥1,250.29','旧信用卡','','旧餐饮','超市','one','CNY'],['2026-10-02','内部转账','100','旧银行卡','旧微信','其他','钱包充值','two','CNY'],['2026-10-03','信用卡还款','80','旧银行卡','旧信用卡','其他','还卡','three','CNY']];
const ledger=structuredClone(initial);
const options={mapping:guessMapping(headers),accounts:{旧信用卡:'cmb',旧银行卡:'bank',旧微信:'wechat'},categories:{旧餐饮:'c0',其他:'c9'},fallbackType:'',duplicate:'skip',dateOrder:'ymd',batch:'batch-a',fileHash:'hash-a',sheet:'账单',headerRow:0};
let r=buildImport(raw,ledger,options);assert.deepEqual(r.counts,{ready:3,duplicate:0,error:0});assert.equal(r.expense,125029);assert.equal(r.income,0);let l={...ledger,transactions:r.transactions};validate(l);assert.equal(balances(l).cmb,117029);assert.equal(balances(l).wechat,10000);assert.equal(totals(l.transactions).expense,125029);
r=buildImport(raw,l,options);assert.deepEqual(r.counts,{ready:0,duplicate:3,error:0});
assert.equal(buildImport(raw,l,{...options,categories:{旧餐饮:'c1',其他:'c9'}}).counts.duplicate,3);
r=buildImport(raw,l,{...options,duplicate:'keep'});assert.equal(r.counts.ready,3);
const same=structuredClone(raw);same[1][2]='1500';r=buildImport(same,l,options);assert.equal(r.counts.error,1);assert.match(r.rows[0].reason,/同一外部流水号/);
r=buildImport([headers,...raw.slice(1),raw[1]],ledger,options);assert.equal(r.counts.duplicate,1);
r=buildImport([headers,['2026-02-30','支出','-10','旧信用卡','','旧餐饮','bad','','CNY'],['2026-10-01','收入','-10','旧信用卡','','旧餐饮','bad','','CNY'],['2026-10-01','退款','10','旧信用卡','','旧餐饮','bad','','CNY'],['2026-10-01','支出','10','未知账户','','旧餐饮','bad','','CNY'],['2026-10-01','支出','10','旧信用卡','','未知分类','bad','','CNY'],['2026-10-01','支出','10','旧信用卡','','旧餐饮','bad','','USD']],ledger,options);assert.equal(r.counts.error,6);assert.equal(r.counts.ready,0);
assert.equal(parseImportDate('2026年10月9日'),'2026-10-09');assert.equal(parseImportDate('09/10/2026','dmy'),'2026-10-09');assert.throws(()=>parseImportDate('09/10/2026'));assert.equal(parseImportDate('45292'),'2024-01-01');assert.throws(()=>parseImportDate('2026-02-29'));assert.equal(parseImportDate('2024-02-29'),'2024-02-29');
const splitRaw=[['日期','收入金额','支出金额','资金账户','分类'],['2026-10-01','2000','0','旧银行卡','其他'],['2026-10-02','','10','旧银行卡','其他'],['2026-10-03','10','20','旧银行卡','其他']];r=buildImport(splitRaw,ledger,{...options,mapping:guessMapping(splitRaw[0])});assert.deepEqual(r.counts,{ready:2,duplicate:0,error:1});assert.equal(r.income,200000);assert.equal(r.expense,1000);
const parsed=parseCSV('日期,备注,金额\r\n2026-10-01,"a,b\n他说""你好""",30\r\n');assert.equal(parsed[1][1],'a,b\n他说"你好"');assert.throws(()=>parseCSV('a,b\n"broken'));assert.match(toCSV([['=SUM(1,2)']]),/'=/);
const pending={...l.transactions[2],id:'pending',status:'pending',to:''};validate({...l,transactions:[pending]});
const split=splitExpense(l,l.transactions[0].id,[{amount:'250.29',category:'c0',merchant:'食品'},{amount:'1000',category:'c1',merchant:'购物'}]);assert.equal(totals(split.transactions).expense,125029);assert.deepEqual(balances(split),balances(l));assert.throws(()=>bulkUpdate(split,new Set([l.transactions[0].id]),{status:'posted'}));assert.throws(()=>splitExpense(l,l.transactions[0].id,[{amount:'250',category:'c0',merchant:'食品'},{amount:'1000',category:'c1',merchant:'购物'}]));
const rolled=rollbackBatch(l,'batch-a');assert.equal(totals(rolled.transactions).expense,0);assert.equal(balances(rolled).cmb,0);
const tagged=bulkUpdate(l,new Set([l.transactions[0].id]),{tags:['旅行','购物'],category:'c1'});assert.deepEqual(tagged.transactions[0].tags,['旅行','购物']);assert.equal(totals(tagged.transactions).expense,125029);
// Actual workbook binaries: multi-sheet XLSX and legacy XLS.
for(const bookType of ['xlsx','biff8']){
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['说明'],['这是测试工作表']]),'说明');const ws=XLSX.utils.aoa_to_sheet(raw);XLSX.utils.book_append_sheet(wb,ws,'流水');const buf=XLSX.write(wb,{type:'array',bookType});const file=new File([buf],'fixture.'+(bookType==='xlsx'?'xlsx':'xls'));const read=await readWorkbook(file);assert.equal(read.sheets.length,2);assert.equal(read.sheets[1].name,'流水');const imported=buildImport(read.sheets[1].rows,ledger,options);assert.equal(imported.counts.ready,3);
}
const dates=XLSX.utils.book_new();XLSX.utils.book_append_sheet(dates,XLSX.utils.aoa_to_sheet([['日期'],[new Date(2026,9,1)]]),'日期');const read=await readWorkbook(new File([XLSX.write(dates,{type:'array',bookType:'xlsx'})],'dates.xlsx'));assert.equal(read.sheets[0].rows[1][0],'2026-10-01');
const times=XLSX.utils.book_new(),tw=XLSX.utils.aoa_to_sheet([['日期时间','时间'],[46296.5,0.5]]);tw.A2.z='yyyy-mm-dd hh:mm';tw.B2.z='hh:mm';XLSX.utils.book_append_sheet(times,tw,'时间');const timeRead=await readWorkbook(new File([XLSX.write(times,{type:'array',bookType:'xlsx'})],'times.xlsx'));assert.match(timeRead.sheets[0].rows[1][0],/^\d{4}-\d{2}-\d{2} 12:00$/);assert.equal(timeRead.sheets[0].rows[1][1],'12:00');
console.log('PASS: XLS/XLSX binary import, sheet selection, dates, currencies, account/category mapping, duplicates, external ID conflict, income/expense columns, invalid rows, CSV quoting, split conservation, batch rollback, bulk tags, restore protection');
