import { describe, it, expect, beforeEach, vi } from 'vitest';
import { wireOverflowMenu } from './overflow-menu';

function buildFixture() {
  document.body.innerHTML = `
    <div id="wrap">
      <button id="trigger" aria-expanded="false">⋮</button>
      <div id="menu" class="hidden"></div>
    </div>
    <button id="outside">outside</button>
  `;
  const wrap = document.getElementById('wrap')!;
  const trigger = document.getElementById('trigger')!;
  const menu = document.getElementById('menu')!;
  const outside = document.getElementById('outside')!;
  return { wrap, trigger, menu, outside };
}

describe('wireOverflowMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('toggles hidden + aria-expanded on trigger click', () => {
    const { wrap, trigger, menu } = buildFixture();
    wireOverflowMenu(wrap, trigger, menu);

    expect(menu.classList.contains('hidden')).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    trigger.click();
    expect(menu.classList.contains('hidden')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    trigger.click();
    expect(menu.classList.contains('hidden')).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on outside click', () => {
    const { wrap, trigger, menu, outside } = buildFixture();
    wireOverflowMenu(wrap, trigger, menu);
    trigger.click();
    expect(menu.classList.contains('hidden')).toBe(false);

    outside.click();
    expect(menu.classList.contains('hidden')).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('inside-wrap clicks do not close (caller controls action handlers)', () => {
    const { wrap, trigger, menu } = buildFixture();
    menu.innerHTML = '<button id="action">Block</button>';
    wireOverflowMenu(wrap, trigger, menu);
    trigger.click();
    expect(menu.classList.contains('hidden')).toBe(false);

    document.getElementById('action')!.click();
    expect(menu.classList.contains('hidden')).toBe(false);
  });

  it('Esc closes the menu', () => {
    const { wrap, trigger, menu } = buildFixture();
    wireOverflowMenu(wrap, trigger, menu);
    trigger.click();
    expect(menu.classList.contains('hidden')).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.classList.contains('hidden')).toBe(true);
  });

  it('fires onOpen / onClose callbacks', () => {
    const { wrap, trigger, menu } = buildFixture();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    wireOverflowMenu(wrap, trigger, menu, { onOpen, onClose });

    trigger.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    trigger.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('teardown unbinds doc listeners and trigger handler', () => {
    const { wrap, trigger, menu, outside } = buildFixture();
    const teardown = wireOverflowMenu(wrap, trigger, menu);
    trigger.click();
    expect(menu.classList.contains('hidden')).toBe(false);

    teardown();

    // After teardown: outside click no longer closes (doc listener gone).
    outside.click();
    expect(menu.classList.contains('hidden')).toBe(false);

    // Trigger click no longer toggles.
    trigger.click();
    expect(menu.classList.contains('hidden')).toBe(false);

    // Esc no longer closes.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.classList.contains('hidden')).toBe(false);
  });
});
