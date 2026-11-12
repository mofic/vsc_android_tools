'use strict';
const path = require('node:path');
function quote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }
function remotePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\x00-\x1f\x7f]/.test(value) || value.split('/').includes('..')) throw new Error('设备路径必须是绝对路径，且不含 .. 或控制字符');
  return path.posix.normalize(value);
}
function filename(value) {
  if (!value || value === '.' || value === '..' || /[/\x00-\x1f\x7f]/.test(value)) throw new Error('无效文件名');
  return value;
}
module.exports = { quote, remotePath, filename };
