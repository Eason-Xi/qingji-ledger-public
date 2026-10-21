import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createBrowserAPI } from '../lib/browser-api.ts';
import { initial, validate } from '../lib/ledger.ts';
import { emptyDigital } from '../lib/digital.ts';
import { DEFAULT_MARKET_COINS, marketWatchlist, removeMarketCoin } from '../lib/market-watchlist.ts';

const now = '2026-10-21T00:00:00Z';
const factory = new IDBFactory(), databaseName = 'old-schema-market-defaults';
const oldLedger = {
    ...structuredClone(initial),
    transactions: [{ id: 'old-cash-expense', date: '2026-10-21', type: 'expense', amount: 3200, account: 'bank', to: '', category: 'c0', merchant: 'Synthetic saved lunch', channel: '', note: 'Migration fixture', status: 'posted' }],
    digital: {
        ...emptyDigital(),
        wallets: [{ id: 'saved-wallet', name: 'Synthetic saved wallet', kind: 'wallet', network: '' }],
        assets: [{ id: 'saved-bnb', symbol: 'BNB', name: 'Synthetic BNB holding', priceId: '', network: '' }],
        events: [{ id: 'saved-opening', type: 'opening', date: '2026-10-21', created: now, wallet: 'saved-wallet', asset: 'saved-bnb', quantity: '2', fiatCNY: 10000, txHash: '', note: 'Synthetic saved event', status: 'posted' }],
        manualBalances: [{ id: 'saved-wallet|saved-bnb', wallet: 'saved-wallet', asset: 'saved-bnb', quantity: '3.123456789012345678', updated: now, note: 'Synthetic saved balance' }],
        quotes: { 'saved-bnb': { priceCNY: '42', source: '手动录入', at: now } },
        marketWatchlist: [{ symbol: 'BNB', name: 'Saved custom BNB', priceId: 'another-bnb-token' }, { symbol: 'SOL', name: 'Saved custom Solana', priceId: 'saved-sol-token' }, { symbol: 'CUSTOMBTC', name: 'Saved Bitcoin reference', priceId: 'bitcoin' }],
    },
};
validate(oldLedger);
const oldSnapshot = structuredClone(oldLedger);
const noHistory = structuredClone(initial);
const alreadyChosen = { ...structuredClone(initial), digital: { ...emptyDigital(), marketWatchlist: [], marketDefaultsVersion: 1 } };
const capacity = Array.from({ length: 50 }, (_, i) => ({ symbol: 'CUSTOM' + i, name: 'Saved custom ' + i, priceId: 'saved-custom-' + i }));
const fullLedger = { ...structuredClone(initial), digital: { ...emptyDigital(), marketWatchlist: capacity } };
const aliasCollisionLedger = structuredClone(oldLedger);
aliasCollisionLedger.digital.marketWatchlist = [{ symbol: 'BNB', name: 'Saved legacy BNB', priceId: 'bnb' }, { symbol: 'OTHER', name: 'Saved custom BNB reference', priceId: 'binancecoin' }];
validate(aliasCollisionLedger); // These distinct raw IDs were legal before BNB alias normalization.
const aliasCollisionSnapshot = structuredClone(aliasCollisionLedger);
const books = [
    { id: 'default', name: '个人账本', revision: 25, ledger: oldLedger },
    { id: 'old-no-history', name: '原无历史账本', revision: 0, ledger: noHistory },
    { id: 'already-chosen', name: '已自选清空', revision: 3, ledger: alreadyChosen },
    { id: 'full-watchlist', name: '已满行情', revision: 4, ledger: fullLedger },
    { id: 'old-alias-collision', name: '旧BNB双记录', revision: 2, ledger: aliasCollisionLedger },
];

