/**
 * Shared env-number bounds for the ManagerContext facades.
 *
 * @module core/context/envBounds
 * @internal
 */

import type { EnvNumberBounds } from '../../utils/envConfig.js';

/** Inclusive `[0, 1]` range shared by every probability and weight knob. @internal */
export const PROBABILITY: EnvNumberBounds = { min: 0, max: 1 };
