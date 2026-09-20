/**
 * 设置面板的实际逻辑。
 *
 * 这个文件不会随首屏加载 —— SettingsPanel.astro 里只留了一个几十字节的引导，
 * 首次点开设置时才动态 import 这里。首屏 JS 预算因此省下 ~3 KB。
 *
 * 注意：开合面板本身由引导脚本负责，这里只接管面板内部的交互。
 */
const FX = ['reveal', 'sink', 'glass', 'scrollBlur'];
const SKINS = ['fontaine', 'opera', 'abyss', 'mint', 'amber', 'jade', 'indigo'];
/* 卡片风格：glass 是默认（建站以来的毛玻璃），其余为可选外观 */
const CARD_STYLES = ['glass', 'line', 'paper', 'float'];

function read(key: string, fb: string): string {
  try { return localStorage.getItem(key) || fb; } catch { return fb; }
}
function readFx(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem('yuuu-fx') || '{}'); } catch { return {}; }
}
function writeFx(o: Record<string, boolean>): void {
  try { localStorage.setItem('yuuu-fx', JSON.stringify(o)); } catch { /* 隐私模式下会抛，忽略 */ }
}

export function init(): void {
  const menu = document.getElementById('settingsMenu');
  const root = document.getElementById('settingsRoot');
  if (!menu || !root) return;

  const html = document.documentElement;
  const q = (sel: string) => Array.from(menu.querySelectorAll<HTMLElement>(sel));

  function applyFx(o: Record<string, boolean>): void {
    FX.forEach((k) => html.classList.toggle('fx-' + k, o[k] !== false));
  }

  /*
   * ---------- 明暗：随时间自动 ----------
   *
   * 规则：localStorage['yuuu-theme'] 为 'auto'（或不存）→ 按小时自动；
   *       为 'light'/'dark' → 手动钉死（点顶栏那个按钮就会钉死）。
   * 白天区间存 localStorage['yuuu-day'] = "7-19"，支持跨夜（如 "20-6"）。
   * 真正的应用在 BaseLayout 的首屏脚本里（window.__yuuuTheme）——
   * 主题必须在首屏绘制前定好；这里只负责面板上的交互。
   */
  const themeAuto = menu.querySelector<HTMLInputElement>('[data-theme-auto]');
  const themeDayBox = menu.querySelector<HTMLElement>('[data-theme-day]');
  const dayFrom = menu.querySelector<HTMLSelectElement>('[data-day-from]');
  const dayTo = menu.querySelector<HTMLSelectElement>('[data-day-to]');
  const themeNow = menu.querySelector<HTMLElement>('[data-theme-now]');

  const DAY_DEFAULT = '7-19';
  function dayRange(): [number, number] {
    const parts = read('yuuu-day', DAY_DEFAULT).split('-');
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    return [a >= 0 && a <= 23 ? a : 7, b >= 0 && b <= 23 ? b : 19];
  }
  function applyTheme(): void {
    const f = (window as unknown as { __yuuuTheme?: () => void }).__yuuuTheme;
    if (f) f();
  }
  function isAuto(): boolean {
    const t = read('yuuu-theme', 'auto');
    return t !== 'light' && t !== 'dark';
  }
  /* 两个下拉：0~23 点 */
  for (const sel of [dayFrom, dayTo]) {
    if (!sel) continue;
    for (let h = 0; h < 24; h++) {
      const o = document.createElement('option');
      o.value = String(h);
      o.textContent = h + ':00';
      sel.appendChild(o);
    }
  }
  function paintTheme(): void {
    const auto = isAuto();
    if (themeAuto) themeAuto.checked = auto;
    if (themeDayBox) themeDayBox.hidden = !auto;
    const [a, b] = dayRange();
    if (dayFrom) dayFrom.value = String(a);
    if (dayTo) dayTo.value = String(b);
    if (themeNow) {
      const h = new Date().getHours();
      const day = a <= b ? (h >= a && h < b) : (h >= a || h < b);
      const nowLight = document.documentElement.getAttribute('data-theme') === 'light';
      themeNow.textContent = auto
        ? '现在 ' + String(h).padStart(2, '0') + ' 点 → ' + (day ? '亮色' : '暗色')
        : '已手动固定为' + (nowLight ? '亮色' : '暗色');
    }
  }
  themeAuto?.addEventListener('change', () => {
    const htmlEl = document.documentElement;
    htmlEl.classList.add('theme-switching');
    try {
      localStorage.setItem(
        'yuuu-theme',
        themeAuto.checked ? 'auto' : (htmlEl.getAttribute('data-theme') === 'light' ? 'light' : 'dark'),
      );
    } catch { /* 隐私模式忽略 */ }
    applyTheme();
    paintTheme();
    window.setTimeout(() => htmlEl.classList.remove('theme-switching'), 560);
  });
  const onDayChange = (): void => {
    const a = Number(dayFrom?.value ?? 7);
    const b = Number(dayTo?.value ?? 19);
    try {
      localStorage.setItem('yuuu-day', a + '-' + b);
      /* 改区间当然是要自动模式 —— 顺手打开，省得用户再勾一次 */
      localStorage.setItem('yuuu-theme', 'auto');
    } catch { /* 忽略 */ }
    applyTheme();
    paintTheme();
  };
  dayFrom?.addEventListener('change', onDayChange);
  dayTo?.addEventListener('change', onDayChange);
  /* 顶栏按钮点过后，这里的开关要跟着变 —— 否则两边显示不一致 */
  window.addEventListener('yuuu-theme-change', () => paintTheme());

  function paint(): void {
    paintTheme();
    const cols = Number(read('yuuu-cols', '3')) || 3;
    q('[data-cols]').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.cols) === cols));
    const s = read('yuuu-skin', 'fontaine');
    q('[data-skin]').forEach((b) => b.classList.toggle('is-on', b.dataset.skin === s));
    const cs = read('yuuu-card', 'glass');
    q('[data-card]').forEach((b) => b.classList.toggle('is-on', b.dataset.card === cs));
    const fx = readFx();
    q('[data-fx]').forEach((cb) => {
      (cb as HTMLInputElement).checked = fx[cb.dataset.fx as string] !== false;
    });
  }

  /* 卡片风格要在页面绘制时就生效（否则会闪一下默认样式）—— 引导脚本负责首屏，
     这里只处理「已经加载过设置面板」的情况，重复设置也不会有副作用。 */
  const savedCard = read('yuuu-card', 'glass');
  if (CARD_STYLES.includes(savedCard)) html.setAttribute('data-card', savedCard);

  menu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement)?.closest?.('button');
    if (!b) return;
    const el = b as HTMLButtonElement;

    if (el.dataset.cols) {
      const n = String(Math.min(6, Math.max(2, Number(el.dataset.cols) || 3)));
      html.style.setProperty('--home-cols', n);
      try { localStorage.setItem('yuuu-cols', n); } catch { /* 忽略 */ }
      paint();
      return;
    }
    if (el.dataset.skin && SKINS.includes(el.dataset.skin)) {
      html.classList.add('theme-switching');
      html.setAttribute('data-skin', el.dataset.skin);
      try { localStorage.setItem('yuuu-skin', el.dataset.skin); } catch { /* 忽略 */ }
      window.setTimeout(() => html.classList.remove('theme-switching'), 560);
      paint();
      return;
    }
    /* 卡片风格：挂到 <html data-card> 上，样式由 global.css 里的一组规则接管 */
    if (el.dataset.card && CARD_STYLES.includes(el.dataset.card)) {
      html.setAttribute('data-card', el.dataset.card);
      try { localStorage.setItem('yuuu-card', el.dataset.card); } catch { /* 忽略 */ }
      paint();
    }
  });

  q('[data-fx]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const fx = readFx();
      fx[cb.dataset.fx as string] = (cb as HTMLInputElement).checked;
      writeFx(fx);
      applyFx(fx);
    });
  });

  /* 导出：主题 + 皮肤 + 显示设置，存到自己电脑 */
  document.getElementById('fxExport')?.addEventListener('click', () => {
    const data = {
      _about: 'yuuu 本地设置，可导入恢复',
      _exportedAt: new Date().toISOString(),
      theme: read('yuuu-theme', 'dark'),
      skin: read('yuuu-skin', 'fontaine'),
      fx: readFx(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'yuuu-settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const file = document.getElementById('fxFile') as HTMLInputElement | null;
  document.getElementById('fxImport')?.addEventListener('click', () => file?.click());
  file?.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(String(reader.result));
        html.classList.add('theme-switching');
        if (d.theme === 'light' || d.theme === 'dark') {
          html.setAttribute('data-theme', d.theme);
          localStorage.setItem('yuuu-theme', d.theme);
        }
        if (d.skin && SKINS.includes(d.skin)) {
          html.setAttribute('data-skin', d.skin);
          localStorage.setItem('yuuu-skin', d.skin);
        }
        if (d.fx && typeof d.fx === 'object') { writeFx(d.fx); applyFx(d.fx); }
        window.setTimeout(() => html.classList.remove('theme-switching'), 560);
        paint();
      } catch { /* 不是我们的格式，忽略 */ }
      file.value = '';
    };
    reader.readAsText(f);
  });

  /* 点外面 / Esc 关闭 */
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target as Node)) {
      menu.hidden = true;
      document.getElementById('settingsToggle')?.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menu.hidden = true;
  });

  paint();
}
