'use strict';
const assert = require('node:assert/strict');
const v = require('vscode');
exports.run = async () => {
  const extension = v.extensions.getExtension('local-android-tools.android-device-tools');
  assert.ok(extension, 'extension discovered');
  await extension.activate();
  const commands = await v.commands.getCommands(true);
  for (const command of extension.packageJSON.contributes.commands) assert.ok(commands.includes(command.command), command.command);
  await v.commands.executeCommand('androidTools.refresh');
  await v.commands.executeCommand('androidApp.focus');
  await new Promise(resolve=>setTimeout(resolve,500));
  console.log('PASS Extension Host: project app sidebar can be opened');
  if (process.env.ANDROID_TOOLS_TEST_DEVICE) {
    const serial = process.env.ANDROID_TOOLS_TEST_DEVICE;
    await v.commands.executeCommand('androidTools.open', { serial, remote: '/etc/hosts', target: '/system/etc/hosts', directory: false, symlink: true });
    const document = v.window.activeTextEditor?.document;
    assert.ok(document, 'target opened in editor');
    assert.match(document.getText(), /127\.0\.0\.1/);
    await v.commands.executeCommand('androidTools.open', { serial, remote: '/etc/hosts', target: '/system/etc/hosts', directory: false, symlink: true });
    assert.equal(v.window.activeTextEditor.document.uri.toString(), document.uri.toString());
    console.log('PASS Extension Host: link target opens in editor and repeated open reuses document');
  }
  const { openLogcat } = require('../src/logcat');
  const subscriptions = [], source = { name: 'tabs-test.log', total: 1, entries: [{ line: 'offline', level: 'I', tag: '', pid: '' }] };
  const context = { extensionUri: extension.extensionUri, subscriptions, globalState: { get: (_, fallback) => fallback } };
  try {
    const first = openLogcat(context, {}, undefined, e => { throw e; }, source);
    const second = openLogcat(context, {}, undefined, e => { throw e; }, source, v.ViewColumn.Beside);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const groups = v.window.tabGroups.all;
    assert.notEqual(first.title, second.title);
    assert.ok(groups.some(g => g.tabs.some(t => t.label === first.title)));
    assert.ok(groups.some(g => g.tabs.some(t => t.label === second.title)));
    assert.notEqual(groups.find(g => g.tabs.some(t => t.label === first.title)), groups.find(g => g.tabs.some(t => t.label === second.title)));
    console.log('PASS Extension Host: independent Logcat tabs in separate editor groups');
  } finally { for (const item of subscriptions) item.dispose(); }
  console.log('PASS Extension Host: activation and all commands registered, ADB refresh');
};
