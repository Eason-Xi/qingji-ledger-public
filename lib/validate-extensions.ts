import { checkAddress } from './chain.ts';
import type { Ledger } from './ledger.ts';
import { digitalPositions, units } from './digital.ts';
import { cardNames } from './extensions.ts';
import { validateHK } from './hk-securities.ts';
import { validateMarketWatchlist } from './market-watchlist.ts';
export function validateExtensions(l: Ledger) {
    validateHK(l);
    const text = (s: unknown, n = 200) => typeof s === 'string' && s.length <= n;
    const id = (s: unknown) => text(s) && !!s;
    const integer = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0;
    const date = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
    const accountIds = new Set(l.accounts.map(a => a.id)), categoryIds = new Set(l.categories.map(c => c.id));
    for (const a of l.accounts) {
        if (a.subtype !== undefined && (a.subtype !== 'securities' || a.kind !== 'asset'))
            throw Error('证券账户必须属于资产账户');
        if (a.active !== undefined && typeof a.active !== 'boolean')
            throw Error('账户启用状态无效');
        for (const k of ['billDay', 'payDay'] as const)
            if (a[k] !== undefined && (!Number.isInteger(a[k]) || a[k]! < 1 || a[k]! > 31))
                throw Error('账单日和还款日需为 1 至 31');
        if (a.creditLimit !== undefined && !integer(a.creditLimit))
            throw Error('信用额度无效');
    }
    for (const c of l.categories) {
        if (c.parent && !categoryIds.has(c.parent))
            throw Error('上级分类不存在');
        let p = c.parent;
        const seen = new Set([c.id]);
        while (p) {
            if (seen.has(p))
                throw Error('分类不能循环嵌套');
            seen.add(p);
            p = l.categories.find(x => x.id === p)?.parent;
        }
        if (c.active !== undefined && typeof c.active !== 'boolean')
            throw Error('分类状态无效');
        if (c.order !== undefined && !Number.isInteger(c.order))
            throw Error('分类排序无效');
    }
    for (const [m, b] of Object.entries(l.monthlyBudgets || {}))
        if (!/^\d{4}-\d{2}$/.test(m) || !integer(b))
            throw Error('月预算无效');
    for (const [m, bs] of Object.entries(l.categoryBudgets || {})) {
        if (!/^\d{4}-\d{2}$/.test(m) || typeof bs !== 'object' || !bs)
            throw Error('分类预算无效');
        for (const [c, b] of Object.entries(bs))
            if (!categoryIds.has(c) || !integer(b))
                throw Error('分类预算无效');
    }
    if (l.preferences) {
        const p = l.preferences;
        if (p.cards && (!Array.isArray(p.cards) || new Set(p.cards).size !== p.cards.length || p.cards.some(k => !cardNames[k])))
            throw Error('首页卡片无效');
        for (const k of ['autoPost', 'cloudAI', 'retainInput', 'offline'] as const)
            if (p[k] !== undefined && typeof p[k] !== 'boolean')
                throw Error('记账偏好无效');
        if (p.refundMode && !['occurrence', 'original'].includes(p.refundMode))
            throw Error('退款统计口径无效');
        if (p.costMethod && !['average', 'fifo'].includes(p.costMethod))
            throw Error('成本法无效');
    }
    if (l.recurring) {
        if (!Array.isArray(l.recurring) || l.recurring.length > 500 || new Set(l.recurring.map(r => r.id)).size !== l.recurring.length)
            throw Error('周期账单无效');
        for (const r of l.recurring)
            if (!id(r.id) || !text(r.name) || !r.name || !integer(r.amount) || !r.amount || !date(r.start) || !accountIds.has(r.account) || !categoryIds.has(r.category) || !['expense', 'income'].includes(r.type) || !['daily', 'weekly', 'monthly', 'yearly'].includes(r.frequency) || typeof r.active !== 'boolean' || typeof r.autoDraft !== 'boolean' || !text(r.channel) || !Array.isArray(r.tags) || r.tags.some(t => !text(t, 40)))
                throw Error('周期账单字段无效');
    }
    if (l.merchantRules) {
        if (!Array.isArray(l.merchantRules) || l.merchantRules.length > 500)
            throw Error('商户规则无效');
        for (const r of l.merchantRules)
            if (!id(r.id) || !text(r.match, 100) || !r.match || !categoryIds.has(r.category) || r.account && !accountIds.has(r.account) || r.channel && !text(r.channel, 100))
                throw Error('商户规则字段无效');
    }
    if (l.digital) {
        const d = l.digital;
        if (d.marketDefaultsVersion !== undefined && d.marketDefaultsVersion !== 1) throw Error('默认行情版本无效');
        if (d.marketWatchlist !== undefined) validateMarketWatchlist(d.marketWatchlist);
        if (!Array.isArray(d.wallets) || !Array.isArray(d.assets) || !Array.isArray(d.events) || typeof d.quotes !== 'object' || !d.quotes || d.wallets.length > 100 || d.assets.length > 200 || d.events.length > 10000)
            throw Error('数字资产账本无效');
        const wallets = new Set(d.wallets.map(w => w.id)), assets = new Set(d.assets.map(a => a.id));
        if (wallets.size !== d.wallets.length || assets.size !== d.assets.length || new Set(d.events.map(e => e.id)).size !== d.events.length)
            throw Error('数字资产 ID 重复');
        for (const w of d.wallets) {
            if (w.chainProvider && !['bitcoin', 'tron', 'ethereum'].includes(w.chainProvider) || w.address && (!w.chainProvider || !checkAddress(w.chainProvider, w.address)))
                throw Error('钱包公开地址或查询网络无效');
        }
        for (const w of d.wallets)
            if (!id(w.id) || w.id.includes('|') || !text(w.name) || !w.name || !text(w.network) || !['exchange', 'wallet'].includes(w.kind))
                throw Error('钱包无效');
        for (const a of d.assets) {
            if (a.chainProvider && !['bitcoin', 'tron', 'ethereum'].includes(a.chainProvider) || a.tokenContract && (!a.chainProvider || a.chainProvider === 'bitcoin' || !checkAddress(a.chainProvider, a.tokenContract)))
                throw Error('币种合约地址无效');
        }
        for (const a of d.assets)
            if (!id(a.id) || a.id.includes('|') || !text(a.symbol, 30) || !a.symbol || !text(a.name) || !text(a.network) || !text(a.priceId, 100) || a.priceId && !/^[a-z0-9-]+$/.test(a.priceId))
                throw Error('币种无效');
        if (d.manualBalances !== undefined) {
            if (!Array.isArray(d.manualBalances) || d.manualBalances.length > 20000)
                throw Error('手动资产余额无效');
            const seen = new Set<string>();
            for (const b of d.manualBalances) {
                if (!b || !wallets.has(b.wallet) || !assets.has(b.asset) || b.id !== b.wallet + '|' + b.asset || !text(b.updated) || isNaN(Date.parse(b.updated)) || !text(b.note, 2000))
                    throw Error('手动资产余额字段无效');
                if (seen.has(b.id))
                    throw Error('同一账户的币种余额不能重复');
                seen.add(b.id);
                units(b.quantity);
            }
        }
        for (const e of d.events) {
            if (!id(e.id) || !wallets.has(e.wallet) || !assets.has(e.asset) || !date(e.date) || !text(e.created) || isNaN(Date.parse(e.created)) || !['opening', 'buy', 'sell', 'transfer', 'swap', 'income', 'fee'].includes(e.type) || !['posted', 'deleted'].includes(e.status) || !integer(e.fiatCNY) || e.fiatCNY > 100000000000 || !text(e.txHash, 300) || !text(e.note, 2000) || units(e.quantity) <= 0n)
                throw Error('数字资产事件无效');
            if (e.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time))
                throw Error('交易时间无效');
            if (e.fiatAccount && (!accountIds.has(e.fiatAccount) || l.accounts.find(a => a.id === e.fiatAccount)?.kind !== 'asset'))
                throw Error('数字资产法币来源须为资产账户');
            if (e.type === 'transfer' && (!e.toWallet || !wallets.has(e.toWallet) || e.toWallet === e.wallet))
                throw Error('请选择不同的转入钱包');
            if (e.type === 'swap' && (!e.toAsset || !assets.has(e.toAsset) || e.toAsset === e.asset || !e.toQuantity || units(e.toQuantity) <= 0n || e.toWallet && !wallets.has(e.toWallet)))
                throw Error('兑换币种和数量无效');
            if (e.feeAsset && !assets.has(e.feeAsset))
                throw Error('手续费币种不存在');
            if (e.feeQuantity)
                units(e.feeQuantity);
        }
        for (const [asset, q] of Object.entries(d.quotes)) {
            if (!assets.has(asset) || !q || !text(q.priceCNY, 100) || !text(q.source) || !text(q.at) || isNaN(Date.parse(q.at)))
                throw Error('行情报价无效');
            units(q.priceCNY, 8);
        }
        digitalPositions(d, l.preferences?.costMethod || '');
    }
}
