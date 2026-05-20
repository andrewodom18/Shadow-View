import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';
import {fileURLToPath, URL} from 'node:url';

const reactPalmTasks = fileURLToPath(
  new URL('./node_modules/@kepler.gl/actions/node_modules/react-palm/tasks/index.js', import.meta.url)
);

export default defineConfig(({mode}) => {
  const nodeEnv = mode === 'production' ? 'production' : 'development';

  return {
    plugins: [react()],
    define: {
      'process.env.NODE_DEBUG': 'undefined',
      'process.env.NODE_ENV': JSON.stringify(nodeEnv)
    },
    resolve: {
      dedupe: ['react', 'react-dom', 'react-redux', 'redux'],
      alias: {
        assert: 'assert/',
        events: 'events/',
        'react-palm/tasks': reactPalmTasks
      }
    },
    server: {
      port: 5173,
      strictPort: false,
      proxy: {
        '/api': 'http://127.0.0.1:8765'
      }
    },
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 13000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/@kepler.gl') || id.includes('node_modules/@deck.gl')) {
              return 'map-vendor';
            }
            if (id.includes('node_modules')) {
              return 'vendor';
            }
            return undefined;
          }
        }
      }
    }
  };
});
