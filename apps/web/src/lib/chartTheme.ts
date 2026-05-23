import type { Theme } from '../state/themeContext.js';

export interface ChartTheme {
  axis: string;
  grid: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  /** Harmonized series palette (lime accent + supporting hues). */
  series: {
    lime: string;
    teal: string;
    amber: string;
    rose: string;
  };
}

const DARK: ChartTheme = {
  axis: 'rgba(245,245,240,0.45)',
  grid: 'rgba(245,245,240,0.08)',
  tooltipBg: '#14171a',
  tooltipBorder: 'rgba(245,245,240,0.18)',
  tooltipText: '#f5f5f0',
  series: { lime: '#98f46f', teal: '#5ed6a8', amber: '#f4b14f', rose: '#f4717a' },
};

const LIGHT: ChartTheme = {
  axis: 'rgba(30,47,28,0.55)',
  grid: 'rgba(30,47,28,0.10)',
  tooltipBg: '#ffffff',
  tooltipBorder: 'rgba(30,47,28,0.2)',
  tooltipText: '#14201a',
  series: { lime: '#4e9b2f', teal: '#0f9b6e', amber: '#b4791a', rose: '#dc2626' },
};

export function getChartTheme(theme: Theme): ChartTheme {
  return theme === 'light' ? LIGHT : DARK;
}

/** Shared <Tooltip> contentStyle for recharts. */
export function tooltipStyles(t: ChartTheme) {
  return {
    contentStyle: {
      background: t.tooltipBg,
      border: `1px solid ${t.tooltipBorder}`,
      borderRadius: 12,
      color: t.tooltipText,
      fontSize: 12,
      boxShadow: '0 10px 30px -12px rgba(0,0,0,0.5)',
    },
    labelStyle: { color: t.tooltipText, fontWeight: 600 },
    itemStyle: { color: t.tooltipText },
  };
}
