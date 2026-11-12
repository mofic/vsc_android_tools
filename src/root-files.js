'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { quote:q, remotePath, filename } = require('./remote-path');
const isPrivate = remote => /^\/data\/(data|user|user_de)(\/|$)/.test(remote);
async function staged(adb, serial, action) {
  const stage = `/data/local/tmp/android-tools-files-${randomUUID()}`;
  await adb.shell(serial, ['mkdir','-m','700',stage]);
  try { return await action(stage); }
  finally { await adb.fileShell(serial,['rm','-rf','--',stage],{timeout:10000}); }
}
async function pull(adb, serial, source, destination, options) {
  const remote = remotePath(source), mode = adb.fileRoots.get(serial);
  if (mode?.kind !== 'su' || !isPrivate(remote)) return adb.exec(serial,['pull',remote,destination],options);
  return staged(adb,serial,async stage => {
    const copy = path.posix.join(stage,filename(path.posix.basename(remote)));
    await adb.fileScript(serial,`set -e
cp -R -H -- ${q(remote)} ${q(copy)}
find ${q(copy)} -exec chown -h ${q(mode.uid)} {} +
find ${q(copy)} -type d -exec chmod u+rwx {} +
find ${q(copy)} -type f -exec chmod u+rw {} +`,options);
    return adb.exec(serial,['pull',copy,destination],options);
  });
}
const uploadFunction = `copy_node() {
  local src="$1" dst="$2" parent owner context tmp child
  [ ! -L "$src" ] || { echo 'Root 上传不支持符号链接' >&2; return 1; }
  [ ! -L "$dst" ] || { echo '目标是符号链接，请先打开实际目标' >&2; return 1; }
  parent="\${dst%/*}"; [ -n "$parent" ] || parent=/
  if [ -d "$src" ]; then
    if [ ! -e "$dst" ]; then
      mkdir -m 700 -- "$dst" || return 1
      owner=$(stat -c '%u:%g' -- "$parent") || return 1
      context=$(stat -c '%C' -- "$parent") || return 1
      chown "$owner" "$dst" && chcon "$context" "$dst" || return 1
    fi
    [ -d "$dst" ] || { echo '目标不是目录' >&2; return 1; }
    for child in "$src"/.[!.]* "$src"/..?* "$src"/*; do
      [ -e "$child" ] || [ -L "$child" ] || continue
      copy_node "$child" "$dst/\${child##*/}" || return 1
    done
  else
    [ ! -d "$dst" ] || { echo '目标是目录' >&2; return 1; }
    tmp="$dst.android-tools-TOKEN"
    if [ -e "$dst" ]; then
      cp --preserve=mode,ownership,context -- "$dst" "$tmp" || return 1
    else
      (umask 077; set -C; : > "$tmp") || return 1
      owner=$(stat -c '%u:%g' -- "$parent") || { rm -f -- "$tmp"; return 1; }
      context=$(stat -c '%C' -- "$parent") || { rm -f -- "$tmp"; return 1; }
      chown "$owner" "$tmp" && chcon "$context" "$tmp" || { rm -f -- "$tmp"; return 1; }
    fi
    if cat -- "$src" > "$tmp" && mv -f -- "$tmp" "$dst"; then :; else rm -f -- "$tmp"; return 1; fi
  fi
}`;
async function validateLocal(local) {
  const info = await fs.lstat(local); filename(path.basename(local));
  if (info.isSymbolicLink()) throw new Error('Root 上传不支持本地符号链接，请选择实际文件');
  if (info.isDirectory()) for (const item of await fs.readdir(local)) await validateLocal(path.join(local,item));
  else if (!info.isFile()) throw new Error('只能上传普通文件和目录');
}
async function push(adb, serial, local, destination, options) {
  const remote = remotePath(destination), mode = adb.fileRoots.get(serial);
  if (!mode || !isPrivate(remote)) return adb.exec(serial,['push',local,destination],options);
  await validateLocal(local);
  return staged(adb,serial,async stage => {
    const source = stage + '/payload';
    await adb.exec(serial,['push',local,source],options);
    const token = randomUUID();
    return adb.fileScript(serial,`${uploadFunction.replace('TOKEN',token)}
destination=${q(remote)}
name=${q(filename(path.basename(local)))}
if [ -d "$destination" ]; then destination="$destination/$name"; fi
copy_node ${q(source)} "$destination"`,options);
  });
}
async function create(adb, serial, destination, directory) {
  const remote = remotePath(destination), parent = path.posix.dirname(remote);
  const root = adb.fileRoots.has(serial) && isPrivate(remote);
  const script = `set -e
if [ -e ${q(remote)} ] || [ -L ${q(remote)} ]; then echo '目标已存在' >&2; exit 1; fi
${root ? 'umask 077' : ''}
${directory ? `mkdir ${root ? '-m 700 ' : ''}-- ${q(remote)}` : `(set -C; : > ${q(remote)})`}
${root ? `owner=$(stat -c '%u:%g' -- ${q(parent)})
context=$(stat -c '%C' -- ${q(parent)})
chown "$owner" ${q(remote)}
chcon "$context" ${q(remote)}` : ''}`;
  return adb.fileScript(serial,script);
}
module.exports = { pull, push, create };
