/** Game-wide constants that are meant to be easy to change in one place. */

/** Placeholder title. Rename the game here. */
export const GAME_TITLE = 'Battle Sim';

/**
 * Team colours. Chosen to differ in brightness as well as hue so they stay
 * distinguishable for colour-blind players and in fog: blue is dark, red is light.
 */
export const TEAM_COLORS = {
  blue: 0x2f5bd3,
  red: 0xff7148,
} as const;

/** CSS versions of the team colours for the UI. */
export const TEAM_CSS = {
  blue: '#2f5bd3',
  red: '#ff7148',
} as const;

export const TEAM_BLUE = 0;
export const TEAM_RED = 1;
