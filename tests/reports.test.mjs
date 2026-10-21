import assert from 'node:assert/strict';
import { initial, validate, nativeBalances } from '../lib/ledger.ts';
import { upsertTransaction } from '../lib/transactions.ts';
import { cashSummary, fixedReportRows, initialReportView, reportAnchorForMonth, reportRanges, reportRows, reportGroups, originalReportRows, reportPoints, fundReport, shiftReport, validReportDate } from '../lib/reports.ts';
const base = structuredClone(initial);
Object.assign(base.accounts.find(a => a.id === 'bank'), { opening: 1000000, openingHKD: 1000000, hkdToCNY: '0.9', hkdRateAt: '2026-10-20T00:00:00Z' });
base.accounts.push({ id: 'bank2', name: '另一银行', kind: 'asset', opening: 50000, hkdToCNY: '0.9', hkdRateAt: '2026-10-20T00:00:00Z' }, { id: 'hk', name: '证券账户', kind: 'asset', subtype: 'securities', opening: 0 });
base.hkSecurities = { accounts: [{ id: 'hk', openingCashHKD: '5000', hkdToCNY: '0.9', hkdToUSD: '0.128', ratesAt: '2026-10-20T00:00:00Z' }], events: [], quotes: [] };
const tx = (id, patch = {}) => ({ id, date: '2026-10-05', type: 'expense', amount: 8000, account: 'bank', to: '', category: 'c0', merchant: id, channel: '', note: '', status: 'posted', ...patch });
let l = { ...base, transactions: [
    tx('old', { date: '2026-09-28', category: 'c1', amount: 100000 }),
    tx('salary', { date: '2026-10-01', type: 'income', amount: 2000000, category: 'c10' }),
    tx('food', { tags: ['工作日', '餐饮'] }), tx('coffee', { amount: 3800, date: '2026-10-06' }),
    tx('refund', { date: '2026-10-12', type: 'refund', amount: 100000, category: 'c1', original: 'old' }),
    tx('dinner', { date: '2026-10-16', amount: 5000 }),
    tx('adjust', { date: '2026-10-19', type: 'adjustment', adjustmentSide: 'increase', amount: 1000 }),
    tx('pending', { amount: 99900, status: 'pending' }), tx('deleted', { status: 'deleted' }),
    tx('future', { date: '2026-10-31', type: 'income', amount: 1000000, category: 'c10' })
] };
l = upsertTransaction(l, tx('fx', { type: 'transfer', date: '2026-10-15', currency: 'CNY', to: 'bank2', amount: 90000, toCurrency: 'HKD', toAmount: 100000 }), 0);
l = upsertTransaction(l, tx('broker-in', { type: 'transfer', date: '2026-10-17', account: 'bank2', to: 'hk', currency: 'HKD', amount: 50000, toCurrency: 'HKD', toAmount: 50000 }), 0);
l = upsertTransaction(l, tx('broker-out', { type: 'transfer', date: '2026-10-18', account: 'hk', to: 'bank2', currency: 'HKD', amount: 10000, toCurrency: 'HKD', toAmount: 9900 }), 0);
l = upsertTransaction(l, tx('legacy', { date: '2026-10-20', type: 'transfer', to: 'wechat', amount: 10000, fee: 100 }), 100);
validate(l); const snapshot = structuredClone(l);
const view = { ...initialReportView(), anchor: '2026-10-21' };
assert.equal(reportAnchorForMonth(view, '2026-09', '2026-10-21'), '2026-09-01');
assert.equal(reportAnchorForMonth(view, '', '2026-10-21'), '2026-10-21');
assert.equal(reportAnchorForMonth(view, '2026-99', '2026-10-21'), '2026-10-21');
assert.equal(reportAnchorForMonth(view, '2026-10', '2026-10-21'), '2026-10-21');
const ranges = reportRanges('month', '2026-10-21', true, '2026-10-21');
assert.deepEqual(ranges.range, { start: '2026-10-01', end: '2026-10-21' });
assert.deepEqual(ranges.previous, { start: '2026-09-01', end: '2026-09-21' });
assert.deepEqual(ranges.yearAgo, { start: '2025-10-01', end: '2025-10-21' });
assert.equal(reportRanges('month', '2026-10-21', false, '2026-10-21').range.end, '2026-10-31');
assert.deepEqual(reportRanges('month', '2026-03-31', true, '2026-03-31').previous, { start: '2026-02-01', end: '2026-02-28' });
assert.equal(reportRanges('year', '2024-02-29', true, '2024-02-29').yearAgo.end, '2023-03-01'); // Equal elapsed days, explicitly labelled in the UI.
assert.equal(shiftReport('month', '2026-03-31', -1), '2026-02-28');
assert.equal(shiftReport('year', '2024-02-29', 1), '2025-02-28');
assert.equal(shiftReport('week', '2026-01-03', -1), '2025-12-27');
assert.equal(validReportDate(''), false); assert.equal(validReportDate('2026-02-30'), false); assert.equal(validReportDate('2024-02-29'), true);
const rows = reportRows(l, ranges.range), sum = cashSummary(rows);
assert.deepEqual(sum, { spending: 16900, refunds: 100000, netExpense: -83100, income: 2000000, balance: 2083100 });
assert.equal(rows.some(t => ['fx', 'pending', 'deleted', 'adjust', 'future', 'broker-in', 'legacy'].includes(t.id)), false);
const group = reportGroups(l, rows, 'category').find(g => g.key === 'c0');
assert.equal(group.amount, 16800); assert.deepEqual(group.rows.map(t => t.id), ['food', 'coffee', 'dinner']);
assert.equal(reportGroups(l, rows, 'account')[0].rows.some(t => t.type === 'transfer' || t.type === 'income'), false);
for (const dimension of ['category', 'merchant', 'account', 'channel', 'tags']) {
    for (const g of reportGroups(l, rows, dimension)) assert.equal(cashSummary(g.rows).netExpense, g.amount);
}
const duplicateName = { ...l, categories: [...l.categories, { id: 'other-food', name: '餐饮' }] };
assert.equal(reportGroups(duplicateName, [...rows, tx('same-name', { category: 'other-food' })], 'category').filter(g => g.label === '餐饮').length, 2);
assert.equal(reportGroups(l, [tx('duplicate-tags', { tags: ['A', 'A'] })], 'tags')[0].amount, 8000);
const fixedBook = { ...l, transactions: l.transactions.map(t => t.id === 'old' ? { ...t, tags: ['固定支出'] } : t) };
assert.equal(cashSummary(fixedReportRows(fixedBook, rows)).netExpense, -100000);
const points = reportPoints(rows, ranges.range, 'month');
assert.equal(reportPoints([], { start: '9999-12-31', end: '9999-12-31' }, 'day').length, 1);
assert.equal(reportPoints([], { start: '', end: '' }, 'month').length, 0);
assert.equal(points.length, 21); assert.equal(points.find(p => p.key === '2026-10-12').summary.netExpense, -100000);
assert.equal(points.find(p => p.key === '2026-10-15').rows.length, 0);
assert.equal(points.reduce((n, p) => n + p.summary.netExpense, 0), sum.netExpense);
assert.equal(reportPoints(reportRows(l, { start: '2026-01-01', end: '2026-12-31' }), { start: '2026-01-01', end: '2026-12-31' }, 'year').length, 12);
const retro = { ...l, preferences: { refundMode: 'original' } }, sept = reportRows(retro, { start: '2026-09-01', end: '2026-09-30' });
assert.equal(sept.find(t => t.id === 'refund').date, '2026-09-28');
assert.equal(originalReportRows(retro, sept).find(t => t.id === 'refund').date, '2026-10-12');
assert.equal(cashSummary(sept).netExpense, 0);
// Every currency's cash equation must reconcile with the existing balance engine, including prior history.
for (const range of [ranges.range, { start: '2026-10-16', end: '2026-10-18' }, { start: '2026-11-01', end: '2026-11-30' }]) {
    const end = nativeBalances({ ...l, transactions: l.transactions.filter(t => t.date <= range.end) });
    const start = nativeBalances({ ...l, transactions: l.transactions.filter(t => t.date < range.start) });
    for (const r of fundReport(l, range)) {
        assert.equal(r.opening, start[r.currency][r.account]);
        assert.equal(r.closing, end[r.currency][r.account]);
        assert.equal(r.closing, r.opening + r.inflow - r.outflow + r.adjustment);
    }
}
const flows = fundReport(l, ranges.range), hkd = flows.find(r => r.account === 'bank2' && r.currency === 'HKD');
assert.equal(hkd.inflow, 109900); assert.equal(hkd.outflow, 50000); assert.equal(hkd.closing, 59900);
assert.equal(flows.some(r => ['cmb', 'hk', 'huabei'].includes(r.account)), false);
assert.equal(flows.find(r => r.account === 'bank' && r.currency === 'CNY').adjustment, 1000);
assert.equal(fundReport(retro, ranges.range).find(r => r.account === 'bank' && r.currency === 'CNY').entries.find(e => e.id === 'refund').date, '2026-10-12');
// Legacy bank-linked digital/securities settlements still affect actual bank flow; broker-only trades do not.
const legacy = structuredClone(l);
legacy.digital = { wallets: [], assets: [], quotes: {}, events: [{ id: 'digital-buy', status: 'posted', type: 'buy', date: '2026-10-07', fiatAccount: 'bank', fiatCNY: 12300 }] };
legacy.hkSecurities.events = [
    { id: 'legacy-hkd', type: 'deposit', status: 'posted', date: '2026-10-09', account: 'hk', amountHKD: '500', fiatAccount: 'bank', fiatCurrency: 'HKD', fiatHKD: 50000 },
    { id: 'legacy-cny', type: 'withdrawal', status: 'posted', date: '2026-10-10', account: 'hk', amountHKD: '100', fiatAccount: 'bank', fiatCurrency: 'CNY', fiatCNY: 9000 },
    { id: 'broker-fee', type: 'fee', status: 'posted', date: '2026-10-11', account: 'hk', amountHKD: '10' }
];
const withLegacy = fundReport(legacy, ranges.range), legacyEnd = nativeBalances({ ...legacy, transactions: legacy.transactions.filter(t => t.date <= ranges.range.end) });
for (const r of withLegacy) assert.equal(r.closing, legacyEnd[r.currency][r.account]);
assert.equal(withLegacy.find(r => r.account === 'bank' && r.currency === 'HKD').outflow, 50000);
assert.deepEqual(l, snapshot);
console.log('PASS: synchronized report periods and comparable cutoffs, gross/refund/net totals, exact drilldown membership, duplicate names/tags, signed trends, original-date export, CNY/HKD cash reconciliation, broker linkage, adjustments, legacy settlements and immutability');