// Populate the actual pre-release schema directly; the new API's PUT already stamps version 1.
await new Promise((resolve, reject) => {
    const open = factory.open(databaseName, 1);
    open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('books', { keyPath: 'id' });
        db.createObjectStore('ledgers', { keyPath: 'bookId' });
        db.createObjectStore('meta', { keyPath: 'id' });
        db.createObjectStore('history', { keyPath: ['bookId', 'id'] }).createIndex('book', 'bookId');
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
        const db = open.result, tx = db.transaction(['books', 'ledgers', 'meta', 'history'], 'readwrite');
        tx.objectStore('meta').put({ id: 'owner', value: 'browser-existing-owner' });
        for (const { id, name, revision, ledger } of books) {
            tx.objectStore('books').put({ id, name, created: now, updated: now });
            tx.objectStore('ledgers').put({ bookId: id, ledger, revision, updated: now });
        }
        for (let revision = 1; revision <= 25; revision++) tx.objectStore('history').put({ bookId: 'default', id: 'original-' + revision, ledger: oldLedger, revision, updated: now, created: now, action: 'Original saved version ' + revision });
        tx.objectStore('history').put({ bookId: 'already-chosen', id: 'chosen-original', ledger: alreadyChosen, revision: 3, updated: now, created: now, action: 'User removed all markets' });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    };
});
let networkCalls = 0;
const noNetwork = async () => { networkCalls++; throw Error('Financial migration must not use a provider'); };
const firstAPI = createBrowserAPI(factory, databaseName, noNetwork);
const secondAPI = createBrowserAPI(factory, databaseName, noNetwork);
const json = async (api, path, method = 'GET', body) => {
    const r = await api.request(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() };
};
const [first, concurrent] = await Promise.all([json(firstAPI, '/api/ledger'), json(secondAPI, '/api/ledger')]);
assert.equal(first.status, 200); assert.equal(concurrent.status, 200);
assert.equal(first.data.revision, 26); assert.equal(concurrent.data.revision, 26);
assert.deepEqual(concurrent.data.ledger, first.data.ledger); // Only one migration across concurrent openers.
await assert.rejects(new Promise((resolve, reject) => {
    const oldBundle = factory.open(databaseName, 1);
    oldBundle.onerror = () => reject(oldBundle.error);
    oldBundle.onsuccess = () => { oldBundle.result.close(); resolve(); };
}), { name: 'VersionError' }); // Pre-deployment bundles cannot reopen the upgraded database for writes.
assert.equal(first.data.owner, 'browser-existing-owner');
assert.equal(first.data.ledger.digital.marketDefaultsVersion, 1);
assert.deepEqual(marketWatchlist(first.data.ledger.digital).slice(0, 3), oldLedger.digital.marketWatchlist);
assert.equal(marketWatchlist(first.data.ledger.digital).some(c => c.symbol === 'BTC'), false);
for (const coin of DEFAULT_MARKET_COINS.filter(c => !['BTC', 'BNB', 'SOL'].includes(c.symbol))) assert.ok(marketWatchlist(first.data.ledger.digital).some(c => c.symbol === coin.symbol && c.priceId === coin.priceId));
const { digital: migratedDigital, ...migratedFinance } = first.data.ledger;
const { digital: oldDigital, ...oldFinance } = oldLedger;
assert.deepEqual(migratedFinance, oldFinance);
for (const field of ['wallets', 'assets', 'events', 'manualBalances', 'quotes']) assert.deepEqual(migratedDigital[field], oldDigital[field]);
assert.deepEqual(oldLedger, oldSnapshot);
validate(first.data.ledger);

const migratedHistory = (await json(firstAPI, '/api/history')).data.history;
assert.equal(migratedHistory.length, 20);
assert.deepEqual(migratedHistory.map(h => h.revision), Array.from({ length: 20 }, (_, i) => 26 - i));
assert.equal(migratedHistory.filter(h => h.revision === 25).length, 1); // Existing original snapshots are not duplicated.
const originalHistory = (await json(firstAPI, '/api/history?id=original-25')).data;
assert.deepEqual(originalHistory.ledger, oldLedger);
assert.equal(originalHistory.action, 'Original saved version 25');
const postMigrationHistory = (await json(firstAPI, '/api/history?id=' + migratedHistory[0].id)).data;
assert.deepEqual(postMigrationHistory.ledger, first.data.ledger);

const emptyMigrated = (await json(firstAPI, '/api/ledger?book=old-no-history')).data;
assert.equal(emptyMigrated.revision, 1);
assert.deepEqual(marketWatchlist(emptyMigrated.ledger.digital), DEFAULT_MARKET_COINS);
const newHistory = (await json(firstAPI, '/api/history?book=old-no-history')).data.history;
assert.deepEqual(newHistory.map(h => h.revision), [1, 0]);
assert.deepEqual((await json(firstAPI, '/api/history?book=old-no-history&id=' + newHistory[1].id)).data.ledger, noHistory); // Pre-migration revision 0 remains recoverable.
const chosen = (await json(firstAPI, '/api/ledger?book=already-chosen')).data;
assert.equal(chosen.revision, 3); assert.deepEqual(chosen.ledger, alreadyChosen);
assert.equal((await json(firstAPI, '/api/history?book=already-chosen')).data.history.length, 1);
const full = (await json(firstAPI, '/api/ledger?book=full-watchlist')).data;
assert.equal(full.revision, 5); assert.equal(full.ledger.digital.marketDefaultsVersion, 1);
assert.deepEqual(full.ledger.digital.marketWatchlist, capacity);

