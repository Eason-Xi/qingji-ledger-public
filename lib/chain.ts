import { decimal } from './digital.ts';
import type { DigitalBook, DigitalWallet } from './extensions.ts';
export type ChainRecord = {
    hash: string;
    date: string;
    time: string;
    direction: 'in' | 'out';
    quantity: string;
    symbol: string;
    contract: string;
    asset: string;
    counterparty: string;
    ownCounterparty?: string;
    feeQuantity?: string;
    recorded: boolean;
};
export const chainProviders = { bitcoin: { name: 'Bitcoin · Blockstream', destination: 'https://blockstream.info/api' }, tron: { name: 'TRON · TronGrid（TRC20）', destination: 'https://api.trongrid.io' }, ethereum: { name: 'Ethereum · Etherscan V2（ERC20）', destination: 'https://api.etherscan.io/v2/api' } } as const;
export function checkAddress(provider: string, address: string) { if (provider === 'bitcoin')
    return /^(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(address); if (provider === 'tron')
    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address); if (provider === 'ethereum')
    return /^0x[0-9a-fA-F]{40}$/.test(address); return false; }
export function chainRows(provider: keyof typeof chainProviders, data: any, wallet: DigitalWallet, book: DigitalBook): ChainRecord[] {
    const output: ChainRecord[] = [];
    const address = wallet.address!;
    const same = (a: string, b: string) => provider === 'ethereum' ? a.toLowerCase() === b.toLowerCase() : a === b;
    const append = (raw: {
        hash: string;
        timestamp: number;
        from: string;
        to: string;
        value: string;
        decimals: number;
        symbol: string;
        contract: string;
        fee?: string;
    }) => { if (!raw.hash || !Number.isFinite(raw.timestamp) || !Number.isInteger(raw.decimals) || raw.decimals < 0 || raw.decimals > 18 || !/^\d+$/.test(raw.value))
        return; if (!same(raw.from, address) && !same(raw.to, address))
        return; if (same(raw.from, address) && same(raw.to, address))
        return; const asset = book.assets.find(a => a.chainProvider === provider && (provider === 'bitcoin' ? a.symbol === 'BTC' : !!a.tokenContract && same(a.tokenContract, raw.contract)))?.id || ''; const out = same(raw.from, address); const counterparty = out ? raw.to : raw.from; const own = book.wallets.find(w => w.id !== wallet.id && w.address && w.chainProvider === provider && same(w.address, counterparty)); const at = new Date(raw.timestamp); if (isNaN(at.getTime()))
        return; const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at); const part = (name: string) => parts.find(x => x.type === name)?.value || ''; const date = `${part('year')}-${part('month')}-${part('day')}`, time = `${part('hour') === '24' ? '00' : part('hour')}:${part('minute')}`; output.push({ hash: raw.hash, date, time, direction: out ? 'out' : 'in', quantity: decimal(BigInt(raw.value), raw.decimals), symbol: raw.symbol, contract: raw.contract, asset, counterparty, ownCounterparty: own?.id, feeQuantity: raw.fee, recorded: book.events.some(e => e.status === 'posted' && e.txHash === raw.hash && (!asset || e.asset === asset) && (e.wallet === wallet.id || e.toWallet === wallet.id)) }); };
    if (provider === 'tron')
        for (const r of data.data || [])
            append({ hash: r.transaction_id, timestamp: Number(r.block_timestamp), from: r.from || '', to: r.to || '', value: String(r.value), decimals: Number(r.token_info?.decimals), symbol: r.token_info?.symbol || '', contract: r.token_info?.address || '' });
    if (provider === 'ethereum')
        for (const r of Array.isArray(data.result) ? data.result : [])
            append({ hash: r.hash, timestamp: Number(r.timeStamp) * 1000, from: r.from || '', to: r.to || '', value: String(r.value), decimals: Number(r.tokenDecimal), symbol: r.tokenSymbol || '', contract: r.contractAddress || '' });
    if (provider === 'bitcoin')
        for (const r of Array.isArray(data) ? data : []) {
            if (!r.status?.confirmed)
                continue;
            const incoming: bigint = (r.vout || []).filter((v: any) => v.scriptpubkey_address === address).reduce((s: bigint, v: any) => s + BigInt(v.value), 0n);
            const outgoing: bigint = (r.vin || []).filter((v: any) => v.prevout?.scriptpubkey_address === address).reduce((s: bigint, v: any) => s + BigInt(v.prevout.value), 0n);
            const net = incoming - outgoing;
            if (!net)
                continue;
            const out = net < 0n;
            const fee = out ? BigInt(r.fee || 0) : 0n;
            const qty = out ? -net - fee : net;
            if (qty <= 0n)
                continue;
            append({ hash: r.txid, timestamp: Number(r.status.block_time) * 1000, from: out ? address : r.vin?.[0]?.prevout?.scriptpubkey_address || '', to: out ? (r.vout || []).find((v: any) => v.scriptpubkey_address !== address)?.scriptpubkey_address || '' : address, value: qty.toString(), decimals: 8, symbol: 'BTC', contract: '', fee: out ? decimal(fee, 8) : undefined });
        }
    return output.filter(r => r.quantity !== '0');
}
