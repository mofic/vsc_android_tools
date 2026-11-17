'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function resolveAdb(configured = 'adb', { env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  // Explicit paths or command names remain authoritative, including invalid ones.
  if (configured && configured !== 'adb') return configured;
  const binary = platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = (env.PATH || '').split(platform === 'win32' ? ';' : ':')
    .filter(directory => directory && path.isAbsolute(directory))
    .map(directory => path.join(directory, binary));
  const roots = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT];
  if (platform === 'darwin') roots.push(path.join(home, 'Library', 'Android', 'sdk'));
  else if (platform === 'win32') roots.push(path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Android', 'Sdk'));
  else roots.push(path.join(home, 'Android', 'Sdk'), path.join(home, 'Android', 'sdk'));
  for (const root of roots.filter(root => root && path.isAbsolute(root))) candidates.push(path.join(root, 'platform-tools', binary));
  for (const candidate of new Set(candidates)) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      return candidate;
    } catch { /* Missing or inaccessible candidates must not hide another SDK. */ }
  }
  throw new Error('未找到 ADB。请安装 Android SDK Platform Tools，或在设置 androidTools.adbPath 中指定 ADB 完整路径。');
}

module.exports = { resolveAdb };
