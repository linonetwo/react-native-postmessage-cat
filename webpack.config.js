/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable unicorn/import-style */
/** Only use webpack to bundle webview.js into a string, because the injectedJavaScriptBeforeContentLoaded prop only receives string. */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = {
  entry: './dist/webview.js',
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
  },
  output: {
    path: join(__dirname, './dist'),
    filename: 'webview-string.js',
  },
  mode: 'production',
};
export default config;
