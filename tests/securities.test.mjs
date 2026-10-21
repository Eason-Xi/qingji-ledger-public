import assert from 'node:assert/strict';
import { initial, balances, totals, validate, accountType, parseText } from '../lib/ledger.ts';
import { updateSecuritiesValue } from '../lib/securities.ts';
import { transactionPostings } from '../lib/transactions.ts';
import { mergeLedgers } from '../lib/merge.ts';

const account = { id: 'broker', name: '我的证券账户', kind: 'asset', subtype: 'securities', opening: 1000000, active: true };
const base = { ...structuredClone(initial), accounts: [...structuredClone(initial.accounts), account] };
base.accounts.find(a => a.id === 'bank').opening = 2000000;
validate(initial); // Existing backups without subtypes remain valid.
validate(base);
assert.equal(accountType(account), 'securities');
assert.equal(accountType(initial.accounts.find(a => a.id === 'bank')), 'asset');
assert.throws(() => validate({ ...base, accounts: [...initial.accounts, { ...account, kind: 'debt' }] }), /证券账户/);
assert.throws(() => validate({ ...base, accounts: [...initial.accounts, { ...account, subtype: 'unknown' }] }), /证券账户/);

const transfer = { id: 'deposit', type: 'transfer', amount: 500000, date: '2026-10-19', account: 'bank', to: 'broker', channel: '', category: 'c9', merchant: '银证转账', note: '', status: 'posted' };
const deposited = { ...base, transactions: [transfer] };
validate(deposited);
assert.equal(balances(deposited).bank, 1500000);
assert.equal(balances(deposited).broker, 1500000);
assert.deepEqual(totals(deposited.transactions), { income: 0, expense: 0 });
assert.equal(parseText('银行卡转 100 到我的证券账户', base).rows[0].to, 'broker');

const gain = updateSecuritiesValue(deposited, 'broker', '15300.29', '2026-10-19');
assert.equal(balances(gain).broker, 1530029);
assert.equal(balances(gain).bank, 1500000);
assert.equal(gain.accounts.at(-1).opening, 1000000);
assert.deepEqual(gain.transactions[0], transfer);
assert.equal(gain.transactions.at(-1).type, 'adjustment');
assert.equal(gain.transactions.at(-1).amount, 30029);
assert.equal(gain.transactions.at(-1).adjustmentSide, 'increase');
assert.deepEqual(totals(gain.transactions), { income: 0, expense: 0 });
const net = l => l.accounts.reduce((sum, a) => sum + (a.kind === 'asset' ? balances(l)[a.id] : -balances(l)[a.id]), 0);
assert.equal(net(gain), net(deposited) + 30029);
assert.strictEqual(updateSecuritiesValue(gain, 'broker', '15300.29'), gain);
const loss = updateSecuritiesValue(gain, 'broker', '14000.01');
assert.equal(loss.transactions.at(-1).amount, 130028);
assert.equal(loss.transactions.at(-1).adjustmentSide, 'decrease');
assert.equal(balances(loss).broker, 1400001);
const empty = updateSecuritiesValue(loss, 'broker', '0');
assert.equal(balances(empty).broker, 0);
assert.deepEqual(totals(empty.transactions), { income: 0, expense: 0 });
for (const transaction of loss.transactions) {
    const postings = transactionPostings(loss).filter(p => p.transaction === transaction.id);
    assert.equal(postings.reduce((sum, p) => sum + (p.direction === 'debit' ? p.amount : -p.amount), 0), 0);
}
for (const invalid of ['-1', '12.345', '1e4', '', 'Infinity', '10000000001'])
    assert.throws(() => updateSecuritiesValue(base, 'broker', invalid));
assert.throws(() => updateSecuritiesValue(base, 'bank', '1'), /证券账户/);
assert.throws(() => updateSecuritiesValue(base, 'missing', '1'), /证券账户/);
assert.throws(() => updateSecuritiesValue({ ...base, accounts: [...initial.accounts, { ...account, active: false }] }, 'broker', '1'), /证券账户/);
assert.throws(() => updateSecuritiesValue(base, 'broker', '1', '2026-02-30'), /日期/);

const restored = JSON.parse(JSON.stringify(loss));
validate(restored);
assert.equal(accountType(restored.accounts.at(-1)), 'securities');
assert.equal(balances(restored).broker, 1400001);
const renamed = { ...base, accounts: base.accounts.map(a => a.id === 'bank' ? { ...a, name: '备用银行卡' } : a) };
const merged = mergeLedgers(base, loss, renamed);
assert.equal(merged.conflicts.length, 0);
assert.equal(balances(merged.ledger).broker, 1400001);
assert.equal(merged.ledger.accounts.find(a => a.id === 'bank').name, '备用银行卡');
console.log('PASS: securities account validation, legacy backups, bank transfers, exact CNY valuation adjustments, balanced postings, zero balance, invalid input, backup and device merge');
