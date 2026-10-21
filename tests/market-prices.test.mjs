import assert from 'node:assert/strict';
import { createMarketPriceService, parseMarketPrices, withMarketPrices, MAX_PRICE_AGE, PRICE_URL, COINBASE_URL, MAIN_COINS, SUPPORTED_COINS } from '../lib/market-prices.ts';
import { digitalPositions } from '../lib/digital.ts';
const selection = [...MAIN_COINS];
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

const { parseBoxQuote, BOX_SOURCE, BOX_TICKER_URL, BOX_TRADES_URL } = await import('../lib/box-price.ts');
const boxTicker = {code:0,data:{asset_pair_name:'BOX-USDT',close:'8.4'}};
const boxTrades = {code:0,data:[{price:'8.4',created_at:new Date(now-1800000).toISOString()}]};
const usdtQuote = {priceUSD:'0.99',priceCNY:'7.1',source:'fixture',at:new Date(now).toISOString(),change24h:null};
const boxQuote = parseBoxQuote(boxTicker,boxTrades,usdtQuote,now);
assert.equal(boxQuote.priceUSD,'8.31600000');assert.equal(boxQuote.priceCNY,'59.64000000');assert.equal(boxQuote.tradeAt,boxTrades.data[0].created_at);assert.equal(boxQuote.change24h,null);
assert.throws(()=>parseBoxQuote({...boxTicker,data:{...boxTicker.data,asset_pair_name:'BOX4-USDT'}},boxTrades,usdtQuote,now));
for(const price of ['0','-1','NaN','1e9',null]) assert.throws(()=>parseBoxQuote(boxTicker,{code:0,data:[{...boxTrades.data[0],price}]},usdtQuote,now));
for(const created_at of ['invalid',new Date(now-86400001).toISOString(),new Date(now+120000).toISOString()]) assert.throws(()=>parseBoxQuote(boxTicker,{code:0,data:[{price:'8.4',created_at}]},usdtQuote,now));
assert.throws(()=>parseBoxQuote(boxTicker,boxTrades,undefined,now));
assert.throws(()=>parseBoxQuote(boxTicker,boxTrades,{...usdtQuote,at:new Date(now-900001).toISOString()},now));
let boxCalls=0;
const boxService=createMarketPriceService(async url=>{boxCalls++; if(url===PRICE_URL)return Response.json(fixture()); if(url===BOX_TICKER_URL)return Response.json(boxTicker);if(url===BOX_TRADES_URL)return Response.json(boxTrades);throw Error('unexpected URL');},()=>now);
const boxPrices=await boxService(SUPPORTED_COINS);assert.equal(boxPrices.quotes.BOX.source,BOX_SOURCE);await boxService(SUPPORTED_COINS);assert.equal(boxCalls,3);
const boxBook=structuredClone(book);boxBook.marketWatchlist.push(SUPPORTED_COINS.find(c=>c.symbol==='BOX'));boxBook.assets.push({id:'box',symbol:'Box',name:'BOX',priceId:'',network:''});boxBook.manualBalances.push({id:'w|box',wallet:'w',asset:'box',quantity:'10',updated:new Date(now).toISOString(),note:''});boxBook.quotes.box={priceCNY:'50',source:'手动录入',at:new Date(now).toISOString()};
assert.equal(withMarketPrices(boxBook,boxPrices,now).quotes.box.source,BOX_SOURCE);
assert.equal(withMarketPrices(boxBook,boxPrices,now+MAX_PRICE_AGE+1).quotes.box.source,'手动录入');
const failedBox=createMarketPriceService(async url=>url===PRICE_URL?Response.json(fixture()):new Response('down',{status:503}),()=>now);
const withoutBox=await failedBox(SUPPORTED_COINS);assert.ok(withoutBox.quotes.BTC);assert.equal(withoutBox.quotes.BOX,undefined);assert.match(withoutBox.boxError,/BOX/);
console.log('PASS: verified BOX pair, non-pegged USDT conversions, trade timestamps, invalid/stale rejection, cache, mixed-case asset matching, manual fallback and isolated provider failure');

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

// BOX alone depends on USDT's real USD/CNY rate, but USDT is not added to the public result.
const boxOnlyURLs = [];
const boxOnlyService = createMarketPriceService(async url => {
    boxOnlyURLs.push(String(url));
    if (isPrimary(url)) { assert.deepEqual(requestedIDs(url), ['tether']); return Response.json(fixture()); }
    if (url === BOX_TICKER_URL) return Response.json(boxTicker);
    if (url === BOX_TRADES_URL) return Response.json(boxTrades);
    throw Error('Unexpected BOX dependency request');
}, () => now);
const onlyBox = await boxOnlyService([SUPPORTED_COINS.find(c => c.symbol === 'BOX')]);
assert.deepEqual(Object.keys(onlyBox.quotes), ['BOX']);
assert.equal(onlyBox.quotes.BOX.source, BOX_SOURCE);
assert.equal(onlyBox.quotes.USDT, undefined);
assert.equal(boxOnlyURLs.length, 3);

// One unknown or unavailable custom ID does not prevent another selected coin's valid quote.
const partialService = createMarketPriceService(async url => isPrimary(url) ? Response.json(fixture()) : new Response('unavailable', { status: 503 }), () => now);
const partial = await partialService([MAIN_COINS[0], sol]);
assert.equal(partial.quotes.BTC.priceCNY, '500000.12345678');
assert.equal(partial.quotes.SOL, undefined); assert.equal(partial.quotes.ETH, undefined);

// A preset ticker cannot be redirected to another provider asset.
const guarded = createMarketPriceService(async () => { throw Error('Invalid selections must be rejected before network'); }, () => now);
await assert.rejects(guarded([{ symbol: 'BTC', name: 'Impostor', priceId: 'solana' }]));
console.log('PASS: empty lists make zero network calls, dynamic USD/CNY quotes, scoped pending/cache isolation, order-normalized cache, hidden BOX dependency, partial availability and preset identity validation');
