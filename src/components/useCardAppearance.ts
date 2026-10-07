import { useLayoutEffect, useState, type RefObject } from 'react';
import { DEFAULT_CARD_APPEARANCE, normalizeCardFontSize, type CardAppearance } from './cardAppearance';

export function useCardAppearance(frame: RefObject<HTMLDivElement | null>): CardAppearance {
  const [appearance, setAppearance] = useState(DEFAULT_CARD_APPEARANCE);
  useLayoutEffect(() => {
    const shell = frame.current?.closest<HTMLElement>('.app-shell') || document.documentElement;
    const fontScope = frame.current?.closest<HTMLElement>('[data-card-font-size-preview]') || shell;
    const read = () => {
      const style = getComputedStyle(shell), fallback = DEFAULT_CARD_APPEARANCE.colors;
      const color = (name: string, defaultColor: string) => style.getPropertyValue(name).trim() || defaultColor;
      const skin = 'classic';
      const fontSize = normalizeCardFontSize(parseFloat(getComputedStyle(fontScope).getPropertyValue('--card-font-size')));
      const next: CardAppearance = { skin, dark: shell.classList.contains('theme-dark'), fontSize, colors: {
        paper: color('--card-bg', fallback.paper), surface: color('--surface-bg', fallback.surface), text: color('--text', fallback.text),
        muted: color('--muted', fallback.muted), line: color('--line', fallback.line), accent: color('--accent', fallback.accent),
      } };
      setAppearance(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    read();
    const observer = new MutationObserver(read); observer.observe(shell, { attributes: true, attributeFilter: ['class', 'style'] });
    if (fontScope !== shell) observer.observe(fontScope, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, [frame]);
  return appearance;
}
