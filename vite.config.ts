import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// سياسة أمان المحتوى (CSP) تُضاف للصفحات عند البناء فقط
function cspPlugin(supabaseUrl: string): Plugin {
  let origin = '';
  try { origin = new URL(supabaseUrl).origin; } catch { /* not configured */ }
  const wss = origin.replace(/^http/, 'ws');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' https: data: blob:",
    "media-src 'self' https: blob:",
    `connect-src 'self' ${origin} ${wss}`.trim(),
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'rasmala-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: env.BASE_PATH || '/',
    plugins: [react(), cspPlugin(env.VITE_SUPABASE_URL || '')],
    build: {
      // متوافق مع محركات WebView الأقدم في أجهزة التلفزيون
      target: ['es2019', 'chrome79'],
      cssCodeSplit: true,
      sourcemap: false,
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), 'index.html'),
          display: resolve(process.cwd(), 'display/index.html'),
          admin: resolve(process.cwd(), 'admin/index.html'),
        },
      },
    },
  };
});
