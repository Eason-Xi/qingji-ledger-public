import assert from 'node:assert/strict';
import {appendDraftBatch,appendSpokenText,remainingUnparsedText} from '../lib/draft-queue.ts';
import {initial,parseText,balances,totals} from '../lib/ledger.ts';
import {approveDrafts} from '../lib/transactions.ts';
const ledger=structuredClone(initial);ledger.preferences={autoPost:true};
let queue=[];
for(let i=1;i<=15;i++){
 const parsed=parseText(`第${String.fromCharCode(64+i)}家店消费 ${i+10}`,{...ledger,transactions:[...ledger.transactions,...queue]});
 assert.equal(parsed.rows.length,1);queue=appendDraftBatch(queue,parsed.rows);
 if(i===1)queue=[{...queue[0],amount:4321,merchant:'用户核对后修改',account:'bank'}];
}
assert.equal(queue.length,15);assert.equal(queue[0].merchant,'用户核对后修改');assert.equal(queue[0].amount,4321);assert.equal(queue[0].account,'bank');
assert.equal(ledger.transactions.length,0);assert.deepEqual(totals(ledger.transactions),{income:0,expense:0});
const snapshot=structuredClone(queue);
const replay=appendDraftBatch(queue,[{...queue[0],amount:1}]);assert.deepEqual(replay,queue);assert.deepEqual(queue,snapshot);
const without=queue.filter(t=>t.id!==queue[3].id);const appended=appendDraftBatch(without,parseText('现金早餐 50',ledger).rows);assert.equal(appended.length,15);assert.ok(!appended.some(t=>t.id===queue[3].id));assert.equal(appended[0].amount,4321);
const result=approveDrafts(ledger,appended);assert.equal(result.count,15);assert.equal(result.ledger.transactions.length,15);assert.equal(balances(result.ledger).bank,-4321);assert.deepEqual(queue,snapshot);
assert.throws(()=>approveDrafts(result.ledger,appended),/已保存/);
const oneUtterance=Array.from({length:15},(_,i)=>`午饭 ${i+1}`).join('；');assert.equal(parseText(oneUtterance,ledger).rows.length,15);
let spoken='早餐 18';spoken=appendSpokenText(spoken,'午饭 35');spoken=appendSpokenText(spoken,'晚饭 42');assert.equal(spoken,'早餐 18\n午饭 35\n晚饭 42');assert.equal(parseText(spoken,ledger).rows.length,3);assert.equal(appendSpokenText(spoken,'  '),spoken);
const duplicate=parseText('现金早餐 50',{...ledger,transactions:appended});assert.ok(duplicate.warnings.some(w=>w.includes('同日')));
console.log('PASS: 15 recognition batches accumulate, user corrections survive, replay does not overwrite, removal preserves others, final posting once, 15-item dictation, voice input append and duplicate warnings');

assert.equal(remainingUnparsedText('早餐 18','早餐 18'),'');
assert.equal(remainingUnparsedText('早餐 18\n午饭 35','早餐 18'),'午饭 35');
assert.equal(remainingUnparsedText('早餐 18；午饭 35','早餐 18'),'午饭 35');
assert.equal(remainingUnparsedText('早餐 19','早餐 18'),'早餐 19');
console.log('PASS: new dictation or edits arriving during recognition survive without replaying the consumed input');
