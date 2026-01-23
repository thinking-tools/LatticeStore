import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: {
      client: 'src_sdk_ts/Client.ts',
      service: 'src_sdk_ts/Service.ts',
      WebGrunt: 'src_sdk_ts/client/WebGrunt.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    outDir: 'dist',
    treeshake: true,
  },
]);
