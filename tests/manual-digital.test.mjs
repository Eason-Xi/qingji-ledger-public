import assert from 'node:assert/strict';
import { initial, balances, totals, validate } from '../lib/ledger.ts';
import { digitalPositions, setDigitalBalance } from '../lib/digital.ts';
import { mergeLedgers } from '../lib/merge.ts';

const at = '2026-10-19T05:30:00.000Z';
const book = {
  wallets: [{ id: 'a', name: '我的资产', kind: 'wallet', network: '' }, { id: 'b', name: '长期持有', kind: 'wallet', network: '' }],
  assets: [{ id: 'btc', symbol: 'BTC', name: '比特币', network: '', priceId: '' }, { id: 'eth', symbol: 'ETH', name: '以太坊', network: '', priceId: '' }, { id: 'custom', symbol: '积分', name: '自定义积分', network: '', priceId: '' }],
  events: [
    { id: 'old-buy', type: 'buy', date: '2026-10-01', created: '2026-10-01T12:00:00Z', wallet: 'a', asset: 'btc', quantity: '2', fiatCNY: 10000, fiatAccount: 'bank', txHash: '', note: '历史买入', status: 'posted' },
    { id: 'old-transfer', type: 'transfer', date: '2026-10-02', created: '2026-10-02T12:00:00Z', wallet: 'a', toWallet: 'b', asset: 'btc', quantity: '0.5', fiatCNY: 0, txHash: '', note: '', status: 'posted' },
  ],
  quotes: { btc: { priceCNY: '200', source: '手动录入', at }, eth: { priceCNY: '10000', source: '手动录入', at } },
};
const ledger = { ...structuredClone(initial), digital: book, preferences: { costMethod: 'average' } };
validate(ledger);
const oldValue = digitalPositions(book, 'average').value;
assert.equal(oldValue, 40000);
let manual = setDigitalBalance(book, 'a', 'btc', '0.2500', '  数量自行填写  ', at);
assert.equal(book.manualBalances, undefined);
assert.equal(manual.manualBalances[0].quantity, '0.25');
assert.equal(manual.manualBalances[0].note, '数量自行填写');
let result = digitalPositions(manual, 'average');
assert.equal(result.positions.find(p => p.wallet === 'a').quantity, '0.25');
assert.equal(result.positions.find(p => p.wallet === 'b').quantity, '0.5');
assert.equal(result.value, 15000); // Manual 0.25 replaces historical 1.5; the other account is retained.
assert.equal(result.cost, null);
assert.equal(result.positions.find(p => p.wallet === 'a').unrealized, null);
assert.deepEqual(balances({ ...ledger, digital: manual }), balances(ledger));
assert.deepEqual(totals(ledger.transactions), { income: 0, expense: 0 });
assert.deepEqual(manual.events, book.events);

manual = setDigitalBalance(manual, 'a', 'btc', '1.000000000000000001', '', at);
manual = setDigitalBalance(manual, 'a', 'eth', '0.000000000000000001', '', at);
manual = setDigitalBalance(manual, 'a', 'custom', '12.34567890123456789', '', at);
assert.equal(manual.manualBalances.length, 3);
result = digitalPositions(manual, '');
assert.equal(result.positions.find(p => p.asset === 'btc' && p.wallet === 'a').quantity, '1.000000000000000001');
assert.equal(result.positions.find(p => p.asset === 'eth').quantity, '0.000000000000000001');
assert.equal(result.missing, 1);
assert.equal(result.positions.find(p => p.asset === 'custom').value, null);
validate({ ...ledger, digital: manual });
const order = manual.manualBalances.map(b => b.id);
manual = setDigitalBalance(manual, 'a', 'custom', '0', '', at);
assert.deepEqual(manual.manualBalances.map(b => b.id), order);
result = digitalPositions(manual, 'average');
assert.equal(result.missing, 0); // Zero without a price is zero, not an incomplete valuation.
assert.equal(result.positions.find(p => p.asset === 'custom').quantity, '0');
assert.equal(result.positions.find(p => p.asset === 'custom').value, 0);
const backup = JSON.parse(JSON.stringify({ ...ledger, digital: manual }));
validate(backup);
assert.deepEqual(backup.digital.manualBalances, manual.manualBalances);

for (const quantity of ['-1', '1e3', '1.0000000000000000001', '', 2])
  assert.throws(() => setDigitalBalance(book, 'a', 'btc', quantity, '', at));
assert.throws(() => setDigitalBalance(book, 'missing', 'btc', '1', '', at));
assert.throws(() => setDigitalBalance(book, 'a', 'missing', '1', '', at));
assert.throws(() => setDigitalBalance(book, 'a', 'btc', '1', '', 'invalid'));
const invalid = structuredClone(backup);
invalid.digital.manualBalances.push({ ...invalid.digital.manualBalances[0] });
assert.throws(() => validate(invalid), /不能重复/);
invalid.digital.manualBalances.pop();
invalid.digital.manualBalances[0].id = 'wrong';
assert.throws(() => validate(invalid), /余额字段无效/);

const base = { ...ledger, digital: setDigitalBalance(book, 'a', 'btc', '1', '', at) };
const local = { ...base, digital: setDigitalBalance(base.digital, 'a', 'btc', '2', '本机', at) };
const remote = { ...base, digital: setDigitalBalance(base.digital, 'a', 'btc', '3', '云端', at) };
const conflict = mergeLedgers(base, local, remote);
assert.equal(conflict.conflicts.length, 1);
assert.equal(conflict.conflicts[0].path, '账本/digital/manualBalances/a|btc');
assert.equal(mergeLedgers(base, local, remote, { [conflict.conflicts[0].path]: 'local' }).ledger.digital.manualBalances[0].quantity, '2');
const firstLocal = { ...ledger, digital: setDigitalBalance(book, 'a', 'btc', '2', '', at) };
const firstRemote = { ...ledger, digital: setDigitalBalance(book, 'a', 'btc', '3', '', at) };
assert.equal(mergeLedgers(ledger, firstLocal, firstRemote).conflicts.length, 1);
const other = { ...base, digital: setDigitalBalance(base.digital, 'b', 'eth', '4', '', at) };
const merged = mergeLedgers(base, local, other);
assert.equal(merged.conflicts.length, 0);
validate(merged.ledger);
assert.equal(merged.ledger.digital.manualBalances.length, 2);
console.log('PASS: manual balances, 18-digit precision, zeroing, legacy override without double counting, incomplete estimates, unchanged fiat balances, backup round-trip, validation and concurrent-edit conflicts');
