import type { Settings } from '../types';

type Rgb = [number, number, number];
type TabAppearance = Pick<Settings, 'accent' | 'skin' | 'theme'>;

function rgb(hex: string): Rgb {
  const value = /^#[\da-f]{6}$/i.test(hex) ? hex.slice(1)
    : /^#[\da-f]{3}$/i.test(hex) ? [...hex.slice(1)].map(char => char + char).join('')
      : '3a3632';
  return [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16)) as Rgb;
}

function luminance(color: Rgb): number {
  const linear = color.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function readableInk(background: Rgb): string {
  const light = luminance(background);
  const ratio = (ink: string) => {
    const text = luminance(rgb(ink));
    return (Math.max(light, text) + 0.05) / (Math.min(light, text) + 0.05);
  };
  // Keep the normal warm ink where it meets small-text contrast; use black
  // for midtone backgrounds where neither warm ink nor white reaches 4.5:1.
  const darkRatio = ratio('#24211e');
  const whiteRatio = ratio('#ffffff');
  if (darkRatio >= 4.5 && darkRatio >= whiteRatio) return '#24211e';
  return whiteRatio >= 4.5 ? '#ffffff' : '#000000';
}

export function getTabTextColor({ accent }: TabAppearance): string {
  return readableInk(rgb(accent));
}
