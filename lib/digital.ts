import type { DigitalBook, DigitalEvent } from './extensions.ts';
export const SCALE = 10n ** 18n;
export function units(value: string, decimals = 18): bigint { if (typeof value !== 'string' || !new RegExp('^\\d+(?:\\.\\d{1,' + decimals + '})?$').test(value.trim()))
    throw Error(`数量最多支持 ${decimals} 位小数`); const [a, b = ''] = value.trim().split('.'); const n = BigInt(a) * 10n ** BigInt(decimals) + BigInt(b.padEnd(decimals, '0')); if (n > 10n ** 40n)
    throw Error('数字资产数量过大'); return n; }
export function decimal(n: bigint, scale = 18) { const neg = n < 0n; if (neg)
    n = -n; const p = 10n ** BigInt(scale); return (neg ? '-' : '') + (n / p).toString() + ((n % p) ? '.' + (n % p).toString().padStart(scale, '0').replace(/0+$/, '') : ''); }
export function valuation(q: bigint, price: string) { const n = q * units(price, 8) * 100n / (SCALE * 10n ** 8n); if (n > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error('估值金额过大'); return Number(n); }
type Lot = {
    quantity: bigint;
    cost: bigint;
};
export type Position = {
    wallet: string;
    asset: string;
    quantity: string;
    cost: number | null;
    value: number | null;
    unrealized: number | null;
    manual?: boolean;
};
export function digitalPositions(book: DigitalBook, method: 'fifo' | 'average' | '') {
    const inventory = new Map<string, Lot[]>();
    let realized = 0n, feeCost = 0n;
    const key = (wallet: string, asset: string) => wallet + '|' + asset;
    const add = (wallet: string, asset: string, q: bigint, cost: bigint) => { const k = key(wallet, asset); const list = inventory.get(k) || []; if (method === 'average' && list.length) {
        list[0].quantity += q;
        list[0].cost += cost;
    }
    else
        list.push({ quantity: q, cost }); inventory.set(k, list); };
    const take = (wallet: string, asset: string, q: bigint) => { const list = inventory.get(key(wallet, asset)) || []; const available = list.reduce((s, x) => s + x.quantity, 0n); if (q > available)
        throw Error('数字资产余额不足：' + (book.assets.find(a => a.id === asset)?.symbol || asset)); let left = q, total = 0n; const removed: Lot[] = []; while (left > 0n) {
        const lot = list[0];
        const qty = left < lot.quantity ? left : lot.quantity;
        const cost = qty === lot.quantity ? lot.cost : lot.cost * qty / lot.quantity;
        total += cost;
        removed.push({ quantity: qty, cost });
        lot.quantity -= qty;
        lot.cost -= cost;
        left -= qty;
        if (!lot.quantity)
            list.shift();
    } return { cost: total, lots: removed }; };
    const events = book.events.filter(e => e.status === 'posted').sort((a, b) => (a.date + 'T' + (a.time || '00:00')).localeCompare(b.date + 'T' + (b.time || '00:00')) || a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
    for (const e of events) {
        const q = units(e.quantity);
        const value = BigInt(e.fiatCNY);
        if (['opening', 'buy', 'income'].includes(e.type))
            add(e.wallet, e.asset, q, value);
        else if (e.type === 'sell') {
            realized += value - take(e.wallet, e.asset, q).cost;
        }
        else if (e.type === 'transfer') {
            const consumed = take(e.wallet, e.asset, q);
            for (const lot of consumed.lots)
                add(e.toWallet!, e.asset, lot.quantity, lot.cost);
        }
        else if (e.type === 'swap') {
            const old = take(e.wallet, e.asset, q);
            realized += value - old.cost;
            add(e.toWallet || e.wallet, e.toAsset!, units(e.toQuantity!), value);
        }
        else if (e.type === 'fee')
            feeCost += take(e.wallet, e.asset, q).cost;
        if (e.feeAsset && e.feeQuantity && units(e.feeQuantity) > 0n)
            feeCost += take(e.wallet, e.feeAsset, units(e.feeQuantity)).cost;
    }
    const positionMap = new Map<string, Position>();
    for (const [k, lots] of inventory) {
        const [wallet, asset] = k.split('|');
        const qty = lots.reduce((s, l) => s + l.quantity, 0n);
        if (!qty)
            continue;
        const c = Number(lots.reduce((s, l) => s + l.cost, 0n));
        const quote = book.quotes[asset];
        const value = quote ? valuation(qty, quote.priceCNY) : null;
        positionMap.set(k, { wallet, asset, quantity: decimal(qty), cost: c, value, unrealized: method && value !== null ? value - c : null });
    }
    // A manual balance replaces the matching historical position; it is never added twice.
    for (const balance of book.manualBalances || []) {
        const qty = units(balance.quantity), quote = book.quotes[balance.asset];
        positionMap.set(key(balance.wallet, balance.asset), {
            wallet: balance.wallet, asset: balance.asset, quantity: decimal(qty),
            cost: qty === 0n ? 0 : null,
            value: qty === 0n ? 0 : quote ? valuation(qty, quote.priceCNY) : null,
            unrealized: null, manual: true,
        });
    }
    const positions = [...positionMap.values()];
    let cost = 0, totalValue = 0, missing = 0, knownCost = true;
    for (const pos of positions) {
        if (pos.value === null)
            missing++;
        else {
            if (!Number.isSafeInteger(totalValue + pos.value))
                throw Error('数字资产估值合计过大');
            totalValue += pos.value;
        }
        if (pos.cost === null)
            knownCost = false;
        else
            cost += pos.cost;
    }
    return { positions, cost: method && knownCost ? cost : null, value: totalValue, missing, realized: method ? Number(realized) : null, feeCost: method ? Number(feeCost) : null, netRealized: method ? Number(realized - feeCost) : null };
}
export function setDigitalBalance(book: DigitalBook, wallet: string, asset: string, quantity: string, note = '', updated = new Date().toISOString()): DigitalBook {
    if (!book.wallets.some(w => w.id === wallet) || !book.assets.some(a => a.id === asset))
        throw Error('请选择有效账户与币种');
    if (typeof note !== 'string' || note.length > 2000 || typeof updated !== 'string' || isNaN(Date.parse(updated)))
        throw Error('余额备注或更新时间无效');
    const balance = { id: wallet + '|' + asset, wallet, asset, quantity: decimal(units(quantity)), note: note.trim(), updated };
    const rows = book.manualBalances || [];
    return { ...book, manualBalances: rows.some(b => b.id === balance.id) ? rows.map(b => b.id === balance.id ? balance : b) : [...rows, balance] };
}
export function emptyDigital(): DigitalBook { return { wallets: [], assets: [], events: [], quotes: {} }; }
