import assert from 'node:assert/strict';
import { MARKET_PRESETS, validateMarketWatchlist, marketWatchlist, addMarketCoin, removeMarketCoin } from '../lib/market-watchlist.ts';
import { withMarketPrices, parseMarketPrices, MAX_PRICE_AGE } from '../lib/market-prices.ts';
import { emptyDigital, digitalPositions, valuation, units } from '../lib/digital.ts';
import { initial, validate } from '../lib/ledger.ts';

const preset = symbol => { const { name, priceId } = MARKET_PRESETS.find(c => c.symbol === symbol); return { symbol, name, priceId }; };
const btc = preset('BTC');
const usdt = preset('USDT');
const legacyBox = { symbol: 'BOX', name: 'BOX（李笑来）', priceId: '' };
const customBox = { symbol: 'BOX', name: 'User supplied token', priceId: 'custom-box-token' };
const sol = { symbol: 'SOL', name: 'Solana', priceId: 'solana' };
assert.deepEqual(MARKET_PRESETS.map(c => c.symbol), ['BTC', 'ETH', 'USDT']);
assert.deepEqual(marketWatchlist(emptyDigital()), []);
assert.deepEqual(marketWatchlist({ ...emptyDigital(), marketWatchlist: [] }), []);
validateMarketWatchlist([]);
validateMarketWatchlist([btc, sol, legacyBox]); // Compatibility permits opening old backups.
validateMarketWatchlist([customBox]);
assert.deepEqual(marketWatchlist({ ...emptyDigital(), marketWatchlist: [btc, legacyBox, sol] }), [btc, sol]);

for (const value of [null, {}, 'BTC', [null], [{ ...sol, symbol: '' }], [{ ...sol, name: '' }], [{ ...sol, priceId: '' }], [{ ...sol, priceId: 'https://example.invalid/solana' }], [{ ...sol, priceId: 'solana?x=1' }], [{ ...sol, symbol: 'X'.repeat(31) }], [{ ...sol, name: 'x'.repeat(201) }], [{ ...sol, priceId: 'x'.repeat(101) }], [sol, { ...sol }], [{ ...btc, priceId: 'solana' }], [{ ...legacyBox, priceId: 'invalid/id' }]]) {
    assert.throws(() => validateMarketWatchlist(value), `Accepted invalid watchlist: ${JSON.stringify(value)}`);
}
const capacity = Array.from({ length: 50 }, (_, n) => ({ symbol: 'T' + n, name: 'Test ' + n, priceId: 'test-' + n }));
validateMarketWatchlist(capacity);
assert.throws(() => validateMarketWatchlist([...capacity, { symbol: 'OVER', name: 'Over capacity', priceId: 'over' }]));

const untouched = emptyDigital(), original = structuredClone(untouched);
const added = addMarketCoin(untouched, btc);
assert.deepEqual(untouched, original);
assert.deepEqual(marketWatchlist(added), [btc]);
const withSol = addMarketCoin(added, sol);
assert.deepEqual(marketWatchlist(withSol), [btc, sol]);
assert.deepEqual(marketWatchlist(added), [btc]);
assert.throws(() => addMarketCoin(withSol, btc));
assert.throws(() => addMarketCoin(withSol, legacyBox));
assert.deepEqual(marketWatchlist(addMarketCoin(untouched, customBox)), [customBox]);
const removed = removeMarketCoin(withSol, 'BTC');
assert.deepEqual(marketWatchlist(removed), [sol]);
assert.deepEqual(marketWatchlist(withSol), [btc, sol]);
assert.deepEqual(marketWatchlist(removeMarketCoin(removed, 'SOL')), []);

const now = Date.now();
const book = {
    wallets: [{ id: 'w', name: 'Synthetic wallet', kind: 'wallet', network: '' }],
    assets: [{ id: 'u', symbol: 'USDT', name: 'USDT', priceId: '', network: '' }, { id: 's', symbol: 'SOL', name: 'Solana', priceId: '', network: '' }],
    events: [],
    manualBalances: [
        { id: 'w|u', wallet: 'w', asset: 'u', quantity: '100.123456789012345678', updated: new Date(now).toISOString(), note: 'Synthetic fixture' },
        { id: 'w|s', wallet: 'w', asset: 's', quantity: '2.123456789012345678', updated: new Date(now).toISOString(), note: 'Synthetic fixture' },
    ],
    quotes: { u: { priceCNY: '6.12345678', source: '手动录入', at: new Date(now).toISOString() } },
    marketWatchlist: [usdt, sol],
};
const prices = parseMarketPrices({ tether: { cny: 7.12345678, usd: 0.99976543, last_updated_at: now / 1000 }, solana: { cny: 1000.12345678, usd: 140.87654321, last_updated_at: now / 1000 } }, now, 'CoinGecko', book.marketWatchlist);
const snapshot = structuredClone(book), priced = withMarketPrices(book, prices, now);
assert.equal(priced.quotes.u.priceCNY, '7.12345678');
assert.equal(priced.quotes.s.priceCNY, '1000.12345678');
assert.equal(digitalPositions(priced, '').value, valuation(units(book.manualBalances[0].quantity), '7.12345678') + valuation(units(book.manualBalances[1].quantity), '1000.12345678'));
assert.deepEqual(book, snapshot);

