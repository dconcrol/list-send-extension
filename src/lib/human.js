/* Human-like pacing helpers for Gmail UI automation. */

(function (global) {
  function randInt(min, max) {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomDelay(minMs, maxMs) {
    return delay(randInt(minMs, maxMs));
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Preserve newlines for Gmail contenteditable (insertText drops \n). */
  function textToGmailHtml(text) {
    return escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
  }

  async function humanType(el, text, options = {}) {
    const value = String(text ?? '');
    const minKey = options.minKeyMs ?? 35;
    const maxKey = options.maxKeyMs ?? 120;
    const pauseEvery = options.pauseEvery ?? randInt(8, 18);

    el.focus();
    await randomDelay(120, 400);

    const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
    if (isEditable) {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertHTML', false, '');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
    } else if ('value' in el) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (isEditable) {
        if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && value[i + 1] === '\n') i += 1;
          document.execCommand('insertHTML', false, '<br>');
        } else {
          document.execCommand('insertText', false, ch);
        }
      } else if ('value' in el) {
        el.value += ch;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await randomDelay(minKey, maxKey);
      if (i > 0 && i % pauseEvery === 0) {
        await randomDelay(180, 520);
      }
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  async function setFieldValue(el, text, options = {}) {
    const value = String(text ?? '');
    const preferType = options.preferType === true && value.length <= 80 && !value.includes('\n');
    if (preferType) {
      await humanType(el, value, options);
      return;
    }

    el.focus();
    await randomDelay(100, 300);
    const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
    if (isEditable) {
      el.focus();
      document.execCommand('selectAll', false, null);
      const html = textToGmailHtml(value);
      const ok = document.execCommand('insertHTML', false, html);
      if (!ok || !String(el.innerText || el.textContent || '').trim()) {
        el.innerHTML = html;
        el.dispatchEvent(
          new InputEvent('input', { bubbles: true, data: value, inputType: 'insertFromPaste' })
        );
      }
    } else if ('value' in el) {
      const proto =
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (proto && proto.set) proto.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await randomDelay(200, 600);
  }

  /** Replace an input's value while matching Gmail's expected events. */
  async function replaceInputValue(el, text, options = {}) {
    const value = String(text ?? '');
    const commitEnter = options.commitEnter === true;
    el.focus();
    await randomDelay(80, 200);
    el.select?.();
    const proto =
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (proto && proto.set) proto.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertReplacementText' }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (commitEnter) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    }
    await randomDelay(150, 400);
  }

  global.CVListHuman = {
    randInt,
    delay,
    randomDelay,
    humanType,
    setFieldValue,
    replaceInputValue,
    textToGmailHtml
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
