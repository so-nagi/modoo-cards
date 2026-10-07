import test from 'node:test';
import assert from 'node:assert/strict';
import { getTabTextColor } from '../../src/features/themeContrast.ts';

test('bright and dark accents get readable active-tab ink in every theme', () => {
  for (const theme of ['light', 'neutral', 'dark'] as const) {
    for (const skin of ['classic'] as const) {
      assert.equal(getTabTextColor({ skin, theme, accent: '#c5cfd8' }), '#24211e');
      assert.equal(getTabTextColor({ skin, theme, accent: '#3a3632' }), '#ffffff');
      assert.equal(getTabTextColor({ skin, theme, accent: '#ffff00' }), '#24211e');
    }
  }
});

test('solid tab fills meet 4.5:1 contrast across a representative RGB gamut', () => {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/../g)!.map(value => Number.parseInt(value, 16) / 255)
      .map(value => value > 0.04045 ? ((value + 0.055) / 1.055) ** 2.4 : value / 12.92);
    return channels.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  };
  for (let red = 0; red <= 255; red += 51) {
    for (let green = 0; green <= 255; green += 51) {
      for (let blue = 0; blue <= 255; blue += 51) {
        const accent = `#${[red, green, blue].map(value => value.toString(16).padStart(2, '0')).join('')}`;
        const text = getTabTextColor({ skin: 'classic', theme: 'light', accent });
        const values = [luminance(accent), luminance(text)].sort((a, b) => a - b);
        assert.ok((values[1] + 0.05) / (values[0] + 0.05) >= 4.5, `${accent} / ${text}`);
      }
    }
  }
});

test('short hex and invalid saved colors have deterministic fallbacks', () => {
  assert.equal(getTabTextColor({ skin: 'classic', theme: 'light', accent: '#fff' }), '#24211e');
  assert.equal(getTabTextColor({ skin: 'classic', theme: 'light', accent: 'invalid' }), '#ffffff');
});
