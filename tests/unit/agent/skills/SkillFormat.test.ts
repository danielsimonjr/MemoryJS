/**
 * SKILL.md subset codec (RS-3): round-trip, body escaping, rejected constructs
 * and the full-YAML path (via an injected parser, since `yaml` is an optional peer).
 */
import { describe, it, expect } from 'vitest';
import {
  loadOptionalYaml,
  parseSkillMarkdown,
  serializeSkillMarkdown,
  skillContentHash,
  type YamlModuleLike,
} from '../../../../src/agent/skills/SkillFormat.js';
import type { SkillRecord } from '../../../../src/types/skills.js';

type Writable = Pick<SkillRecord, 'name' | 'description' | 'kind' | 'scope' | 'uncertainty' | 'sources' | 'resources' | 'lineage' | 'body'>;

const SKILL: Writable = {
  name: 'Release "notes" checker',
  description: 'Use when preparing a release:\nmulti-line description with a colon',
  kind: 'procedure',
  scope: { domains: ['release', 'docs'], tasks: ['write changelog'] },
  uncertainty: 0.25,
  sources: [{ ref: 'doc:changelog-policy', kind: 'document', excerpt: 'Keep a changelog' }],
  resources: [{ name: 'check.sh', ref: 'scripts/check.sh', kind: 'script' }],
  lineage: { revisionId: 'revision-abc123' },
  body: [
    '# Steps',
    '1. Read the changelog.',
    '---',
    '\\---',
    'A line with --- inside text',
    '',
  ].join('\n'),
};

describe('SkillFormat: round-trip', () => {
  it('parses what it serialized, including a --- line and a \\--- line in the body', () => {
    const text = serializeSkillMarkdown(SKILL);
    const result = parseSkillMarkdown(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe(SKILL.name);
    expect(result.value.description).toBe(SKILL.description);
    expect(result.value.kind).toBe('procedure');
    expect(result.value.scope).toEqual(SKILL.scope);
    expect(result.value.uncertainty).toBe(0.25);
    expect(result.value.sources).toEqual(SKILL.sources);
    expect(result.value.resources).toEqual(SKILL.resources);
    expect(result.value.lineage).toEqual(SKILL.lineage);
    expect(result.value.body).toBe(SKILL.body);
    expect(result.value.extra).toBeUndefined();
  });

  it('is byte-stable: serializing the parsed document again yields the same text', () => {
    const text = serializeSkillMarkdown(SKILL);
    const parsed = parseSkillMarkdown(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const again = serializeSkillMarkdown({ ...parsed.value });
    expect(again).toBe(text);
    expect(skillContentHash(again)).toBe(skillContentHash(text));
  });

  it('escapes a body line that is exactly --- and unescapes it on parse', () => {
    const text = serializeSkillMarkdown({ ...SKILL, body: '---\n' });
    expect(text.split('\n')).toContain('\\---');
    const parsed = parseSkillMarkdown(text);
    expect(parsed.ok && parsed.value.body).toBe('---\n');
  });

  it('omits empty optional lists and lineage, and writes empty lists as []', () => {
    const text = serializeSkillMarkdown({
      ...SKILL,
      scope: { domains: ['only'] },
      sources: [],
      resources: [],
      lineage: {},
    });
    expect(text).toContain('scope.domains:\n  - "only"');
    expect(text).toContain('sources: []');
    expect(text).toContain('resources: []');
    expect(text).not.toContain('lineage');
    expect(text).not.toContain('scope.tasks');
    const parsed = parseSkillMarkdown(text);
    expect(parsed.ok && parsed.value.scope).toEqual({ domains: ['only'] });
  });

  it('does not write extra keys', () => {
    const text = serializeSkillMarkdown({ ...SKILL });
    expect(text).not.toContain('allowed-tools');
  });
});

describe('SkillFormat: rejected constructs', () => {
  const doc = (frontMatter: string, body = 'body\n') => `---\n${frontMatter}\n---\n${body}`;
  const base = [
    'name: "x"',
    'description: "d"',
    'kind: "tool"',
    'scope.domains:',
    '  - "a"',
    'uncertainty: 0.5',
  ].join('\n');

  it('accepts the minimal valid front matter', () => {
    const parsed = parseSkillMarkdown(doc(base));
    expect(parsed.ok).toBe(true);
  });

  it('rejects a file that does not start with ---', () => {
    const parsed = parseSkillMarkdown('name: x\n');
    expect(parsed).toMatchObject({ ok: false, line: 1 });
  });

  it('rejects an unclosed front matter block', () => {
    const parsed = parseSkillMarkdown('---\nname: "x"\n');
    expect(parsed).toMatchObject({ ok: false, line: 1 });
    expect(parsed.ok ? '' : parsed.reason).toMatch(/not closed/);
  });

  it('rejects a comment and names the line', () => {
    const parsed = parseSkillMarkdown(doc(`${base}\n# a comment`));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.line).toBe(8);
    expect(parsed.reason).toMatch(/comments are not supported/);
  });

  it('rejects a block scalar and names it as the unsupported construct', () => {
    const parsed = parseSkillMarkdown(doc(base.replace('description: "d"', 'description: |')));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/block scalar/);
    expect(parsed.reason).toMatch(/description/);
  });

  it('rejects a nested mapping', () => {
    const parsed = parseSkillMarkdown(doc(`${base}\nlineage:\n  revisionId: "r"`));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/indented or nested YAML/);
  });

  it('rejects an unknown key on the subset path and names it', () => {
    const parsed = parseSkillMarkdown(doc(`${base}\nallowed-tools: "Bash"`));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain('unknown front-matter key "allowed-tools"');
  });

  it('rejects a duplicate key', () => {
    const parsed = parseSkillMarkdown(doc(`${base}\nkind: "tool"`));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/duplicate front-matter key "kind"/);
  });

  it('rejects a bare key with no list items and asks for []', () => {
    const parsed = parseSkillMarkdown(doc(`${base}\nsources:`));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/sources: \[\]/);
  });

  it('rejects a value that is not a JSON scalar, such as an unquoted string', () => {
    const parsed = parseSkillMarkdown(doc(base.replace('kind: "tool"', 'kind: tool')));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/only JSON values are accepted/);
  });

  it('rejects an invalid kind, an out-of-range uncertainty, and a missing scope.domains', () => {
    const badKind = parseSkillMarkdown(doc(base.replace('"tool"', '"magic"')));
    expect(badKind.ok ? '' : badKind.reason).toMatch(/"kind" must be one of/);
    const badUncertainty = parseSkillMarkdown(doc(base.replace('0.5', '2')));
    expect(badUncertainty.ok ? '' : badUncertainty.reason).toMatch(/"uncertainty" must be a number/);
    const noDomains = parseSkillMarkdown(doc(base.replace('  - "a"', '').replace('scope.domains:', 'scope.tasks: []')));
    expect(noDomains.ok ? '' : noDomains.reason).toMatch(/"scope.domains" must be a list/);
  });

  it('rejects a name longer than 80 characters', () => {
    const parsed = parseSkillMarkdown(doc(base.replace('name: "x"', `name: "${'n'.repeat(81)}"`)));
    expect(parsed.ok ? '' : parsed.reason).toMatch(/at most 80 characters/);
  });

  it('rejects malformed source objects', () => {
    const parsed = parseSkillMarkdown(doc(`${base}\nsources:\n  - {"ref":"r","kind":"bogus"}`));
    expect(parsed.ok ? '' : parsed.reason).toMatch(/"sources" must be a list/);
  });
});

