'use strict';
const v = require('vscode');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const c = require('./core');
const { openLogcat } = require('./logcat');
function activate(ctx) {
  const adb = new c.Adb(() => v.workspace.getConfiguration('androidTools').get('adbPath', 'adb'));
  const output = v.window.createOutputChannel('Android Tools');
  let selected, deviceList = [], root = '/sdcard', project = ctx.workspaceState.get('project');
  const edited = new Map(), opening = new Map();
  const deviceEvent = new v.EventEmitter(), fileEvent = new v.EventEmitter();
  const status = v.window.createStatusBarItem(v.StatusBarAlignment.Left);
  status.command = 'androidTools.selectDevice'; status.text = '$(device-mobile) Android: 选择设备'; status.show();
  const error = e => v.window.showErrorMessage(`Android Tools: ${e.message || e}`);
  const trust = () => { if (!v.workspace.isTrusted) throw new Error('请先信任工作区再执行写入或构建操作'); };
  async function refresh() {
    deviceList = c.devices(await adb.exec(null, ['devices', '-l']));
    if (selected && !deviceList.some(d => d.serial === selected && d.state === 'device')) { selected = undefined; status.text = '$(device-mobile) Android: 已断开'; }
    deviceEvent.fire(); fileEvent.fire();
  }
  async function device() {
    if (!selected) await chooseDevice();
    if (!selected) throw new Error('未选择可用设备');
    return selected;
  }
  async function chooseDevice(item) {
    await refresh();
    const pick = item?.serial ? deviceList.find(d => d.serial === item.serial) : await v.window.showQuickPick(deviceList.map(d => ({ label: `${d.model || d.serial} · ${d.state}`, description: d.serial, ...d })), { placeHolder: '选择目标设备（需已授权）' });
    if (!pick) return;
    if (pick.state !== 'device') throw new Error(`设备 ${pick.serial} ${pick.state}，请检查 USB 调试授权`);
    selected = pick.serial; status.text = `$(device-mobile) ${selected}`; deviceEvent.fire(); fileEvent.fire();
  }
  async function chooseProject() {
    const projects = await c.discover((v.workspace.workspaceFolders || []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath), v.workspace.getConfiguration('androidTools').get('scanDepth', 4));
    const choices = projects.map(p => ({ label: path.basename(p), description: p, value: p }));
    choices.push({ label: '手动选择项目目录…' });
    const pick = projects.length === 1 ? choices[0] : await v.window.showQuickPick(choices, { placeHolder: '选择 Android Gradle 项目' });
    if (!pick) return;
    project = pick.value || (await v.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false }))?.[0]?.fsPath;
    if (project) { await ctx.workspaceState.update('project', project); v.window.showInformationMessage(`Android 项目：${project}`); }
    return project;
  }
  async function getProject() { if (!project) await chooseProject(); if (!project) throw new Error('未选择项目'); await fs.access(project); return project; }
  async function artifact() {
    const p = await getProject();
    const choices = await c.artifacts(p);
    if (!choices.length) return undefined;
    const picked = await v.window.showQuickPick(choices.map(a => ({ label: `${a.variant || 'APK'} · ${a.packageName || ''}`, description: path.relative(p, a.apk), value: a })), { placeHolder: '选择 APK / 构建变体' });
    return picked?.value;
  }
  async function pkg() {
    const a = await artifact();
    const value = await v.window.showInputBox({ title: `目标设备 ${selected}`, prompt: '确认 applicationId（优先来自 APK 元数据）', value: a?.packageName || ctx.workspaceState.get(`package:${project}`, '') });
    if (!value) return;
    c.packageName(value); await ctx.workspaceState.update(`package:${project}`, value); return value;
  }
  async function currentPackage() {
    const p = await getProject(), remembered = ctx.workspaceState.get(`package:${p}`);
    if (remembered) return c.packageName(remembered);
    const packages = [...new Set((await c.artifacts(p)).map(a => a.packageName).filter(Boolean))];
    let value;
    if (packages.length === 1) value = packages[0];
    else if (packages.length > 1) value = await v.window.showQuickPick(packages, { placeHolder: '选择当前项目的应用包名（记住本次选择）' });
    else value = await v.window.showInputBox({ prompt: '项目尚无 APK 元数据，请输入 applicationId（将记住）' });
    if (!value) return;
    c.packageName(value); await ctx.workspaceState.update(`package:${p}`, value); return value;
  }
  async function confirm(message) { return await v.window.showWarningMessage(message, { modal: true }, '确认') === '确认'; }
  async function progress(title, action) { return v.window.withProgress({ location: v.ProgressLocation.Notification, title, cancellable: true }, (_, token) => action({ token, timeout: 1800000, onOutput: s => output.append(s) })); }
  function node(item) { return item || { remote: root, directory: true, serial: selected }; }
  async function target(item) { const serial = item?.serial || await device(); return { ...node(item), serial }; }
  const devicesProvider = { onDidChangeTreeData: deviceEvent.event, getChildren: () => deviceList, getTreeItem: d => {
    const item = new v.TreeItem(`${d.model || d.serial} (${d.state})`); item.description = `${d.serial}${selected === d.serial ? ' · 当前' : ''}`;
    item.iconPath = new v.ThemeIcon('device-mobile'); item.command = { command: 'androidTools.selectDevice', title: '选择设备', arguments: [d] }; return item;
  }};
  const filesProvider = { onDidChangeTreeData: fileEvent.event, getChildren: async item => {
    if (!selected && !item) return [];
    const serial = item?.serial || selected, dir = item?.target || item?.remote || root;
    try { return (await adb.list(serial, dir)).map(f => ({ ...f, remote: path.posix.join(dir, f.name), serial })); } catch (e) { error(e); return []; }
  }, getTreeItem: f => {
    const item = new v.TreeItem(f.name, f.directory ? v.TreeItemCollapsibleState.Collapsed : v.TreeItemCollapsibleState.None);
    item.tooltip = `${f.serial}:${f.remote}${f.symlink ? ` → ${f.target}` : ''}`;
    item.iconPath = new v.ThemeIcon(f.symlink ? (f.directory ? 'file-symlink-directory' : 'file-symlink-file') : (f.directory ? 'folder' : 'file'));
    if (!f.directory) item.command = { command: 'androidTools.open', title: '编辑', arguments: [f] }; return item;
  }};
  const handlers = {
    refresh, selectDevice: chooseDevice, selectProject: chooseProject,
    openAppDirectory: async () => {
      const serial = await device(), packageId = await currentPackage(); if (!packageId) return;
      const directory = `/sdcard/Android/data/${packageId}`;
      try { await adb.list(serial, directory); }
      catch (e) { throw new Error(`目录不存在或无权访问：${serial}:${directory}。请确认该变体已安装并创建了外部存储目录。${e.message}`); }
      root = directory; fileEvent.fire(); await v.commands.executeCommand('androidFiles.focus');
    },
    browse: async () => { await device(); const value = await v.window.showInputBox({ value: root, prompt: '设备绝对路径' }); if (value) { root = c.remotePath(value); fileEvent.fire(); } },
    open: async item => {
      const t = await target(item); if (t.directory) return;
      const remote = c.remotePath(t.target || t.remote), key = `${t.serial}:${remote}`;
      let local = [...edited].find(([, entry]) => entry.serial === t.serial && entry.remote === remote)?.[0];
      if (local) { try { await fs.access(local); } catch { local = undefined; } }
      if (!local) {
        if (!opening.has(key)) opening.set(key, (async () => {
          const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'android-tools-'));
          const file = path.join(temp, c.filename(path.posix.basename(remote)));
          try {
            await progress(`打开 ${t.serial}:${remote}`, opts => adb.exec(t.serial, ['pull', remote, file], opts));
            edited.set(file, { ...t, remote, temp }); return file;
          } catch (e) { await fs.rm(temp, { recursive: true, force: true }); throw e; }
        })());
        try { local = await opening.get(key); } finally { opening.delete(key); }
      }
      await v.commands.executeCommand('vscode.open', v.Uri.file(local), { preview: false });
    },
    save: async () => {
      trust(); const doc = v.window.activeTextEditor?.document, t = edited.get(doc?.uri.fsPath);
      if (!t) throw new Error('当前文件不是由设备下载的编辑副本');
      if (!await confirm(`覆盖 ${t.serial}:${t.remote}？`)) return;
      if (!await doc.save()) throw new Error('本地保存失败');
      await progress('保存到设备', opts => adb.exec(t.serial, ['push', doc.uri.fsPath, t.remote], opts));
    },
    rename: async item => { trust(); const t = await target(item); const name = await v.window.showInputBox({ value: path.posix.basename(t.remote), prompt: '新名称（目标存在时禁止覆盖）' }); if (!name) return;
      const dest = path.posix.join(path.posix.dirname(t.remote), c.filename(name));
      await adb.exec(t.serial, ['shell', `if [ -e ${c.quote(dest)} ] || [ -L ${c.quote(dest)} ]; then echo '目标已存在' >&2; exit 1; fi; mv -- ${c.quote(c.remotePath(t.remote))} ${c.quote(dest)}`]); fileEvent.fire(); },
    delete: async item => { trust(); if (!item) throw new Error('请右键选择文件或目录'); const t = await target(item); if (['/', '/sdcard', '/storage', '/data'].includes(c.remotePath(t.remote))) throw new Error('禁止删除根目录'); if (await confirm(`永久删除 ${t.serial}:${t.remote} 及其内容？`)) { await adb.shell(t.serial, ['rm', '-rf', '--', t.remote]); fileEvent.fire(); } },
    download: async item => { const t = await target(item); const dest = (await v.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false }))?.[0]; if (!dest) return;
      const local = path.join(dest.fsPath, path.posix.basename(t.remote));
      try { await fs.access(local); if (!await confirm(`本地 ${local} 已存在，合并目录并覆盖同名文件？`)) return; } catch (e) { if (e.code !== 'ENOENT') throw e; }
      await progress(`下载 ${t.serial}:${t.remote}`, opts => adb.exec(t.serial, ['pull', t.remote, dest.fsPath], opts)); },
    build: async () => {
      trust(); const serial = await device(), p = await getProject();
      const wrapper = path.join(p, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'); await fs.access(wrapper);
      const gradle = (taskArgs, opts) => process.platform === 'win32' ? c.run('cmd.exe', ['/d', '/c', 'gradlew.bat', ...taskArgs], { ...opts, cwd: p }) : c.run('/bin/sh', [wrapper, ...taskArgs], { ...opts, cwd: p });
      const listing = await progress('识别模块和构建变体', opts => gradle(['tasks', '--all', '--console=plain'], opts));
      const tasks = [...new Set([...listing.matchAll(/^([\w:]*assemble[\w]*)\s+-/gm)].map(m => m[1]))];
      const pick = await v.window.showQuickPick([...tasks, '手动输入任务…'], { placeHolder: '选择应用模块与构建变体' });
      if (!pick) return;
      const task = pick === '手动输入任务…' ? await v.window.showInputBox({ value: ':app:assembleDebug', prompt: 'Gradle 构建任务' }) : pick; if (!task) return;
      if (!/^:?[A-Za-z0-9_:]+$/.test(task)) throw new Error('无效 Gradle 任务');
      await progress(`构建 ${p}`, opts => gradle([task, '--console=plain'], opts));
      const a = await artifact(); if (!a) return;
      if (a.filters.length) throw new Error('此 APK 含拆分过滤条件，请使用通用 APK 或手动安装完整 APK 集');
      await progress(`安装 ${serial}`, opts => adb.exec(serial, ['install', '-r', a.apk], opts));
      await ctx.workspaceState.update(`package:${p}`, c.packageName(a.packageName));
      await launch(serial, a.packageName);
    },
    install: async () => { trust(); const serial = await device(); const files = await v.window.showOpenDialog({ canSelectMany: true, filters: { APK: ['apk'] } }); if (!files?.length) return;
      await progress(`安装到 ${serial}`, opts => adb.exec(serial, [files.length > 1 ? 'install-multiple' : 'install', '-r', ...files.map(f => f.fsPath)], opts)); },
    logcat: async () => { const serial = await device(); openLogcat(ctx, adb, serial, error); }
  };
  async function launch(serial, packageId) {
    const component = (await adb.shell(serial, ['cmd', 'package', 'resolve-activity', '--brief', packageId])).trim().split(/\r?\n/).pop();
    if (!component?.includes('/')) throw new Error('找不到可启动 Activity');
    const result = await adb.shell(serial, ['am', 'start', '-n', component]); if (/Error:|Exception/.test(result)) throw new Error(result); output.appendLine(result);
  }
  for (const [id, command] of Object.entries({ stop: ['am', 'force-stop'], uninstall: ['pm', 'uninstall'], clearData: ['pm', 'clear'], revoke: ['pm', 'reset-permissions'] })) {
    handlers[id] = async () => {
      trust(); const serial = await device(), packageId = await pkg(); if (!packageId) return;
      if (['uninstall','clearData','revoke'].includes(id) && !await confirm(`${id}：${serial} / ${project || ''} / ${packageId}？`)) return;
      if (id === 'revoke') {
        // reset-permissions 作用于全设备，因此逐项撤销目标包的已授予运行时权限。
        const dump = await adb.shell(serial, ['dumpsys', 'package', packageId]);
        const user = (await adb.shell(serial, ['am', 'get-current-user'])).trim();
        const block = dump.split(new RegExp(`User ${user}:`))[1]?.split(/\n\s*User \d+:/)[0] || '';
        const runtime = block.split('runtime permissions:')[1]?.split(/\n\s*enabledComponents:|\n\s*disabledComponents:/)[0] || '';
        const permissions = [...new Set([...runtime.matchAll(/([\w.]+): granted=true/g)].map(m => m[1]))];
        let success = 0; output.show(true);
        for (const permission of permissions) { try { await adb.shell(serial, ['pm', 'revoke', '--user', user, packageId, permission]); success++; } catch(e) { output.appendLine(`${permission}: ${e.message}`); } }
        v.window.showInformationMessage(`权限撤销 ${success}/${permissions.length}；失败/不适用项请查看输出。`); return;
      }
      const result = await adb.shell(serial, [...command, packageId]); if (/Failure|Failed|Error:|Exception/.test(result)) throw new Error(result); output.appendLine(result); v.window.showInformationMessage(`${id} 完成：${packageId}`);
    };
  }
  handlers.launch = async () => { trust(); const serial = await device(), packageId = await pkg(); if (packageId) await launch(serial, packageId); };
  for (const directory of [false, true]) handlers[directory ? 'newFolder' : 'newFile'] = async item => {
    trust(); const t = await target(item); const name = await v.window.showInputBox({ prompt: directory ? '文件夹名称' : '文件名称' }); if (!name) return;
    const dest = path.posix.join(t.directory ? t.remote : path.posix.dirname(t.remote), c.filename(name));
    await adb.exec(t.serial, ['shell', `if [ -e ${c.quote(dest)} ] || [ -L ${c.quote(dest)} ]; then echo '目标已存在' >&2; exit 1; fi; ${directory ? 'mkdir --' : 'touch --'} ${c.quote(dest)}`]); fileEvent.fire();
  };
  for (const folder of [false, true]) handlers[folder ? 'uploadFolder' : 'upload'] = async item => {
    trust(); const t = await target(item), dir = t.directory ? t.remote : path.posix.dirname(t.remote);
    const sources = await v.window.showOpenDialog({ canSelectFolders: folder, canSelectFiles: !folder, canSelectMany: true }); if (!sources) return;
    if (!await confirm(`上传至 ${t.serial}:${dir}，合并目录并覆盖同名文件？`)) return;
    await progress('上传到设备', async opts => { for (const source of sources) await adb.exec(t.serial, ['push', source.fsPath, dir + '/'], opts); }); fileEvent.fire();
  };
  for (const [id, handler] of Object.entries(handlers)) ctx.subscriptions.push(v.commands.registerCommand(`androidTools.${id}`, (...args) => Promise.resolve().then(() => handler(...args)).catch(error)));
  ctx.subscriptions.push(v.window.registerTreeDataProvider('androidDevices', devicesProvider), v.window.registerTreeDataProvider('androidFiles', filesProvider), output, status, deviceEvent, fileEvent);
  let refreshing = false;
  const poll = setInterval(async () => { if (refreshing) return; refreshing = true; try { await refresh(); } catch { /* manual refresh shows ADB setup errors */ } finally { refreshing = false; } }, 5000);
  ctx.subscriptions.push({ dispose() { clearInterval(poll); for (const t of edited.values()) fs.rm(t.temp, { recursive: true, force: true }).catch(() => {}); } });
  ctx.subscriptions.push(v.workspace.onDidChangeWorkspaceFolders(() => { project = undefined; ctx.workspaceState.update('project', undefined); }));
  refresh().catch(error);
}
module.exports = { activate };
