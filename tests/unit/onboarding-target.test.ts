import { describe, it, expect, beforeEach } from 'vitest';
import { isDisplayed, resolveFirstVisible } from '../../src/lib/onboarding-target';

describe('isDisplayed', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('returns true for an element rendered in the DOM', () => {
    const el = document.createElement('div');
    el.id = 'visible';
    document.body.appendChild(el);
    expect(isDisplayed(el)).toBe(true);
  });

  it('returns false when an ancestor is display:none', () => {
    const parent = document.createElement('nav');
    parent.style.display = 'none';
    const child = document.createElement('a');
    parent.appendChild(child);
    document.body.appendChild(parent);
    expect(isDisplayed(child)).toBe(false);
  });
});

describe('resolveFirstVisible', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('returns null when no parts match anything in the DOM', () => {
    expect(resolveFirstVisible('[data-tour="ghost"]')).toBeNull();
  });

  it('returns the element when a single selector matches and is visible', () => {
    const el = document.createElement('a');
    el.setAttribute('data-tour', 'observe-nav');
    document.body.appendChild(el);
    expect(resolveFirstVisible('[data-tour="observe-nav"]')).toBe(el);
  });

  it('falls through to second selector when first matches a hidden element', () => {
    // Mirrors the production bug: FAB inside a `sm:hidden` parent on desktop.
    const hiddenParent = document.createElement('nav');
    hiddenParent.style.display = 'none';
    const fab = document.createElement('a');
    fab.setAttribute('data-tour', 'fab');
    hiddenParent.appendChild(fab);
    document.body.appendChild(hiddenParent);

    const visibleNav = document.createElement('a');
    visibleNav.setAttribute('data-tour', 'observe-nav');
    document.body.appendChild(visibleNav);

    const out = resolveFirstVisible('[data-tour="fab"],[data-tour="observe-nav"]');
    expect(out).toBe(visibleNav);
  });

  it('returns null when first matches a hidden element and second does not match', () => {
    const hiddenParent = document.createElement('nav');
    hiddenParent.style.display = 'none';
    const fab = document.createElement('a');
    fab.setAttribute('data-tour', 'fab');
    hiddenParent.appendChild(fab);
    document.body.appendChild(hiddenParent);

    expect(resolveFirstVisible('[data-tour="fab"],[data-tour="observe-nav"]')).toBeNull();
  });
});
