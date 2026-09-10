import {spawnSync} from 'node:child_process';
const collect=spawnSync(process.execPath,['scripts/address-pipeline.mjs',...process.argv.slice(2)],{stdio:'inherit'});
const charts=spawnSync(process.execPath,['scripts/extract-image-charts.mjs'],{stdio:'inherit'});
// Retain successful addresses even when another address failed.
const build=spawnSync(process.execPath,['scripts/build-linkage.mjs'],{stdio:'inherit'});
process.exitCode=collect.status||charts.status||build.status||0;