// Canonicalizing an old alias must not make a once-valid book block every book's startup.
const migratedCollision = await json(firstAPI, '/api/ledger?book=old-alias-collision');
assert.equal(migratedCollision.status, 200); assert.equal(migratedCollision.data.revision, 3);
assert.equal(migratedCollision.data.ledger.digital.marketDefaultsVersion, 1);
assert.deepEqual(migratedCollision.data.ledger.digital.marketWatchlist.slice(0, 2), aliasCollisionLedger.digital.marketWatchlist);
assert.equal(marketWatchlist(migratedCollision.data.ledger.digital)[0].priceId, 'binancecoin');
assert.deepEqual(migratedCollision.data.ledger.transactions, aliasCollisionLedger.transactions);
for (const field of ['wallets', 'assets', 'events', 'manualBalances', 'quotes']) assert.deepEqual(migratedCollision.data.ledger.digital[field], aliasCollisionLedger.digital[field]);
assert.deepEqual(aliasCollisionLedger, aliasCollisionSnapshot);
assert.equal((await json(firstAPI, '/api/ledger?book=old-no-history')).status, 200); // Other books remain accessible after this migration.
const collisionHistory = (await json(firstAPI, '/api/history?book=old-alias-collision')).data.history;
assert.deepEqual(collisionHistory.map(h => h.revision), [3, 2]);
assert.deepEqual((await json(firstAPI, '/api/history?book=old-alias-collision&id=' + collisionHistory[1].id)).data.ledger, aliasCollisionLedger);
const rejectedStale = await json(secondAPI, '/api/ledger', 'PUT', { ledger: oldLedger, revision: 25 });
assert.equal(rejectedStale.status, 409); assert.equal(rejectedStale.data.revision, 26);
assert.deepEqual(rejectedStale.data.ledger, first.data.ledger);

const removed = { ...first.data.ledger, digital: removeMarketCoin(removeMarketCoin(first.data.ledger.digital, 'BNB'), 'SOL') };
assert.equal((await json(firstAPI, '/api/ledger', 'PUT', { ledger: removed, revision: 26, action: 'User removes seeded and saved markets' })).status, 200);
await firstAPI.close(); await secondAPI.close();
const reopened = createBrowserAPI(factory, databaseName, noNetwork);
const afterRemoval = (await json(reopened, '/api/ledger')).data;
assert.equal(afterRemoval.revision, 27);
const reopenedCollision = await json(reopened, '/api/ledger?book=old-alias-collision');
assert.equal(reopenedCollision.status, 200); assert.equal(reopenedCollision.data.revision, 3);
assert.deepEqual(reopenedCollision.data.ledger, migratedCollision.data.ledger);
assert.equal(afterRemoval.ledger.digital.marketDefaultsVersion, 1);
assert.equal(marketWatchlist(afterRemoval.ledger.digital).some(c => c.symbol === 'BNB' || c.symbol === 'SOL'), false);

// An explicit restore keeps its exact watchlist; missing old metadata does not opt into reseeding.
const oldEmptyBackup = { ...structuredClone(initial), digital: { ...emptyDigital(), marketWatchlist: [] } };
assert.equal((await json(reopened, '/api/ledger', 'PUT', { ledger: oldEmptyBackup, revision: 27, action: 'Restore old backup with empty markets' })).status, 200);
assert.equal(oldEmptyBackup.digital.marketDefaultsVersion, undefined); // Input backup is immutable.
await reopened.close();
const afterBackupAPI = createBrowserAPI(factory, databaseName, noNetwork);
const afterBackup = (await json(afterBackupAPI, '/api/ledger')).data;
assert.equal(afterBackup.revision, 28); assert.equal(afterBackup.ledger.digital.marketDefaultsVersion, 1);
assert.deepEqual(marketWatchlist(afterBackup.ledger.digital), []);
assert.equal((await json(afterBackupAPI, '/api/ledger', 'PUT', { ledger: originalHistory.ledger, revision: 28, action: 'Restore pre-migration history' })).status, 200);
await afterBackupAPI.close();
const finalAPI = createBrowserAPI(factory, databaseName, noNetwork);
const restoredHistory = (await json(finalAPI, '/api/ledger')).data;
assert.equal(restoredHistory.revision, 29); assert.equal(restoredHistory.ledger.digital.marketDefaultsVersion, 1);
assert.deepEqual(marketWatchlist(restoredHistory.ledger.digital), oldLedger.digital.marketWatchlist);
for (const field of ['wallets', 'assets', 'events', 'manualBalances', 'quotes']) assert.deepEqual(restoredHistory.ledger.digital[field], oldDigital[field]);
assert.equal((await json(finalAPI, '/api/history')).data.history.length, 20);
assert.equal(networkCalls, 0);
await finalAPI.close();
console.log('PASS: real old-schema migration is atomic and one-time across tabs, preserves funds and both history boundaries, caps snapshots/watchlists, rejects stale writes and honors removals and old backup/history restoration');
