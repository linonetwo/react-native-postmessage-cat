import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';
import typescript from 'rollup-plugin-typescript2';

export default {
  input: 'src/webview.ts', // Entry point
  output: {
    file: 'dist/webview-bundle.js', // Output bundled file
    format: 'esm', // Output format as ES module
  },
  plugins: [
    typescript({
      target: 'es5',
    }), // Compile TypeScript
    resolve(), // Resolve imports from node_modules
    commonjs(), // Convert CommonJS to ES6 modules
    terser({ // Minify and remove comments
      output: {
        comments: false,
      },
    }),
  ],
};
