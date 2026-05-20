import react from '@vitejs/plugin-react';
import {createReadStream, statSync} from 'node:fs';
import path from 'node:path';
import {defineConfig} from 'vite';
import {fileURLToPath, URL} from 'node:url';

const reactPalmTasks = fileURLToPath(
  new URL('./node_modules/@kepler.gl/actions/node_modules/react-palm/tasks/index.js', import.meta.url)
);
const localDataDir = fileURLToPath(new URL('../data/', import.meta.url));

function localDataCsvPlugin() {
  return {
    name: 'shadow-view-local-data-csv',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = request.url ? new URL(request.url, 'http://127.0.0.1') : null;
        const requestedName = requestUrl?.pathname.slice(1) ?? '';
        if (!requestedName || requestedName.includes('/') || !requestedName.toLowerCase().endsWith('.csv')) {
          next();
          return;
        }

        const filePath = path.join(localDataDir, requestedName);
        let stats;
        try {
          stats = statSync(filePath);
        } catch {
          next();
          return;
        }

        if (!stats.isFile()) {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Length', stats.size);
        response.setHeader('Cache-Control', 'no-cache');
        createReadStream(filePath).on('error', next).pipe(response);
      });
    }
  };
}

export default defineConfig(({mode}) => {
  const nodeEnv = mode === 'production' ? 'production' : 'development';

  return {
    plugins: [localDataCsvPlugin(), react()],
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