describe('SkillFormat: full-YAML path (injected parser)', () => {
  // A stand-in parser that accepts JSON, which is a YAML subset. It proves the
  // full-YAML branch maps known keys, nests scope and keeps unknown keys in extra.
  const jsonYaml: YamlModuleLike = { parse: (text) => JSON.parse(text) };
  const fileText = [
    '---',
    JSON.stringify({
      name: 'Harness skill',
      description: 'Use with the harness',
      kind: 'tool',
      scope: { domains: ['ops'], tools: ['Bash'] },
      uncertainty: 0.1,
      'allowed-tools': ['Bash(git status:*)'],
    }),
    '---',
    'Body text',
    '',
  ].join('\n');

  it('keeps unknown harness keys in extra and nests scope', () => {
    const parsed = parseSkillMarkdown(fileText, { yaml: jsonYaml });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.scope).toEqual({ domains: ['ops'], tools: ['Bash'] });
    expect(parsed.value.extra).toEqual({ 'allowed-tools': ['Bash(git status:*)'] });
    expect(parsed.value.body).toBe('Body text\n');
  });

  it('reports a YAML parse error with line 2 and a reason', () => {
    const broken: YamlModuleLike = { parse: () => { throw new Error('bad indent'); } };
    const parsed = parseSkillMarkdown(fileText, { yaml: broken });
    expect(parsed).toMatchObject({ ok: false, line: 2 });
    expect(parsed.ok ? '' : parsed.reason).toContain('bad indent');
  });

  it('rejects front matter that is not a mapping', () => {
    const scalar: YamlModuleLike = { parse: () => 'just text' };
    const parsed = parseSkillMarkdown(fileText, { yaml: scalar });
    expect(parsed.ok ? '' : parsed.reason).toMatch(/must be a YAML mapping/);
  });
});

describe('SkillFormat: optional yaml loader', () => {
  it('resolves to undefined or to a module with a parse function, never throws', async () => {
    const mod = await loadOptionalYaml();
    expect(mod === undefined || typeof mod.parse === 'function').toBe(true);
  });
});
