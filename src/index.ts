import { loadConfig } from './config.js';

const config = loadConfig();

console.error('Config loaded successfully:');
console.error(JSON.stringify({
  ...config,
  googlePrivateKey: config.googlePrivateKey.substring(0, 27) + '...[REDACTED]',
}, null, 2));

process.exit(0);
