import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'docs', 'n8n', 'group-to-google-sheets-slack.json');
const workflow = JSON.parse(fs.readFileSync(file, 'utf8'));

test('n8n workflow is inactive and has a unique node graph', () => {
  assert.equal(workflow.active, false);
  assert.ok(Array.isArray(workflow.nodes));
  assert.ok(workflow.nodes.length >= 10);

  const names = workflow.nodes.map((node) => node.name);
  assert.equal(new Set(names).size, names.length, 'node names must be unique');
  for (const node of workflow.nodes) {
    assert.equal(node.parameters?.requestMethod, undefined, `${node.name} must use method, not requestMethod`);
    if (node.type === 'n8n-nodes-base.httpRequest') {
      assert.ok(node.parameters?.method, `${node.name} must declare an HTTP method`);
    }
    if (node.parameters?.jsCode) {
      assert.doesNotThrow(() => new Function(node.parameters.jsCode), `${node.name} must compile`);
    }
  }

  for (const [source, output] of Object.entries(workflow.connections)) {
    assert.ok(names.includes(source), `unknown source node: ${source}`);
    for (const branch of output.main || []) {
      for (const connection of branch) {
        assert.ok(names.includes(connection.node), `unknown target node: ${connection.node}`);
      }
    }
  }
});

test('n8n workflow keeps the expected safe execution path', () => {
  const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
  assert.equal(byName.get('Every 6 hours')?.type, 'n8n-nodes-base.scheduleTrigger');
  assert.equal(byName.get('Start Apify Group run')?.type, 'n8n-nodes-base.httpRequest');
  assert.equal(byName.get('Start Apify Group run')?.parameters?.method, 'POST');
  assert.equal(byName.get('Get Apify run')?.parameters?.method, 'GET');
  assert.match(
    byName.get('Start Apify Group run')?.parameters?.url,
    /maxTotalChargeUsd=\{\{ \$json\.maxTotalChargeUsd \}\}/,
  );
  assert.equal(
    byName.get('Start Apify Group run')?.parameters?.headerParameters?.parameters?.[0]?.name,
    'Authorization',
  );
  assert.match(
    byName.get('Get dataset items')?.parameters?.url,
    /datasets\/\{\{ \$json\.data\.defaultDatasetId \}\}\/items/,
  );
  assert.equal(byName.get('Get dataset items')?.alwaysOutputData, true);
  assert.match(
    byName.get('Run finished?')?.parameters?.conditions?.conditions?.[0]?.leftValue,
    /SUCCEEDED.*FAILED.*ABORTED.*TIMED_OUT.*runIndex >= 40/,
  );
  assert.equal(byName.get('Append or update Google Sheet')?.type, 'n8n-nodes-base.googleSheets');
  assert.equal(byName.get('Append or update Google Sheet')?.typeVersion, 4.3);
  assert.equal(byName.get('Slack success')?.type, 'n8n-nodes-base.httpRequest');

  const config = byName.get('Configure safe run')?.parameters?.assignments?.assignments || [];
  const maxCharge = config.find((assignment) => assignment.name === 'maxTotalChargeUsd');
  assert.equal(maxCharge?.value, 0.25);

  const sheet = byName.get('Append or update Google Sheet')?.parameters;
  assert.equal(sheet?.operation, 'appendOrUpdate');
  assert.equal(sheet?.authentication, 'oAuth2');
  assert.deepEqual(sheet?.columns?.matchingColumns, ['source_post_id']);
  assert.equal(byName.get('Has stable key?')?.type, 'n8n-nodes-base.if');
  assert.equal(byName.get('Slack missing-key warning')?.type, 'n8n-nodes-base.httpRequest');
  const normalize = byName.get('Normalize post')?.parameters?.assignments?.assignments || [];
  const sourcePostId = normalize.find((assignment) => assignment.name === 'source_post_id');
  assert.match(
    sourcePostId?.value,
    /source_post_id.*source_url/,
    'source post ID must fall back to the post URL',
  );
});

test('n8n workflow does not contain embedded credentials', () => {
  const serialized = JSON.stringify(workflow);
  assert.doesNotMatch(serialized, /apify_api_[A-Za-z0-9]+/);
  assert.doesNotMatch(serialized, /hooks\.slack\.com\/services\/[A-Za-z0-9/]+/);
  assert.match(serialized, /\$env\.APIFY_TOKEN/);
  assert.match(serialized, /\$env\.SLACK_WEBHOOK_URL/);
});
