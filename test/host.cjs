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
  console.log('PASS Extension Host: activation and all commands registered, ADB refresh');
};
