import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createBrowserAPI } from '../lib/browser-api.ts';
import { sampleLedger } from '../lib/sample-ledger.ts';
import { balances, nativeBalances, validate } from '../lib/ledger.ts';
import { emptyDigital, digitalPositions } from '../lib/digital.ts';
import { hkPortfolio } from '../lib/hk-securities.ts';
import { moduleEnabled, setModuleEnabled, modulePageEnabled, homeMarketSelection } from '../lib/optional-modules.ts';

const now = '2026-10-21T00:00:00Z';
const legacy = sampleLedger();
legacy.preferences = { cloudAI: false, retainInput: false, refundMode: 'original', costMethod: 'average' };
legacy.hkSecurities.events.push({ id: 'synthetic-hk-buy', account: 'example-broker', type: 'buy', symbol: '00700', name: 'Synthetic holding', quantity: 10, priceHKD: '10', feesHKD: '0', amountHKD: '', date: legacy.transactions[0].date, time: '10:00', created: now, note: 'Synthetic module fixture', status: 'posted' });
legacy.hkSecurities.quotes.push({ id: '00700', priceHKD: '12', date: legacy.transactions[0].date });
legacy.digital = {
    ...emptyDigital(), marketDefaultsVersion: 1,
    wallets: [{ id: 'synthetic-wallet', name: 'Synthetic wallet', kind: 'wallet', network: '' }],
    assets: [{ id: 'synthetic-bnb', symbol: ' bnb ', name: 'Synthetic BNB holding', priceId: '', network: '' }],
    events: [{ id: 'synthetic-digital-buy', type: 'buy', date: legacy.transactions[0].date, created: now, wallet: 'synthetic-wallet', asset: 'synthetic-bnb', quantity: '2', fiatCNY: 20000, fiatAccount: 'bank', txHash: '', note: 'Synthetic module fixture', status: 'posted' }],
    manualBalances: [{ id: 'synthetic-wallet|synthetic-bnb', wallet: 'synthetic-wallet', asset: 'synthetic-bnb', quantity: '3.123456789012345678', updated: now, note: 'Saved manual holding' }],
    quotes: { 'synthetic-bnb': { priceCNY: '42', source: '手动录入', at: now } },
    marketWatchlist: [{ symbol: 'BNB', name: 'Saved legacy BNB', priceId: 'bnb' }, { symbol: 'BTC', name: 'Bitcoin', priceId: 'bitcoin' }],
};
validate(legacy);
const original = structuredClone(legacy);
const financialState = ledger => {
    const { preferences, ...financial } = ledger;
    return financial;
};
const assertFinancialData = ledger => {
    assert.deepEqual(financialState(ledger), financialState(original));
    assert.deepEqual(nativeBalances(ledger), nativeBalances(original));
    assert.deepEqual(balances(ledger), balances(original));
    assert.deepEqual(digitalPositions(ledger.digital, 'average'), digitalPositions(original.digital, 'average'));
    assert.deepEqual(hkPortfolio(ledger.hkSecurities, ledger.transactions), hkPortfolio(original.hkSecurities, original.transactions));
};

// Old/new books do not opt into investment modules merely because saved holdings exist.
for (const module of ['digital', 'securities']) assert.equal(moduleEnabled(legacy, module), false);
assert.equal(modulePageEnabled(legacy, 4), false);
assert.equal(modulePageEnabled(legacy, 5), false);
for (const page of [0, 1, 2, 3, 6]) assert.equal(modulePageEnabled(legacy, page), true);
assert.deepEqual(homeMarketSelection(legacy), []);

const digitalOnly = setModuleEnabled(legacy, 'digital', true);
assert.equal(moduleEnabled(digitalOnly, 'digital'), true);
assert.equal(moduleEnabled(digitalOnly, 'securities'), false);
assert.equal(modulePageEnabled(digitalOnly, 4), true);
assert.equal(modulePageEnabled(digitalOnly, 5), false);
assert.deepEqual(homeMarketSelection(digitalOnly), [{ symbol: 'BNB', name: 'Saved legacy BNB', priceId: 'binancecoin' }]);
assertFinancialData(digitalOnly);
assert.deepEqual(legacy, original);
assert.equal(digitalOnly.preferences.retainInput, false);
assert.equal(digitalOnly.preferences.refundMode, 'original');
assert.equal(digitalOnly.preferences.costMethod, 'average');