// Removing a quote changes only valuation preference, never the holdings or saved manual price.
const withoutUSDT = removeMarketCoin(book, 'USDT');
const afterRemoval = withMarketPrices(withoutUSDT, prices, now);
assert.equal(afterRemoval.quotes.u.priceCNY, '6.12345678');
assert.equal(afterRemoval.quotes.u.source, '手动录入');
assert.deepEqual(withoutUSDT.assets, book.assets);
assert.deepEqual(withoutUSDT.manualBalances, book.manualBalances);
assert.deepEqual(withoutUSDT.events, book.events);
const withoutAny = removeMarketCoin(withoutUSDT, 'SOL');
assert.equal(withMarketPrices(withoutAny, prices, now).quotes.s, undefined);
assert.equal(digitalPositions(withMarketPrices(withoutAny, prices, now), '').missing, 1);
assert.equal(withMarketPrices(book, prices, now + MAX_PRICE_AGE + 1).quotes.u.source, '手动录入');
assert.equal(withMarketPrices(book, prices, now + MAX_PRICE_AGE + 1).quotes.s, undefined);

// Legacy automatic quotes are not a hidden opt-in; valid saved manual prices remain available.
const legacy = structuredClone(book); delete legacy.marketWatchlist;
legacy.quotes.s = { priceCNY: '999', source: 'CoinGecko', at: new Date(now).toISOString() };
const legacyResult = withMarketPrices(legacy, prices, now);
assert.equal(legacyResult.quotes.s, undefined);
assert.equal(legacyResult.quotes.u.priceCNY, '6.12345678');
assert.equal(legacy.quotes.s.priceCNY, '999');

// Full backup JSON carries the watchlist, while an old backup with no list stays valid and empty.
const ledger = { ...structuredClone(initial), digital: book };
validate(ledger);
const restored = JSON.parse(JSON.stringify({ version: 4, ledger })).ledger;
validate(restored); assert.deepEqual(marketWatchlist(restored.digital), [usdt, sol]);
assert.deepEqual(restored.digital.manualBalances, book.manualBalances);
const oldBackup = structuredClone(ledger); delete oldBackup.digital.marketWatchlist;
validate(oldBackup); assert.deepEqual(marketWatchlist(oldBackup.digital), []);
const invalidBackup = structuredClone(ledger); invalidBackup.digital.marketWatchlist = [{ ...btc, priceId: 'solana' }];
assert.throws(() => validate(invalidBackup));
// Previously saved BOX assets, balances and transactions remain accessible without that market.
const boxBackup = structuredClone(ledger);
boxBackup.digital.marketWatchlist.push(legacyBox);
boxBackup.digital.assets.push({ id: 'box', symbol: 'BOX', name: 'BOX', priceId: '', network: '' });
boxBackup.digital.manualBalances.push({ id: 'w|box', wallet: 'w', asset: 'box', quantity: '3.123456789012345678', updated: new Date(now).toISOString(), note: 'Saved holding' });
boxBackup.digital.events.push({ id: 'box-opening', type: 'opening', date: new Date(now).toISOString().slice(0, 10), created: new Date(now).toISOString(), wallet: 'w', asset: 'box', quantity: '2', fiatCNY: 12000, txHash: '', note: 'Saved transaction', status: 'posted' });
boxBackup.digital.quotes.box = { priceCNY: '50', source: '手动录入', at: new Date(now).toISOString() };
const restoredBox = JSON.parse(JSON.stringify({ version: 4, ledger: boxBackup })).ledger;
assert.doesNotThrow(() => validate(restoredBox));
assert.deepEqual(marketWatchlist(restoredBox.digital), [usdt, sol]);
const compatibleBox = withMarketPrices(restoredBox.digital, prices, now);
assert.deepEqual(compatibleBox.assets, boxBackup.digital.assets);
assert.deepEqual(compatibleBox.events, boxBackup.digital.events);
assert.deepEqual(compatibleBox.manualBalances, boxBackup.digital.manualBalances);
assert.equal(compatibleBox.quotes.box.priceCNY, '50');
assert.equal(digitalPositions(compatibleBox, '').positions.find(p => p.asset === 'box').quantity, '3.123456789012345678');
assert.throws(() => addMarketCoin(restoredBox.digital, legacyBox));
const editedLegacy = addMarketCoin(restoredBox.digital, btc);
assert.deepEqual(marketWatchlist(editedLegacy), [usdt, sol, btc]);
validate({ ...restoredBox, digital: editedLegacy });

