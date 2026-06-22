import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluate } from './filterSpec';
const cases = JSON.parse(readFileSync(resolve(__dirname, '../../backend/tests/fixtures/filter_parity_cases.json'), 'utf8'));
describe('FilterSpec parity (JS)', () => {
  for (const cse of cases) it(cse.name, () => expect(evaluate(cse.task, cse.spec, cse.ctx)).toBe(cse.expected));
});