const both = setModuleEnabled(digitalOnly, 'securities', true);
assert.equal(moduleEnabled(both, 'digital'), true);
assert.equal(moduleEnabled(both, 'securities'), true);
const securitiesOnly = setModuleEnabled(both, 'digital', false);
assert.equal(moduleEnabled(securitiesOnly, 'digital'), false);
assert.equal(moduleEnabled(securitiesOnly, 'securities'), true);
assert.deepEqual(homeMarketSelection(securitiesOnly), []);
const hidden = setModuleEnabled(securitiesOnly, 'securities', false);
assert.equal(moduleEnabled(hidden, 'digital'), false);
assert.equal(moduleEnabled(hidden, 'securities'), false);
for (const ledger of [both, securitiesOnly, hidden]) { validate(ledger); assertFinancialData(ledger); }
assert.deepEqual(legacy, original);

// Preference flags must remain booleans when users import or restore a backup.
for (const key of ['digitalEnabled', 'securitiesEnabled']) {
    for (const value of [null, 0, 1, 'true', 'false', {}, []]) assert.throws(() => validate({ ...legacy, preferences: { ...legacy.preferences, [key]: value } }), `Accepted ${key}=${JSON.stringify(value)}`);
}

const factory = new IDBFactory();
let networkCalls = 0;
const noNetwork = async () => { networkCalls++; throw Error('Module switches must not call public market providers'); };
let api = createBrowserAPI(factory, 'optional-module-preferences', noNetwork);
const request = async (path, method = 'GET', body) => {
    const response = await api.request(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
};
assert.equal((await request('/api/ledger')).data.revision, 0);
assert.equal((await request('/api/ledger', 'PUT', { ledger: digitalOnly, revision: 0, action: 'Enable digital module' })).status, 200);
const otherBook = (await request('/api/books', 'POST', { name: 'Independent investment settings' })).data.book;
const otherPath = '/api/ledger?book=' + otherBook.id;
const newBook = (await request(otherPath)).data;
assert.equal(moduleEnabled(newBook.ledger, 'digital'), false);
assert.equal(moduleEnabled(newBook.ledger, 'securities'), false);
assert.equal((await request(otherPath, 'PUT', { ledger: securitiesOnly, revision: 0, action: 'Enable securities in separate book' })).status, 200);

await api.close();
api = createBrowserAPI(factory, 'optional-module-preferences', noNetwork);
const savedA = (await request('/api/ledger')).data;
const savedB = (await request(otherPath)).data;
assert.equal(moduleEnabled(savedA.ledger, 'digital'), true);
assert.equal(moduleEnabled(savedA.ledger, 'securities'), false);
assert.equal(moduleEnabled(savedB.ledger, 'digital'), false);
assert.equal(moduleEnabled(savedB.ledger, 'securities'), true);
assertFinancialData(savedA.ledger);
assertFinancialData(savedB.ledger);

const backup = JSON.parse(JSON.stringify({ version: 4, ledger: savedA.ledger }));
validate(backup.ledger);
assert.equal((await request('/api/ledger', 'PUT', { ledger: hidden, revision: 1, action: 'Hide both modules' })).status, 200);
assert.equal((await request(otherPath, 'PUT', { ledger: backup.ledger, revision: 1, action: 'Restore module choices from backup' })).status, 200);
const restored = (await request(otherPath)).data.ledger;
assert.equal(moduleEnabled(restored, 'digital'), true);
assert.equal(moduleEnabled(restored, 'securities'), false);
assertFinancialData(restored);
assert.equal(moduleEnabled((await request('/api/ledger')).data.ledger, 'digital'), false);

// An old backup without either flag remains hidden after restore and does not lose holdings.
assert.equal((await request('/api/ledger', 'PUT', { ledger: original, revision: 2, action: 'Restore old backup without module flags' })).status, 200);
const oldRestored = (await request('/api/ledger')).data;
assert.equal(moduleEnabled(oldRestored.ledger, 'digital'), false);
assert.equal(moduleEnabled(oldRestored.ledger, 'securities'), false);
assertFinancialData(oldRestored.ledger);
for (const key of ['digitalEnabled', 'securitiesEnabled']) {
    for (const value of [null, 1, 'true']) {
        const rejected = await request('/api/ledger', 'PUT', { ledger: { ...original, preferences: { ...original.preferences, [key]: value } }, revision: 3 });
        assert.equal(rejected.status, 400);
    }
}
assert.equal((await request('/api/ledger')).data.revision, 3);
assertFinancialData((await request('/api/ledger')).data.ledger);
assert.equal(networkCalls, 0);
assert.deepEqual(legacy, original);
await api.close();
console.log('PASS: investment modules default hidden, toggle independently without changing holdings/bank funds, gate pages and home quotes, persist per book, survive backup/legacy restore, and reject invalid flags');
