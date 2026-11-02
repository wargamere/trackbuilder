/**
 * Every piece of UI text lives here so the game can be translated later.
 * Placeholders like {len} are filled in by `fmt()`.
 */
export const STR = {
  /** Working title — change it here and it updates everywhere. */
  gameName: 'Ink Circuit',
  tagline: 'Draw it. Race it. Waste no ink.',

  buttons: {
    drawTrack: 'Draw your track',
    raceIt: 'Race it',
    undo: 'Undo',
    clear: 'Clear',
    sample: 'Sample',
    back: 'Back',
    resume: 'Resume',
  },

  editor: {
    ink: 'Ink',
    inkLeft: '{pct}%',
    multiplier: '×{mult}',
    multiplierLabel: 'Score multiplier',
    multiplierProjected: 'from ink so far · corners count on release',
    multiplierBreakdown: 'ink ×{ink} + {corners} tight corners ×{bonus}',
    hint: 'Draw one loop in a single stroke. Finish near the flag to close it.',
    hintInk: 'Every metre costs ink. Ink you save and tight corners raise your score multiplier.',
    drawing: 'Keep going… come back to the flag to close the loop.',
    releaseToClose: 'Release to close the loop!',
    outOfInk: 'Out of ink! Release to finish.',
    customName: 'My Track',
    ready: '{len} m · {corners} tight corners — ready to race!',
    sampleLoaded: 'Sample track: {name}',
    cleared: 'Fresh page. Draw a loop!',
    undone: 'Undone.',
    errors: {
      'too-short': 'That loop is a bit small. Draw a bigger one!',
      'not-closed': 'Almost! Bring your line back to the flag to close the loop.',
      'not-closed-ink': 'You ran out of ink before closing the loop. Try a tighter design!',
      crossing: 'Tracks can’t cross themselves (no bridges here). Try again!',
      'too-close': 'Two parts of the track are too close together. Give them more room.',
      'too-tight': 'One corner is too tight to drive. Make it a little rounder.',
    },
    keys: { undo: 'Z', clear: 'C', sample: 'S', race: 'Enter', back: 'Esc' },
  },

  race: {
    previewNote: 'Phase 1 preview — the 3D race arrives in Phase 2–4.',
    trackInfo: '{name} · {len} m · ×{mult}',
  },

  samples: ['Sunday Loop', 'Paperclip', 'Knot Garden'],
} as const;

/** Fills `{name}` placeholders. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}
