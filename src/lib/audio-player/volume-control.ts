import { getStoredVolume, setStoredVolume } from './registry';
import type { AudioPlayerSize } from './types';

const SPEAKER_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3 10v4a1 1 0 001 1h3l4 4V5L7 9H4a1 1 0 00-1 1zm13.5 2a4.5 4.5 0 00-2.5-4.03v8.05A4.5 4.5 0 0016.5 12z"/></svg>`;

function buildSlider(): HTMLInputElement {
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '1';
  range.step = '0.01';
  range.value = String(getStoredVolume());
  range.setAttribute('aria-label', 'Volume');
  range.style.cssText = 'width:80px;accent-color:#10b981;cursor:pointer;';
  range.addEventListener('input', () => {
    setStoredVolume(parseFloat(range.value));
  });
  return range;
}

function buildIconButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.volumeToggle = '1';
  btn.setAttribute('aria-label', 'Volume');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = SPEAKER_ICON;
  btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;color:currentColor;background:transparent;border:none;cursor:pointer;';
  return btn;
}

export function mountVolumeControl(host: HTMLElement, size: AudioPlayerSize): void {
  if (size === 'xs') return;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:inline-flex;align-items:center;gap:6px;color:#71717a;';
  host.appendChild(wrapper);

  if (size === 'md' || size === 'lg') {
    const icon = document.createElement('span');
    icon.innerHTML = SPEAKER_ICON;
    icon.style.cssText = 'display:inline-flex;align-items:center;';
    wrapper.appendChild(icon);
    wrapper.appendChild(buildSlider());
    return;
  }

  const btn = buildIconButton();
  wrapper.appendChild(btn);

  let popover: HTMLDivElement | null = null;
  const close = () => {
    popover?.remove();
    popover = null;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick, true);
  };
  const onDocClick = (e: MouseEvent) => {
    if (popover && !popover.contains(e.target as Node) && e.target !== btn) close();
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popover) { close(); return; }
    popover = document.createElement('div');
    popover.style.cssText = 'position:absolute;bottom:calc(100% + 4px);right:0;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:50;';
    popover.appendChild(buildSlider());
    wrapper.appendChild(popover);
    btn.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
  });
}
