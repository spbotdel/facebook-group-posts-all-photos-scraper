import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), '.actor');
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

const collect = (node, prefix = '', out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (node.properties) {
    for (const [key, value] of Object.entries(node.properties)) {
      const full = prefix ? `${prefix}.${key}` : key;
      out.push({ name: full, value });
      collect(value, full, out);
    }
  }
  for (const key of ['items', 'additionalProperties']) {
    if (node[key] && typeof node[key] === 'object') collect(node[key], `${prefix}[${key}]`, out);
  }
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(node[key])) node[key].forEach((child, i) => collect(child, `${prefix}[${key}:${i}]`, out));
  }
  return out;
};

test('dataset schema describes every field', () => {
  const schema = read('dataset_schema.json');
  assert.ok(schema.fields, 'dataset schema has fields object');
  assert.equal(schema.fields.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.fields.type, 'object');
  const fields = collect(schema.fields);
  assert.ok(fields.length > 0, 'dataset schema has fields');
  const missing = fields.filter(({ value }) => !value.description?.trim()).map(({ name }) => name);
  assert.deepEqual(missing, [], `fields without description: ${missing.join(', ')}`);
});

test('input schema describes every field and required fields exist', () => {
  const schema = read('input_schema.json');
  const fields = collect(schema);
  const missing = fields.filter(({ value }) => !value.description?.trim()).map(({ name }) => name);
  assert.deepEqual(missing, [], `inputs without description: ${missing.join(', ')}`);
  for (const key of schema.required ?? []) {
    assert.ok(schema.properties?.[key], `required field ${key} is declared`);
  }
});

test('output schema describes every link and uses Apify templates', () => {
  const schema = read('output_schema.json');
  assert.equal(schema.actorOutputSchemaVersion, 1);
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    assert.ok(value.description?.trim(), `output ${key} has a description`);
    assert.match(
      value.template,
      /^\{\{links\.(apiDefaultDatasetUrl|apiDefaultKeyValueStoreUrl|apiRunUrl|publicRunUrl|consoleRunUrl)\}\}/,
      `output ${key} uses a known links variable`,
    );
  }
});
