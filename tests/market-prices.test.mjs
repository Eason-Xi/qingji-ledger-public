import assert from 'node:assert/strict';
import { createMarketPriceService, parseMarketPrices, withMarketPrices, MAX_PRICE_AGE, PRICE_URL, COINBASE_URL, MAIN_COINS, SUPPORTED_COINS } from '../lib/market-prices.ts';
import { digitalPositions } from '../lib/digital.ts';
import { MARKET_PRESETS } from '../lib/market-watchlist.ts';
const selection = [...MAIN_COINS];
const legacyBox = { symbol: 'BOX', name: 'BOX（李笑来）', priceId: '' };
const legacyBoxSource = 'BigONE BOX/USDT';
assert.deepEqual(SUPPORTED_COINS.map(c => c.symbol), ['BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'XRP', 'DOGE', 'USDC']);
assert.deepEqual(MAIN_COINS.map(c => c.symbol), ['BTC', 'ETH', 'USDT']);
const bnb = MARKET_PRESETS.find(c => c.symbol === 'BNB');
const legacyBNB = { symbol: 'BNB', name: 'BNB', priceId: 'bnb' };
const sol = { symbol: 'SOL', name: 'Solana', priceId: 'solana' };
const isPrimary = url => String(url).startsWith('https://api.coingecko.com/api/v3/simple/price?');
const requestedIDs = url => new URL(String(url)).searchParams.get('ids').split(',').sort();
let now = Date.now(), calls = 0, fail = false;
const fixture = () => Object.fromEntries([['bitcoin', 500000.12345678, 70000.12345678], ['ethereum', 20000, 2800], ['tether', 7.12345678, 0.99976543]].map(([id, cny, usd]) => [id, { cny, usd, cny_24h_change: -1.25, last_updated_at: Math.floor(now / 1000) }]));
const service = createMarketPriceService(async (url, init) => {
    if (url !== PRICE_URL) throw Error('Fallback source unavailable in cache test');
    assert.equal(init.body, undefined); calls++;
    if (fail) throw Error('Provider down');
    return Response.json(fixture());
}, () => now);
const [a, b] = await Promise.all([service(selection), service(selection)]);
assert.deepEqual(a, b); assert.equal(calls, 1); assert.equal(a.quotes.USDT.priceCNY, '7.12345678');
assert.equal(a.quotes.USDT.priceUSD, '0.99976543'); assert.equal(a.quotes.BTC.priceUSD, '70000.12345678');
assert.equal(a.quotes.BTC.change24h, -1.25); await service(selection); assert.equal(calls, 1);
now += 61000; await service(selection); assert.equal(calls, 2);
now += 61000; fail = true;
assert.equal((await service(selection)).stale, true); assert.equal(calls, 3);
await service(selection); assert.equal(calls, 3); // Retry backoff avoids hammering the provider.
now += MAX_PRICE_AGE;
await assert.rejects(service(selection), /暂时不可用/);
const empty = createMarketPriceService(async () => Response.json({ bitcoin: { cny: 0 } }), () => now);
await assert.rejects(empty(selection));
const limited = createMarketPriceService(async () => new Response('rate limit', { status: 429 }), () => now);
await assert.rejects(limited(selection));
const fallbackService = createMarketPriceService(async url => {
    if (url === PRICE_URL) return new Response('unavailable', { status: 403 });
    if (url === COINBASE_URL) return new Response('unavailable', { status: 503 });
    const symbol = url.includes('btc-bitcoin') ? 'BTC' : url.includes('eth-ethereum') ? 'ETH' : 'USDT';
    assert.ok(url.endsWith('?quotes=CNY,USD'));
    return Response.json({ symbol, last_updated: new Date(now).toISOString(), quotes: { CNY: { price: symbol === 'USDT' ? 7.12 : 10000, percent_change_24h: 0.1 }, USD: { price: symbol === 'USDT' ? 0.998 : 1400 } } });
}, () => now);
const backup = await fallbackService(selection);
assert.deepEqual(Object.keys(backup.quotes), ['BTC', 'ETH', 'USDT']);
assert.equal(backup.quotes.USDT.source, 'CoinPaprika'); assert.equal(backup.quotes.USDT.priceCNY, '7.12');
assert.equal(backup.quotes.USDT.priceUSD, '0.998');
const coinbaseService = createMarketPriceService(async url => url === COINBASE_URL ? Response.json({ data: { currency: 'USD', rates: { CNY: '7', BTC: '0.00001', ETH: '0.0005', USDT: '1.001' } } }) : new Response('limited', { status: 429 }), () => now);
const cross = await coinbaseService(selection);
assert.equal(cross.quotes.BTC.priceCNY, '700000'); assert.equal(cross.quotes.ETH.priceCNY, '14000');
assert.equal(cross.quotes.USDT.priceCNY, '6.99300699'); assert.equal(cross.quotes.USDT.source, 'Coinbase');
assert.equal(cross.quotes.BTC.priceUSD, '100000'); assert.equal(cross.quotes.ETH.priceUSD, '2000'); assert.equal(cross.quotes.USDT.priceUSD, '0.999001');
assert.equal(cross.quotes.USDT.change24h, null); assert.equal(cross.quotes.USDT.at, new Date(now).toISOString());
fail = false; now += 31000; assert.equal((await service(selection)).stale, false);
const malformed = fixture(); malformed.bitcoin.cny = -1; malformed.ethereum.last_updated_at = 1e300;
assert.deepEqual(Object.keys(parseMarketPrices(malformed, now).quotes), ['USDT']);
for (const badUSD of [undefined, 0, -1, Infinity, '1']) {
    const invalidUSD = fixture();
    for (const row of Object.values(invalidUSD)) row.usd = badUSD;
    assert.throws(() => parseMarketPrices(invalidUSD, now));
}
const old = fixture(); for (const row of Object.values(old)) row.last_updated_at -= 3600;
assert.throws(() => parseMarketPrices(old, now));
const book = { marketWatchlist: [MAIN_COINS[2]], wallets: [{ id: 'w', name: '我的资产', kind: 'wallet', network: '' }], assets: [{ id: 'u', symbol: 'USDT', name: '泰达币', priceId: '', network: '' }, { id: 'x', symbol: 'CUSTOM', name: '自定义', priceId: 'bitcoin', network: '' }], events: [], manualBalances: [{ id: 'w|u', wallet: 'w', asset: 'u', quantity: '100', updated: new Date(now).toISOString(), note: '' }], quotes: { u: { priceCNY: '6', source: '手动录入', at: new Date(now).toISOString() } } };
const snapshot = structuredClone(book), prices = parseMarketPrices(fixture(), now);
const priced = withMarketPrices(book, prices, now);
assert.equal(digitalPositions(priced, '').value, 71234); // integer fen, not a hardcoded USD peg
assert.equal(priced.quotes.x, undefined); assert.deepEqual(book, snapshot);
assert.equal(withMarketPrices(book, prices, now + MAX_PRICE_AGE + 1000).quotes.u.source, '手动录入');
assert.equal(withMarketPrices(book, null, now).quotes.u.priceCNY, '6');
const historical = structuredClone(book);
historical.quotes.u = { priceCNY: '7', source: 'CoinGecko', at: new Date(now - MAX_PRICE_AGE - 1000).toISOString() };
assert.equal(withMarketPrices(historical, null, now).quotes.u, undefined);
assert.equal(historical.quotes.u.priceCNY, '7');
console.log('PASS: dual USD/CNY quotes from all three sources, non-pegged USDT, invalid USD rejection, freshness, cache/backoff, precise CNY valuation and manual fallback without changing balances.');

// A removed built-in market must never fetch BigONE or an implicit USDT dependency.
let removedCalls = 0;
const removedMarket = createMarketPriceService(async () => { removedCalls++; throw Error('Removed BOX must not query a provider'); }, () => now);
assert.deepEqual((await removedMarket([legacyBox])).quotes, {});
assert.deepEqual((await removedMarket([legacyBox])).quotes, {});
assert.equal(removedCalls, 0);
const mixedURLs = [];
const withoutRemoved = createMarketPriceService(async url => {
    mixedURLs.push(String(url)); assert.ok(isPrimary(url));
    assert.deepEqual(requestedIDs(url), ['bitcoin']);
    return Response.json(fixture());
}, () => now);
assert.deepEqual(Object.keys((await withoutRemoved([MAIN_COINS[0], legacyBox])).quotes), ['BTC']);
assert.equal(mixedURLs.length, 1);

// A delayed old response cannot re-enable the removed BOX automatic valuation.
const boxBook = structuredClone(book);
boxBook.marketWatchlist.push(legacyBox);
boxBook.assets.push({ id: 'box', symbol: 'Box', name: 'BOX', priceId: '', network: '' });
boxBook.manualBalances.push({ id: 'w|box', wallet: 'w', asset: 'box', quantity: '10', updated: new Date(now).toISOString(), note: '' });
boxBook.quotes.box = { priceCNY: '50', source: '手动录入', at: new Date(now).toISOString() };
const boxSnapshot = structuredClone(boxBook);
const delayedLegacyPrices = { ...prices, quotes: { ...prices.quotes, BOX: { priceCNY: '59.64', priceUSD: '8.316', source: legacyBoxSource, at: new Date(now).toISOString(), change24h: null } } };
const retained = withMarketPrices(boxBook, delayedLegacyPrices, now);
assert.equal(retained.quotes.box.source, '手动录入');
assert.equal(retained.quotes.box.priceCNY, '50');
assert.deepEqual(retained.assets, boxBook.assets);
assert.deepEqual(retained.manualBalances, boxBook.manualBalances);
assert.deepEqual(retained.events, boxBook.events);
assert.deepEqual(boxBook, boxSnapshot);
const staleBox = structuredClone(boxBook);
staleBox.quotes.box = { priceCNY: '59.64', source: legacyBoxSource, at: new Date(now).toISOString() };
assert.equal(withMarketPrices(staleBox, delayedLegacyPrices, now).quotes.box, undefined);
assert.equal(staleBox.quotes.box.source, legacyBoxSource);
console.log('PASS: removed built-in BOX makes zero queries or USDT dependency requests, delayed automatic prices are ignored, manual references and holdings remain unchanged');

let releaseFirst, firstStarted=false;
const independent=createMarketPriceService(async url=>{
 if(url!==PRICE_URL)return new Response('unavailable',{status:503});
 if(!firstStarted){firstStarted=true;await new Promise(resolve=>{releaseFirst=resolve;});}
 return Response.json(fixture());
},()=>now,false);
const delayed=independent(selection);await Promise.resolve();
const independentResult=await independent(selection);assert.ok(independentResult.quotes.BTC);releaseFirst();await delayed;
console.log('PASS: independent Workers requests do not wait on another request owned I/O');


// Empty selections must not disclose any interest to public providers, even after cache population.
let emptyCalls = 0;
const idle = createMarketPriceService(async () => { emptyCalls++; throw Error('Unexpected network request'); }, () => now);
assert.deepEqual((await idle()).quotes, {});
assert.deepEqual((await idle([])).quotes, {});
assert.equal(emptyCalls, 0);
const callsBeforeEmpty = calls;
assert.deepEqual((await service([])).quotes, {});
assert.equal(calls, callsBeforeEmpty);

// A user-added CoinGecko ID is fetched explicitly and retains USD/CNY precision.
let customCalls = 0;
const customService = createMarketPriceService(async url => {
    customCalls++;
    assert.ok(isPrimary(url));
    assert.deepEqual(requestedIDs(url), ['solana']);
    return Response.json({ solana: { cny: 1000.12345678, usd: 140.87654321, cny_24h_change: 2.5, last_updated_at: now / 1000 } });
}, () => now);
const customPrices = await customService([sol]);
assert.deepEqual(Object.keys(customPrices.quotes), ['SOL']);
assert.equal(customPrices.quotes.SOL.priceCNY, '1000.12345678');
assert.equal(customPrices.quotes.SOL.priceUSD, '140.87654321');
await customService([sol]); assert.equal(customCalls, 1);
const parsedCustom = parseMarketPrices({ solana: { cny: 10.12345678, usd: 1.23456789, last_updated_at: now / 1000 } }, now, 'CoinGecko', [sol]);
assert.equal(parsedCustom.quotes.SOL.priceUSD, '1.23456789');
assert.equal(parsedCustom.quotes.BTC, undefined);

// BNB's website slug is not its API ID. Old saved aliases query the canonical identity.
let bnbPrimaryCalls = 0;
const bnbPrimary = createMarketPriceService(async url => {
    bnbPrimaryCalls++; assert.ok(isPrimary(url));
    assert.deepEqual(requestedIDs(url), ['binancecoin']);
    return Response.json({ binancecoin: { cny: 5000.12345678, usd: 750.87654321, cny_24h_change: 1.25, last_updated_at: now / 1000 } });
}, () => now);
const canonicalBNBPrices = await bnbPrimary([legacyBNB]);
assert.equal(canonicalBNBPrices.quotes.BNB.priceId, 'binancecoin');
assert.equal(canonicalBNBPrices.quotes.BNB.priceCNY, '5000.12345678');
assert.equal(canonicalBNBPrices.quotes.BNB.priceUSD, '750.87654321');
assert.equal(canonicalBNBPrices.quotes.BNB.change24h, 1.25);
assert.equal((await bnbPrimary([bnb])).quotes.BNB.priceId, 'binancecoin');
assert.equal(bnbPrimaryCalls, 1); // Canonical and legacy forms share a scoped cache entry.
assert.equal(legacyBNB.priceId, 'bnb');

// BNB has a verified independent dual-currency source when the primary source is unavailable.
const bnbFallbackURLs = [];
const bnbFallback = createMarketPriceService(async url => {
    bnbFallbackURLs.push(String(url));
    if (isPrimary(url) || url === COINBASE_URL) return new Response('unavailable', { status: 503 });
    assert.equal(String(url), 'https://api.coinpaprika.com/v1/tickers/bnb-binance-coin?quotes=CNY,USD');
    return Response.json({ id: 'bnb-binance-coin', symbol: 'BNB', last_updated: new Date(now).toISOString(), quotes: { CNY: { price: 4985.12345678, percent_change_24h: 2.5 }, USD: { price: 746.87654321 } } });
}, () => now);
const fallbackBNBPrices = await bnbFallback([legacyBNB]);
assert.equal(fallbackBNBPrices.quotes.BNB.priceCNY, '4985.12345678');
assert.equal(fallbackBNBPrices.quotes.BNB.priceUSD, '746.87654321');
assert.equal(fallbackBNBPrices.quotes.BNB.source, 'CoinPaprika');
assert.equal(fallbackBNBPrices.quotes.BNB.priceId, 'binancecoin');
assert.equal(bnbFallbackURLs.filter(url => url.includes('/tickers/')).length, 1);

// A historical custom BNB ID stays readable, but ticker alone never authorizes a fallback identity.
const customBNB = { symbol: 'BNB', name: 'User selected custom identity', priceId: 'another-bnb-token' };
const unrelatedBNB = { symbol: 'CUSTOM', name: 'User selected symbol', priceId: 'binancecoin' };
for (const coin of [customBNB, unrelatedBNB]) {
    const customBNBURLs = [];
    const customBNBService = createMarketPriceService(async url => {
        customBNBURLs.push(String(url)); assert.ok(isPrimary(url));
        assert.deepEqual(requestedIDs(url), [coin.priceId]);
        return Response.json({});
    }, () => now);
    await assert.rejects(customBNBService([coin]), /暂时不可用/);
    assert.equal(customBNBURLs.length, 1);
}

// A malformed fallback symbol cannot become a BNB price even at a trusted endpoint.
const wrongFallbackBNB = createMarketPriceService(async url => {
    if (isPrimary(url) || url === COINBASE_URL) return new Response('unavailable', { status: 503 });
    return Response.json({ symbol: 'OTHER', last_updated: new Date(now).toISOString(), quotes: { CNY: { price: 5000 }, USD: { price: 750 } } });
}, () => now);
await assert.rejects(wrongFallbackBNB([bnb]), /暂时不可用/);

// Editing a market ID cannot reuse prices cached under the old ID.
let changedBNBCalls = 0;
const changedBNB = createMarketPriceService(async url => {
    changedBNBCalls++; assert.ok(isPrimary(url));
    const [id] = requestedIDs(url);
    return Response.json({ [id]: { cny: id === 'binancecoin' ? 5000 : 10, usd: id === 'binancecoin' ? 750 : 1.5, last_updated_at: now / 1000 } });
}, () => now);
assert.equal((await changedBNB([customBNB])).quotes.BNB.priceCNY, '10');
assert.equal((await changedBNB([bnb])).quotes.BNB.priceCNY, '5000');
assert.equal(changedBNBCalls, 2);

// Different list requests and pending promises cannot return another list's results.
let scopedCalls = 0, releaseBTC;
const scopedService = createMarketPriceService(async url => {
    scopedCalls++;
    assert.ok(isPrimary(url));
    const ids = requestedIDs(url);
    if (ids.includes('bitcoin')) await new Promise(resolve => { releaseBTC = resolve; });
    return Response.json(fixture());
}, () => now);
const delayedBTC = scopedService([MAIN_COINS[0]]);
await Promise.resolve();
const ethOnly = await scopedService([MAIN_COINS[1]]);
assert.deepEqual(Object.keys(ethOnly.quotes), ['ETH']);
assert.equal(typeof releaseBTC, 'function'); releaseBTC();
assert.deepEqual(Object.keys((await delayedBTC).quotes), ['BTC']);
assert.deepEqual(Object.keys((await scopedService([MAIN_COINS[1]])).quotes), ['ETH']);
assert.equal(scopedCalls, 2);
assert.deepEqual((await scopedService([])).quotes, {}); assert.equal(scopedCalls, 2);

// List order does not force duplicate provider requests for the same set.
let orderedCalls = 0;
const ordered = createMarketPriceService(async url => { orderedCalls++; assert.ok(isPrimary(url)); return Response.json(fixture()); }, () => now);
await ordered([MAIN_COINS[0], MAIN_COINS[1]]);
await ordered([MAIN_COINS[1], MAIN_COINS[0]]);
assert.equal(orderedCalls, 1);

// BOX is not a reserved ticker for unrelated user-added CoinGecko assets.
const customBox = { symbol: 'BOX', name: 'User supplied token', priceId: 'custom-box-token' };
const customBoxService = createMarketPriceService(async url => {
    assert.ok(isPrimary(url)); assert.deepEqual(requestedIDs(url), ['custom-box-token']);
    return Response.json({ 'custom-box-token': { cny: 2.1, usd: 0.3, last_updated_at: now / 1000 } });
}, () => now);
const customBoxPrices = await customBoxService([customBox]);
assert.equal(customBoxPrices.quotes.BOX.priceCNY, '2.1');
assert.equal(customBoxPrices.quotes.BOX.priceUSD, '0.3');
assert.equal(customBoxPrices.quotes.BOX.priceId, 'custom-box-token');
assert.equal(customBoxPrices.quotes.BOX.source, 'CoinGecko');

// One unknown or unavailable custom ID does not prevent another selected coin's valid quote.
const partialService = createMarketPriceService(async url => isPrimary(url) ? Response.json(fixture()) : new Response('unavailable', { status: 503 }), () => now);
const partial = await partialService([MAIN_COINS[0], sol]);
assert.equal(partial.quotes.BTC.priceCNY, '500000.12345678');
assert.equal(partial.quotes.SOL, undefined); assert.equal(partial.quotes.ETH, undefined);

// A preset ticker cannot be redirected to another provider asset.
const guarded = createMarketPriceService(async () => { throw Error('Invalid selections must be rejected before network'); }, () => now);
await assert.rejects(guarded([{ symbol: 'BTC', name: 'Impostor', priceId: 'solana' }]));
console.log('PASS: empty lists make zero network calls, dynamic USD/CNY quotes, scoped pending/cache isolation, order-normalized cache, removed BOX compatibility, explicit custom IDs, partial availability and preset identity validation');

// Every seeded mainstream market uses its own verified identity and has both USD/CNY prices.
const mainstream = [
    { symbol: 'BTC', priceId: 'bitcoin', fallbackId: 'btc-bitcoin', cny: 500000.12345678, usd: 70000.12345678 },
    { symbol: 'ETH', priceId: 'ethereum', fallbackId: 'eth-ethereum', cny: 20000.12345678, usd: 2800.12345678 },
    { symbol: 'USDT', priceId: 'tether', fallbackId: 'usdt-tether', cny: 7.12345678, usd: 0.99976543 },
    { symbol: 'BNB', priceId: 'binancecoin', fallbackId: 'bnb-binance-coin', cny: 5000.12345678, usd: 750.12345678 },
    { symbol: 'SOL', priceId: 'solana', fallbackId: 'sol-solana', cny: 1000.12345678, usd: 140.12345678 },
    { symbol: 'XRP', priceId: 'ripple', fallbackId: 'xrp-xrp', cny: 20.12345678, usd: 2.12345678 },
    { symbol: 'DOGE', priceId: 'dogecoin', fallbackId: 'doge-dogecoin', cny: 1.12345678, usd: 0.12345678 },
    { symbol: 'USDC', priceId: 'usd-coin', fallbackId: 'usdc-usd-coin', cny: 7.12345678, usd: 1.00012345 },
];
assert.deepEqual(MARKET_PRESETS.map(({ symbol, priceId, fallbackId }) => ({ symbol, priceId, fallbackId })), mainstream.map(({ symbol, priceId, fallbackId }) => ({ symbol, priceId, fallbackId })));
const mainstreamSelection = MARKET_PRESETS.map(({ symbol, name, priceId }) => ({ symbol, name, priceId }));
const allPrimaryFixture = Object.fromEntries(mainstream.map(c => [c.priceId, { cny: c.cny, usd: c.usd, cny_24h_change: 0.25, last_updated_at: now / 1000 }]));
let allPrimaryCalls = 0;
const allPrimary = createMarketPriceService(async url => {
    allPrimaryCalls++; assert.ok(isPrimary(url));
    assert.deepEqual(requestedIDs(url), mainstream.map(c => c.priceId).sort());
    return Response.json(allPrimaryFixture);
}, () => now);
const allPrimaryQuotes = await allPrimary(mainstreamSelection);
assert.equal(allPrimaryCalls, 1);
assert.deepEqual(Object.keys(allPrimaryQuotes.quotes), mainstream.map(c => c.symbol));
for (const coin of mainstream) {
    assert.equal(allPrimaryQuotes.quotes[coin.symbol].priceId, coin.priceId);
    assert.equal(allPrimaryQuotes.quotes[coin.symbol].priceCNY, String(coin.cny));
    assert.equal(allPrimaryQuotes.quotes[coin.symbol].priceUSD, String(coin.usd));
}
const allCrossRates = { CNY: '7.25', BTC: '0.00001', ETH: '0.0005', USDT: '1.001', BNB: '0.00125', SOL: '0.00625', XRP: '0.4', DOGE: '8', USDC: '0.9999' };
const allCross = createMarketPriceService(async url => url === COINBASE_URL ? Response.json({ data: { currency: 'USD', rates: allCrossRates } }) : new Response('unavailable', { status: 503 }), () => now);
const allCrossQuotes = (await allCross(mainstreamSelection)).quotes;
for (const coin of mainstream) {
    assert.equal(allCrossQuotes[coin.symbol].source, 'Coinbase');
    assert.equal(allCrossQuotes[coin.symbol].priceId, coin.priceId);
    assert.ok(Number(allCrossQuotes[coin.symbol].priceUSD) > 0);
    assert.ok(Number(allCrossQuotes[coin.symbol].priceCNY) > 0);
    assert.ok(Math.abs(Number(allCrossQuotes[coin.symbol].priceCNY) / Number(allCrossQuotes[coin.symbol].priceUSD) - 7.25) < 0.000001);
}
const allFallbackIDs = [];
const allFallback = createMarketPriceService(async url => {
    if (isPrimary(url) || url === COINBASE_URL) return new Response('unavailable', { status: 503 });
    const parsed = new URL(String(url)), id = parsed.pathname.split('/').pop();
    assert.equal(parsed.origin, 'https://api.coinpaprika.com');
    assert.equal(parsed.searchParams.get('quotes'), 'CNY,USD');
    const coin = mainstream.find(c => c.fallbackId === id); assert.ok(coin, 'Unexpected fallback identity: ' + id);
    allFallbackIDs.push(id);
    return Response.json({ id, symbol: coin.symbol, last_updated: new Date(now).toISOString(), quotes: { CNY: { price: coin.cny }, USD: { price: coin.usd } } });
}, () => now);
const allFallbackQuotes = (await allFallback(mainstreamSelection)).quotes;
assert.deepEqual(allFallbackIDs.sort(), mainstream.map(c => c.fallbackId).sort());
for (const coin of mainstream) {
    assert.equal(allFallbackQuotes[coin.symbol].source, 'CoinPaprika');
    assert.equal(allFallbackQuotes[coin.symbol].priceId, coin.priceId);
    assert.equal(allFallbackQuotes[coin.symbol].priceCNY, String(coin.cny));
    assert.equal(allFallbackQuotes[coin.symbol].priceUSD, String(coin.usd));
}
for (const symbol of ['SOL', 'XRP', 'DOGE', 'USDC']) {
    const coin = { symbol, name: 'Historical custom ' + symbol, priceId: 'saved-' + symbol.toLowerCase() };
    const identityURLs = [];
    const customIdentity = createMarketPriceService(async url => {
        identityURLs.push(String(url)); assert.ok(isPrimary(url));
        assert.deepEqual(requestedIDs(url), [coin.priceId]);
        return Response.json({});
    }, () => now);
    await assert.rejects(customIdentity([coin]), /暂时不可用/);
    assert.equal(identityURLs.length, 1); // Preset ticker alone cannot redirect a saved custom identity.
}
console.log('PASS: all eight default markets have explicit provider identities, dual-currency primary/Coinbase/CoinPaprika fixtures and no ticker-only custom fallback');
