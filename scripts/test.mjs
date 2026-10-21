import { spawnSync } from 'node:child_process';
const suites=['browser-storage','reports','fund-transfers','offline-books','hk-transfers','bank-currency','draft-queue','approval','ledger','importer','channels','securities','hk-securities','manual-digital','market-prices'];
for(const suite of suites){const result=spawnSync(process.execPath,['--experimental-strip-types',`tests/${suite}.test.mjs`],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
