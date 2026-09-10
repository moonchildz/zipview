import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { satellitePlugin } from './scripts/imagery-server.mjs';
import {addressPipelinePlugin} from './scripts/address-server.mjs';

export default defineConfig({
  server: {
    watch: { ignored: ['**/verification/**', '**/.tools/**', '**/research/linkage/cache/**', '**/research/linkage/providers/**', '**/research/linkage/downloads/**', '**/research/linkage/generated/**', '**/research/seoul/raw/**'] },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**'] },
  },
  plugins: [satellitePlugin(), addressPipelinePlugin(), {
    name: 'research-assets',
    generateBundle() {
      for (const name of ['59D', '84A', '84B', '84C', '84D', '84E', '109A', '109B', 'site-and-units', 'site-perspective']) {
        const fileName = `research/sinchon-prugio/images/${name}.jpg`;
        this.emitFile({ type: 'asset', fileName, source: readFileSync(fileName) });
      }
      const fileName = 'research/sinchon-prugio/README.md';
      this.emitFile({ type: 'asset', fileName, source: readFileSync(fileName) });
      const sceneFile = 'research/sinchon-prugio/outlook/scene.json';
      this.emitFile({ type: 'asset', fileName: sceneFile, source: readFileSync(sceneFile) });
      const correctionFile = 'research/sinchon-prugio/outlook/mapinfo-correction.json';
      this.emitFile({ type: 'asset', fileName: correctionFile, source: readFileSync(correctionFile) });
      for (const name of ['scene.json', 'README.md', 'unit-layout-research.md', 'unit-lookup-research.md']) {
        const fileName = `research/gyeonghuigung-xi/${name}`;
        this.emitFile({type:'asset',fileName,source:readFileSync(fileName)});
      }
      for (const name of ['catalog', 'report']) {
        const fileName = `research/linkage/generated/${name}.json`;
        this.emitFile({type:'asset',fileName,source:readFileSync(fileName)});
      }
      const catalog = JSON.parse(readFileSync('research/linkage/generated/catalog.json', 'utf8'));
      const emittedPlans = new Set();
      for (const plan of catalog.plans.filter(p => p.available && !p.file.startsWith('research/sinchon-prugio/images/'))) {
        if (emittedPlans.has(plan.file)) continue;
        emittedPlans.add(plan.file);
        this.emitFile({type:'asset',fileName:plan.file,source:readFileSync(plan.file)});
      }
    },
  }],
});
