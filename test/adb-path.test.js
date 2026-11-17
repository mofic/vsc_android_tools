'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveAdb } = require('../src/adb-path');

function fixture(t, platform = 'darwin') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-path-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const options = { home, platform, env: {} };
  const executable = relative => {
    const file = path.join(home, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ''); fs.chmodSync(file, 0o755);
    return file;
  };
  return { home, options, executable };
}

test('finds the macOS SDK when the extension PATH lacks adb', t => {
  const { options, executable } = fixture(t);
  const adb = executable('Library/Android/sdk/platform-tools/adb');
  assert.equal(resolveAdb('adb', options), adb);
  assert.equal(resolveAdb('', options), adb);
});
test('explicit configuration wins and is not silently replaced', t => {
  const { options, executable } = fixture(t);
  executable('Library/Android/sdk/platform-tools/adb');
  assert.equal(resolveAdb('/custom tools/adb', options), '/custom tools/adb');
});
test('PATH wins over SDK environment variables, which win over defaults', t => {
  const { home, options, executable } = fixture(t);
  const fromPath = executable('bin/adb');
  const fromSdk = executable('custom-sdk/platform-tools/adb');
  const fallback = executable('Library/Android/sdk/platform-tools/adb');
  options.env = { PATH: path.join(home, 'bin'), ANDROID_HOME: path.join(home, 'custom-sdk') };
  assert.equal(resolveAdb('adb', options), fromPath);
  fs.unlinkSync(fromPath);
  assert.equal(resolveAdb('adb', options), fromSdk);
  fs.unlinkSync(fromSdk);
  assert.equal(resolveAdb('adb', options), fallback);
});
test('uses ANDROID_SDK_ROOT and ignores non-executable files and directories', t => {
  const { home, options, executable } = fixture(t);
  const invalid = executable('bin/adb'); fs.chmodSync(invalid, 0o644);
  fs.mkdirSync(path.join(home, 'directory/adb'), { recursive: true });
  const sdk = executable('sdk with spaces/platform-tools/adb');
  options.env = { PATH: [path.join(home, 'bin'), path.join(home, 'directory')].join(path.delimiter), ANDROID_SDK_ROOT: path.join(home, 'sdk with spaces') };
  assert.equal(resolveAdb('adb', options), sdk);
});
test('finds the Linux default SDK location', t => {
  const linux = fixture(t, 'linux');
  const adb = linux.executable('Android/Sdk/platform-tools/adb');
  assert.equal(resolveAdb('adb', linux.options), adb);
});
test('finds Windows adb.exe through LOCALAPPDATA or PATH', t => {
  const { home, options, executable } = fixture(t, 'win32');
  const sdk = executable('Local/Android/Sdk/platform-tools/adb.exe');
  options.env.LOCALAPPDATA = path.join(home, 'Local');
  assert.equal(resolveAdb('adb', options), sdk);
  const fromPath = executable('bin/adb.exe');
  options.env.PATH = `${path.join(home, 'missing')};${path.join(home, 'bin')}`;
  assert.equal(resolveAdb('adb', options), fromPath);
});
test('missing adb gives a configuration hint and a later installation is detected', t => {
  const { options, executable } = fixture(t);
  assert.throws(() => resolveAdb('adb', options), /androidTools\.adbPath/);
  const adb = executable('Library/Android/sdk/platform-tools/adb');
  assert.equal(resolveAdb('adb', options), adb);
});
