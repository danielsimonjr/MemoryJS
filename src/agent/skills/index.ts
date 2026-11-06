/**
 * Recursa skill registry (RS-2/RS-3): `SkillManager`, the SKILL.md format,
 * and the atomic `SkillPublisher`. Barrel for `src/agent/skills/`.
 */
export {
  SkillManager,
  type AddSkillInput,
  type SkillPatch,
  type SkillListOptions,
  type SkillMatch,
  type SkillOutcome,
  type SkillUpdateResult,
  type SkillRetireResult,
  type SkillOutcomeResult,
  type SkillMatchOptions,
  type SkillContextOptions,
  type SkillSimilarityProvider,
} from './SkillManager.js';
export {
  SKILL_FRONT_MATTER_KEYS,
  loadOptionalYaml,
  serializeSkillMarkdown,
  parseSkillMarkdown,
  skillContentHash,
  renderSkillSection,
  fitSkillSectionToBudget,
  type ParsedSkillDocument,
  type SkillParseFailure,
  type SkillParseResult,
  type YamlModuleLike,
  type ParseSkillOptions,
} from './SkillFormat.js';
export {
  SkillPublisher,
  SKILL_MARKER_FILE,
  type PublishResult,
  type ImportConflict,
  type ImportParseError,
  type ImportReport,
  type PublishOptions,
  type SkillPublishMarker,
} from './SkillPublisher.js';
export {
  SKILL_KIND_VALUES,
  skillDedupHash,
  mintSkillId,
  skillObservations,
} from './skillRecordUtils.js';
export {
  recoverPublishedTree,
  removeBestEffort,
  pathExists,
  readConfinedSkillFile,
  type ConfinedRead,
} from './skillTreeFs.js';
