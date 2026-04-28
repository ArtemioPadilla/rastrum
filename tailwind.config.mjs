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
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
