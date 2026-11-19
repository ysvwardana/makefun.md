import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMasterMarkdown } from '../src/lib/prompt-builder.ts';
import { downloadMarkdownFile } from '../src/lib/utils.ts';

// Export uses Blob with the existing string; no normalization, trim, or platform newline conversion.
test('Markdown export preserves exact Part 1 including mixed line endings and edge whitespace', async () => {
  const part1 = ' \t\r\nExact — source\r\n\ntrailing \t ';
  const markdown = buildMasterMarkdown({ bountyTitle: 'B', bountySlug: 'b', bountyUrl: 'https://make.fun/bounty/b',
    part1OriginalPrompt: part1, part2AiEnhancement: 'Strategy', part3ExecutionGuidelines: 'Verify', founderInstructions: '' });
  const start = markdown.indexOf('## PART 1 — ORIGINAL MAKE.FUN PROMPT\n\n') + '## PART 1 — ORIGINAL MAKE.FUN PROMPT\n\n'.length;
  assert.equal(markdown.slice(start, start + part1.length), part1);
  const previousDocument = globalThis.document;
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  let exported!: Blob;
  const anchor = { href: '', download: '', click() {} };
  Object.assign(globalThis, { document: { createElement: () => anchor, body: { appendChild() {}, removeChild() {} } } });
  URL.createObjectURL = (blob: Blob) => { exported = blob; return 'blob:fixture'; };
  URL.revokeObjectURL = () => {};
  try {
    downloadMarkdownFile('b.md', markdown);
    assert.equal(await exported.text(), markdown);
  } finally {
    Object.assign(globalThis, { document: previousDocument });
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  }
});
