import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'PLACES_');
  const proxy = {
    '/rpc': {
      target: env.PLACES_API_URL || 'http://127.0.0.1:5188',
      changeOrigin: true,
    },
  };

  return {
    server: {
      host: '127.0.0.1',
      port: 5187,
      strictPort: true,
      allowedHosts: ['5187.prk.network'],
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 5187,
      strictPort: true,
      allowedHosts: ['5187.prk.network'],
      proxy,
    },
  };
});