console.log('PASS: optional per-book watchlists, bounded and validated identities, immutable add/remove, precise valuations, manual fallback, missing quote accounting, legacy automatic quote removal, removed BOX holdings preservation and full JSON backup compatibility');

// A legal large balance with no manual price must not make the app unusable when live prices arrive.
const safetyPrices = parseMarketPrices({
    bitcoin: { cny: 600000, usd: 84000, last_updated_at: now / 1000 },
    solana: { cny: 1000, usd: 140, last_updated_at: now / 1000 },
}, now, 'CoinGecko', [btc, sol]);
const safetyBook = {
    wallets: [{ id: 'w', name: 'Synthetic wallet', kind: 'wallet', network: '' }],
    assets: [{ id: 'b', symbol: 'BTC', name: 'Bitcoin', priceId: '', network: '' }],
    events: [], quotes: {}, marketWatchlist: [btc],
    manualBalances: [{ id: 'w|b', wallet: 'w', asset: 'b', quantity: '1000000000', updated: new Date(now).toISOString(), note: 'Overflow regression fixture' }],
};
validate({ ...structuredClone(initial), digital: safetyBook });
const safetySnapshot = structuredClone(safetyBook);
const safePriced = withMarketPrices(safetyBook, safetyPrices, now);
let safeSummary;
assert.doesNotThrow(() => { safeSummary = digitalPositions(safePriced, ''); });
assert.equal(safePriced.quotes.b, undefined);
assert.equal(safeSummary.value, 0); assert.equal(safeSummary.missing, 1);
assert.deepEqual(safetyBook, safetySnapshot);
const withManualSafety = structuredClone(safetyBook);
withManualSafety.quotes.b = { priceCNY: '1', source: '手动录入', at: new Date(now).toISOString() };
const manualSafetyResult = withMarketPrices(withManualSafety, safetyPrices, now);
assert.equal(manualSafetyResult.quotes.b.source, '手动录入');
assert.equal(digitalPositions(manualSafetyResult, '').value, 100000000000);

// Individually safe automatic values can still exceed the aggregate limit; preserve safe manual fallback.
const aggregateBook = structuredClone(withManualSafety);
aggregateBook.assets.push({ id: 's', symbol: 'SOL', name: 'Solana', priceId: '', network: '' });
aggregateBook.marketWatchlist.push(sol);
aggregateBook.manualBalances[0].quantity = '100000000';
aggregateBook.manualBalances.push({ id: 'w|s', wallet: 'w', asset: 's', quantity: '60000000000', updated: new Date(now).toISOString(), note: 'Aggregate overflow fixture' });
aggregateBook.quotes.s = { priceCNY: '1', source: '手动录入', at: new Date(now).toISOString() };
validate({ ...structuredClone(initial), digital: aggregateBook });
const aggregateSnapshot = structuredClone(aggregateBook);
const aggregatePriced = withMarketPrices(aggregateBook, safetyPrices, now);
let aggregateSummary;
assert.doesNotThrow(() => { aggregateSummary = digitalPositions(aggregatePriced, ''); });
assert.ok(Number.isSafeInteger(aggregateSummary.value));
assert.equal(aggregateSummary.missing, 0);
assert.ok(Object.values(aggregatePriced.quotes).some(q => q.source === '手动录入'));
assert.ok(Object.values(aggregatePriced.quotes).some(q => q.source === 'CoinGecko'));
assert.deepEqual(aggregateBook, aggregateSnapshot);
const aggregateWithoutManual = structuredClone(aggregateBook); aggregateWithoutManual.quotes = {};
const aggregateMissing = digitalPositions(withMarketPrices(aggregateWithoutManual, safetyPrices, now), '');
assert.equal(aggregateMissing.missing, 1);
assert.equal(aggregateMissing.value, 6000000000000000);

// Multiple wallet positions in one asset must also be included in the aggregate safety check.
const multiWallet = structuredClone(withManualSafety);
multiWallet.wallets.push({ id: 'other', name: 'Other synthetic wallet', kind: 'wallet', network: '' });
multiWallet.manualBalances[0].quantity = '100000000';
multiWallet.manualBalances.push({ id: 'other|b', wallet: 'other', asset: 'b', quantity: '100000000', updated: new Date(now).toISOString(), note: 'Same-asset aggregate fixture' });
const multiWalletResult = withMarketPrices(multiWallet, safetyPrices, now);
assert.equal(multiWalletResult.quotes.b.source, '手动录入');
assert.equal(digitalPositions(multiWalletResult, '').value, 20000000000);
console.log('PASS: oversized live valuation remains editable, manual fallback survives, aggregate overflow across assets and wallets never crashes or loses balances');
