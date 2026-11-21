// PoE2 Build Assistant (M09a): show the local assistant's evaluation next to
// each trade2 result. Item text comes from upstream's parseItemData
// (content.js, loaded first); the request goes through the background script,
// because only the extension's own origin is accepted by the assistant.
//
// M09b: the assistant's own trade window runs this same file (copied
// unchanged into EE2's main/trade-preview/) in an isolated world, where
// `poe2AssistantTransport.evaluate(message)` replaces the background script
// and answers over the assistant's internal channel. On the Tencent site
// (poe.game.qq.com) names and modifiers are Simplified Chinese.
(function () {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const transport = globalThis.poe2AssistantTransport;
  const MARK = 'data-poe2-assistant';
  const LANGUAGE = globalThis.location?.hostname === 'poe.game.qq.com' ? 'zh_hans' : 'en';

  const CURRENCY_ID = /^[a-z0-9-]{2,40}$/;

  function rowItemText(row) {
    const popup = row.querySelector('.item-popup__content') || row.querySelector('.itemPopupContainer');
    if (!popup) return null;
    const sockets = Array.from(row.querySelectorAll('.left .socket'))
      .map((s) => (s.classList.contains('socket--rune') ? 'S' : '-'))
      .join(' ');
    return parseItemData(popup, sockets); // eslint-disable-line no-undef -- content.js
  }

  // "50 × Exalted Orb" -> { amount: 50, currency: 'exalted', currency_text: 'Exalted Orb' }.
  // The icon carries the trade id; without it the assistant matches the English name.
  function rowPrice(row) {
    const el = row.querySelector('[data-field="price"]');
    if (!el) return null;
    const amountText = Array.from(el.querySelectorAll('span'))
      .map((s) => s.textContent.trim())
      .find((t) => /^\d+(?:[.,]\d+)?(?:\/\d+)?$/.test(t));
    if (!amountText) return null;
    const [num, den] = amountText.replace(',', '.').split('/');
    const amount = den ? Number(num) / Number(den) : Number(num);
    if (!(amount > 0)) return null;
    const icon = el.querySelector('.currency-text img, img');
    const currency = [icon?.getAttribute('alt'), icon?.getAttribute('title')]
      .map((v) => (v || '').trim().toLowerCase())
      .find((v) => CURRENCY_ID.test(v));
    const text = (el.querySelector('.currency-text')?.textContent || '').trim().slice(0, 80);
    if (!currency && !text) return null;
    return { amount, ...(currency ? { currency } : {}), currency_text: text || currency };
  }

  function signed(value, digits) {
    const text = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(digits);
    return Number(text) > 0 ? `+${text}` : Number(text) === 0 ? '0' : text;
  }

  // Same rounding as the overlay's value line (M08b compact).
  function compact(value) {
    const abs = Math.abs(value);
    const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 0.1 ? 2 : 3;
    const text = value.toFixed(digits);
    return Number(text) > 0 ? `+${text}` : Number(text) === 0 ? '0' : text;
  }

  function line(className, text, title) {
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text;
    if (title) div.title = title;
    return div;
  }

  // Lines for one reply of the background script (see background.js).
  function describe(reply) {
    if (!reply || reply.ok !== true) {
      const offline = reply?.code === 'offline';
      return [{
        cls: offline ? 'poe2a-muted' : 'poe2a-error',
        text: offline ? (transport ? '助手后端没有响应，请稍后重试' : '助手未运行：请先打开 PoB 和游戏内助手')
          : `无法评估：${reply?.message || '未知原因'}`,
        retry: true,
      }];
    }
    const s = reply.slot;
    if (!s) return [{ cls: 'poe2a-error', text: '无法评估：当前 BD 没有能放这件装备的槽位' }];
    const dps = s.dps_percent !== null ? `DPS ${signed(s.dps_percent, 1)}%` : `DPS ${signed(s.dps_absolute, 0)}`;
    const others = reply.slots.filter((o) => o.slot !== s.slot)
      .map((o) => `${o.label}：DPS ${o.dps_percent !== null ? `${signed(o.dps_percent, 1)}%` : signed(o.dps_absolute, 0)}，有效生命 ${signed(o.ehp, 0)}`);
    const title = [s.summary, ...others].join('\n');
    const good = (s.dps_percent ?? s.dps_absolute) > 0 || ((s.dps_percent ?? s.dps_absolute) === 0 && s.ehp > 0);
    const bad = (s.dps_percent ?? s.dps_absolute) < 0 || ((s.dps_percent ?? s.dps_absolute) === 0 && s.ehp < 0);
    const lines = [{
      cls: good ? 'poe2a-good' : bad ? 'poe2a-bad' : 'poe2a-main',
      text: `${s.label}：${dps} · 有效生命 ${signed(s.ehp, 0)}`,
      title,
    }];
    const v = reply.value;
    if (v && v.price_in_base !== undefined) {
      const parts = [v.dps_percent !== null ? `DPS ${compact(v.dps_percent)}%` : null, `有效生命 ${compact(v.ehp)}`]
        .filter(Boolean).join(' · ');
      const converted = v.price_name !== v.base_name
        ? `${reply.price.amount} ${v.price_name} 约合 ${Number(v.price_in_base.toPrecision(3))} ${v.base_name}`
        : '';
      lines.push({ cls: 'poe2a-value', text: `每 1 ${v.base_name}：${parts}`, title: converted });
    } else if (v && v.message) {
      lines.push({ cls: 'poe2a-muted', text: v.message });
    }
    return lines;
  }

  function render(box, reply, retry) {
    box.replaceChildren(line('poe2a-head', 'PoE2 助手'));
    for (const l of describe(reply)) {
      const div = line(l.cls, l.text, l.title);
      if (l.retry && retry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'poe2a-retry';
        button.textContent = '重试';
        button.addEventListener('click', retry);
        div.append(' ', button);
      }
      box.append(div);
    }
  }

  function send(message) {
    if (transport) {
      return Promise.resolve()
        .then(() => transport.evaluate(message))
        .catch(() => ({ ok: false, code: 'offline' }));
    }
    try {
      return Promise.resolve(api.runtime.sendMessage(message)).catch(() => ({ ok: false, code: 'offline' }));
    } catch {
      // Extension reloaded while the page stayed open.
      return Promise.resolve({ ok: false, code: 'reload', message: '扩展已更新，请刷新页面' });
    }
  }

  function evaluateRow(row) {
    const text = rowItemText(row);
    if (!text) return;
    let box = row.querySelector('.poe2a-box');
    if (!box) {
      box = document.createElement('div');
      box.className = 'poe2a-box';
      (row.querySelector('.right') || row).append(box);
    }
    box.replaceChildren(line('poe2a-head', 'PoE2 助手'), line('poe2a-muted', '正在试算…'));
    const price = rowPrice(row);
    send({ type: 'poe2-assistant-evaluate', item_text: text, price, language: LANGUAGE })
      .then((reply) => render(box, reply, () => evaluateRow(row)));
  }

  function scan(root) {
    for (const row of root.querySelectorAll('.resultset .row')) {
      if (row.hasAttribute(MARK)) continue;
      row.setAttribute(MARK, '');
      evaluateRow(row);
    }
  }

  globalThis.poe2Assistant = { rowItemText, rowPrice, describe, render, scan };

  if (globalThis.poe2AssistantNoAutoStart) return; // unit tests drive it themselves
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; scan(document); }, 200);
  }).observe(document.body, { childList: true, subtree: true });
  scan(document);
})();
