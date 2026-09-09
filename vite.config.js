import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

export default defineConfig({
  server: {
    watch: { ignored: ['**/verification/**', '**/.tools/**'] },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**'] },
  },
  plugins: [{
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
      for (const name of ['scene.json', 'README.md']) {
        const fileName = `research/gyeonghuigung-xi/${name}`;
        this.emitFile({type:'asset',fileName,source:readFileSync(fileName)});
      }
    },
  }],
});
