import { useLayoutEffect, type RefObject } from 'react';

/** Reserve the visible space below the card for both answer states and navigation. */
export function useMobileStudyLayout(root: RefObject<HTMLDivElement | null>, hasCard: boolean) {
  useLayoutEffect(() => {
    const panel = root.current;
    const frame = panel?.querySelector<HTMLElement>(':scope > .card-frame');
    const answers = panel?.querySelector<HTMLElement>('.answer-area');
    if (!hasCard || !panel || !frame || !answers) return;
    const navigation = panel.closest('.app-shell')?.querySelector<HTMLElement>('.bottom-nav');
    const measure = () => {
      if (!window.matchMedia('(max-width: 760px)').matches) {
        panel.style.removeProperty('--mobile-study-card-height');
        return;
      }
      const card = frame.getBoundingClientRect(), controls = answers.getBoundingClientRect();
      const viewport = Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight);
      const navigationHeight = navigation?.getBoundingClientRect().height ?? 0;
      // Document coordinates keep the card stationary when the page is scrolled.
      const available = viewport - navigationHeight - 12 - (card.top + window.scrollY) - (controls.bottom - card.bottom);
      const height = `${Math.max(96, Math.min(290, Math.floor(available)))}px`;
      if (panel.style.getPropertyValue('--mobile-study-card-height') !== height) panel.style.setProperty('--mobile-study-card-height', height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    observer.observe(answers);
    if (panel.parentElement) observer.observe(panel.parentElement);
    if (navigation) observer.observe(navigation);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      panel.style.removeProperty('--mobile-study-card-height');
    };
  }, [root, hasCard]);
}
