// Lazy three.js loader with graceful fallback when the CDN is unreachable.
import { h } from './dom.js';
export async function mount3D(container, modulePath, cls, args) {
  container.classList.add('viewport3d');
  const loading = h('div', { class: 'v3d-loading' }, 'در حال بارگذاری three.js …');
  container.append(loading);
  try {
    const mod = await import(modulePath);
    loading.remove();
    return new mod[cls](container, args);
  } catch (e) {
    loading.textContent = 'بارگذاری three.js ناموفق بود (اتصال اینترنت/CDN را بررسی کنید): ' + e.message;
    loading.classList.add('err');
    return null;
  }
}
