/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  safelist: [
    'text-emerald-600', 'dark:text-emerald-400', 'after:bg-emerald-500',
    'text-teal-600',    'dark:text-teal-400',    'after:bg-teal-500',
    'text-sky-600',     'dark:text-sky-400',     'after:bg-sky-500',
    'text-stone-600',   'dark:text-stone-400',   'after:bg-stone-500',
    'text-slate-600',   'dark:text-slate-300',   'after:bg-slate-500',
    'border-slate-500', 'bg-slate-100',          'dark:bg-slate-800/40',
    'after:scale-x-0', 'after:scale-x-100',
    // Seasonal theme (issue #731). The custom classes are defined in
    // BaseLayout's inline <style is:global>; safelisting protects them
    // from JIT purging in production builds.
    'rastrum-season-illustration',
    'rastrum-season-accent',
    'rastrum-season-accent-bg',
    'rastrum-season-accent-border',
    'ring-2', 'ring-4',
    'ring-emerald-500', 'ring-teal-500', 'ring-amber-500',
    'ring-sky-500', 'ring-yellow-400', 'ring-fuchsia-500',
    'ring-offset-2', 'ring-offset-white', 'dark:ring-offset-zinc-900',
    'shadow-[0_0_12px_rgba(250,204,21,0.6)]',
    'shadow-[0_0_16px_rgba(217,70,239,0.7)]',
    'motion-safe:animate-pulse',
    'motion-safe:animate-rastrum-legend-spin',
  ],
  theme: {
    extend: {
      keyframes: {
        'rastrum-legend-spin': {
          '0%, 100%': {
            'box-shadow': '0 0 12px rgba(217, 70, 239, 0.55), 0 0 22px rgba(168, 85, 247, 0.35)',
          },
          '50%': {
            'box-shadow': '0 0 18px rgba(217, 70, 239, 0.85), 0 0 28px rgba(168, 85, 247, 0.55)',
          },
        },
      },
      animation: {
        'rastrum-legend-spin': 'rastrum-legend-spin 3.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
