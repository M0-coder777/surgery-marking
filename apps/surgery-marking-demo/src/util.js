/* ============================================================
   util.js — 通用工具
   ============================================================ */
(function () {
  const SMK = (window.SMK = window.SMK || {});
  const U = (SMK.util = {});

  let seq = 0;

  /** 生成稳定可读的 id */
  U.uid = function (prefix) {
    seq += 1;
    const t = Date.now().toString(36).slice(-4).toUpperCase();
    return `${prefix}-${t}${String(seq).padStart(2, '0')}`;
  };

  U.now = function () { return new Date().toISOString(); };

  U.fmtTime = function (iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  U.fmtTimeShort = function (iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  /** FNV-1a 32 位散列 —— 仅用于防误改完整性校验，不构成电子签名 */
  U.fnv1a = function (str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };

  U.checksum = function (obj) {
    const hex = U.fnv1a(JSON.stringify(obj)).toString(16).toUpperCase().padStart(8, '0');
    return hex.slice(0, 4) + '-' + hex.slice(4);
  };

  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  U.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /** 颜色：hex -> rgba 字符串 */
  U.alpha = function (hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  U.download = function (filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  let toastTimer = null;
  U.toast = function (msg, kind) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
    requestAnimationFrame(() => el.classList.remove('hidden'));
  };

  U.debounce = function (fn, ms) {
    let t = null;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  };
})();
