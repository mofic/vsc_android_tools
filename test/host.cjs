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
  console.log('PASS Extension Host: activation and all commands registered, ADB refresh');
};
