import { describe, it, expect } from 'vitest';
import { HABITATS, WEATHERS, ESTABLISHMENT_MEANS, labelFor } from './observation-enums';

describe('observation-enums', () => {
  it('habitat list is stable (snapshot)', () => {
    expect(HABITATS).toMatchInlineSnapshot(`
      [
        "forest_pine_oak",
        "forest_oak",
        "forest_pine",
        "tropical_evergreen",
        "tropical_subevergreen",
        "cloud_forest",
        "tropical_dry_forest",
        "xerophytic",
        "scrubland",
        "riparian",
        "wetland",
        "grassland",
        "agricultural",
        "urban",
        "coastal",
        "reef",
        "cave",
      ]
    `);
  });

  it('weather list is stable (snapshot)', () => {
    expect(WEATHERS).toMatchInlineSnapshot(`
      [
        "sunny",
        "cloudy",
        "overcast",
        "light_rain",
        "heavy_rain",
        "fog",
        "storm",
      ]
    `);
  });

  it('establishment_means list is stable (snapshot)', () => {
    expect(ESTABLISHMENT_MEANS).toMatchInlineSnapshot(`
      [
        "wild",
        "cultivated",
        "captive",
        "uncertain",
      ]
    `);
  });

  describe('labelFor', () => {
    const tree = {
      habitat_options: { cloud_forest: 'Cloud forest', wetland: 'Wetland' },
      weather_options: { sunny: 'Sunny' },
      establishment_means_options: { wild: 'Wild' },
    };

    it('returns the localized label when present', () => {
      expect(labelFor(tree, 'habitat_options', 'cloud_forest')).toBe('Cloud forest');
      expect(labelFor(tree, 'weather_options', 'sunny')).toBe('Sunny');
      expect(labelFor(tree, 'establishment_means_options', 'wild')).toBe('Wild');
    });

    it('falls back to a humanized key when missing', () => {
      expect(labelFor(tree, 'habitat_options', 'forest_pine_oak')).toBe('forest pine oak');
      expect(labelFor({}, 'habitat_options', 'cloud_forest')).toBe('cloud forest');
    });

    it('handles non-object trees gracefully', () => {
      expect(labelFor(null, 'habitat_options', 'cave')).toBe('cave');
      expect(labelFor(undefined, 'weather_options', 'fog')).toBe('fog');
    });
  });
});
