import {defineConfig} from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5187,
    strictPort: true,
    allowedHosts: ['5187.prk.network'],
  },
});
