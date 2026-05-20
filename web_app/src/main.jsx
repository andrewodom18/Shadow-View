const processEnv = globalThis.process?.env ?? {};

globalThis.process = {
  ...(globalThis.process ?? {}),
  env: {
    ...processEnv,
    NODE_DEBUG: processEnv.NODE_DEBUG ?? '',
    NODE_ENV: processEnv.NODE_ENV ?? (import.meta.env.PROD ? 'production' : 'development')
  }
};

import('./bootstrap.jsx');
