import type { CardViewModel } from './observe-card-vm';
import { cardActions, type CardAction } from './observe-card-actions';

export interface CardStrings {
  analyzing: string;
  savedPrefix: string;
  bestGuess: string;
  lowConfidence: string;
  improvedByCloud: string;
  yourId: string;
  cloudSuggests: string;
  unidentified: string;
  willIdentifyOnSync: string;
  viewTrace: string;
  provenanceDevice: string;
  provenanceCloud: string;
  provenanceCommunity: string;
  actionAffirm: string;
  actionOther: string;
  actionReview: string;
  actionAdopt: string;
  actionDismiss: string;
  reviewRequestedAck: string;
}

function esc(raw: string | null): string {
  if (raw === null) return '';
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function traceBtn(label: string): string {
  return `<button type="button" data-card-trace class="underline text-xs">${label}</button>`;
}

function actionBtn(action: CardAction, label: string, primary: boolean): string {
  const cls = primary
    ? 'rounded-md bg-emerald-600 text-white text-xs px-2 py-1'
    : 'rounded-md border border-zinc-300 dark:border-zinc-600 text-xs px-2 py-1';
  return `<button type="button" data-card-action="${action}" class="${cls}">${esc(label)}</button>`;
}

function actionsRow(vm: CardViewModel, s: CardStrings): string {
  const acts = cardActions(vm.state);
  if (acts.length === 0) return '';
  const parts: string[] = [];
  for (const a of acts) {
    if (a === 'review' && vm.reviewRequested) {
      parts.push(`<span data-card-review-ack class="text-xs text-amber-700 dark:text-amber-400">${esc(s.reviewRequestedAck)}</span>`);
      continue;
    }
    const label =
      a === 'affirm' ? s.actionAffirm :
      a === 'other'  ? s.actionOther  :
      a === 'review' ? s.actionReview :
      a === 'adopt'  ? s.actionAdopt  :
      s.actionDismiss;
    parts.push(actionBtn(a, label, a === 'affirm' || a === 'adopt'));
  }
  return `<div class="flex flex-wrap items-center gap-2 mt-2" data-card-actions>${parts.join(' ')}</div>`;
}

function provenanceStrip(s: CardStrings): string {
  return `<span class="text-xs text-zinc-500 dark:text-zinc-400">${s.provenanceDevice} → ${s.provenanceCloud} → ${s.provenanceCommunity}</span>`;
}

function renderS0(s: CardStrings): string {
  return `<p class="text-sm text-zinc-500 dark:text-zinc-400">${s.analyzing} <span class="animate-pulse">⟳</span></p>`;
}

function renderS1a(vm: CardViewModel, s: CardStrings): string {
  const h = esc(vm.headline);
  const sl = esc(vm.sourceLabel);
  return `<p class="font-semibold italic">${h}</p>
<p class="text-emerald-700 dark:text-emerald-300 text-xs">✓ ${s.savedPrefix} · ${sl} · ${traceBtn(s.viewTrace)}</p>`;
}

function renderS1b(vm: CardViewModel, s: CardStrings): string {
  const h = esc(vm.headline);
  return `<p class="font-semibold italic text-amber-700 dark:text-amber-400">¿${h}?</p>
<p class="text-amber-700 dark:text-amber-400 text-xs">⚠ ${s.bestGuess} · ${s.lowConfidence}</p>
<div class="flex items-center gap-1 mt-1">${provenanceStrip(s)} ${traceBtn(s.viewTrace)}</div>`;
}

function renderS2(vm: CardViewModel, s: CardStrings): string {
  const h = esc(vm.headline);
  const sl = esc(vm.sourceLabel);
  return `<p class="font-semibold italic">${h}</p>
<p class="text-emerald-700 dark:text-emerald-300 text-xs">↑ ${s.improvedByCloud} · ${sl} · ${traceBtn(s.viewTrace)}</p>`;
}

function renderS2prime(vm: CardViewModel, s: CardStrings): string {
  const h = esc(vm.headline);
  return `<p class="font-semibold italic">${h} <span class="text-emerald-600 dark:text-emerald-400 text-xs">— ${s.yourId} ✓</span></p>
<div data-card-cloud-suggestion class="rounded-md border border-zinc-200 dark:border-zinc-700 p-2 mt-1 text-xs text-zinc-600 dark:text-zinc-300">${s.cloudSuggests}</div>`;
}

function renderS3(s: CardStrings): string {
  return `<p class="font-medium">${s.unidentified}</p>
<p class="text-xs text-zinc-500 dark:text-zinc-400">${s.willIdentifyOnSync}</p>`;
}

export function renderProgressiveCardHtml(vm: CardViewModel, s: CardStrings): string {
  let inner: string;
  switch (vm.state) {
    case 'S0':      inner = renderS0(s); break;
    case 'S1a':     inner = renderS1a(vm, s); break;
    case 'S1b':     inner = renderS1b(vm, s); break;
    case 'S2':      inner = renderS2(vm, s); break;
    case 'S2prime': inner = renderS2prime(vm, s); break;
    case 'S3':      inner = renderS3(s); break;
  }
  const actions = actionsRow(vm, s);
  return `<div data-card-state="${vm.state}" class="observe-card p-3 rounded-lg bg-white dark:bg-zinc-800 shadow-sm">${inner}${actions}</div>`;
}
