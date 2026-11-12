'use strict';
const v = require('vscode');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const c = require('./core');
const { deviceCapture } = require('./device-capture');
const runTargets = require('./run-targets');
const { registerAppView } = require('./app-view');
const { openLogcat, importLogcat } = require('./logcat');
function activate(ctx) {
  const adb = new c.Adb(() => v.workspace.getConfiguration('androidTools').get('adbPath', 'adb'));
  const output = v.window.createOutputChannel('Android Tools');
  let selected, deviceList = [], root = '/sdcard', project = ctx.workspaceState.get('project');
  const edited = new Map(), opening = new Map();
  let updateAppView = () => {};
  let filesView; const back = [], forward = [];
  const deviceEvent = new v.EventEmitter(), fileEvent = new v.EventEmitter();
  const status = v.window.createStatusBarItem(v.StatusBarAlignment.Left);
  status.command = 'androidTools.selectDevice'; status.text = '$(device-mobile) Android: 选择设备'; status.show();
  const error = e => v.window.showErrorMessage(`Android Tools: ${e.message || e}`);
  const trust = () => { if (!v.workspace.isTrusted) throw new Error('请先信任工作区再执行写入或构建操作'); };
  const captures = deviceCapture(ctx, adb, () => deviceEvent.fire(), error);
  const directoryCache = new Map();
  function updateFileHeader() {
    updateAppView();
    if (filesView) { filesView.description = selected ? selected + (adb.fileRoots.has(selected) ? ' · ROOT' : '') : ''; filesView.message = selected ? root : '请选择已授权设备'; }
  }
  function refreshFiles(item) {
    if (item) directoryCache.delete(`${item.serial}:${item.target || item.remote}`); else directoryCache.clear();
    fileEvent.fire(item?.remote === root ? undefined : item); updateFileHeader();
  }
  function refreshParent(item) {
    if (item.parentNode) refreshFiles(item.parentNode);
    else { directoryCache.delete(`${item.serial}:${path.posix.dirname(item.remote)}`); fileEvent.fire(); }
  }
  async function navigate(value, remember = true) {
    const serial = await device(), next = c.remotePath(value);
    if (next !== root && remember) { back.push(root); if (back.length > 50) back.shift(); forward.length = 0; }
    root = next; updateFileHeader(); fileEvent.fire();
    await ctx.workspaceState.update(`directory:${serial}`, root);
    const recent = ctx.workspaceState.get(`directories:${serial}`, []);
    await ctx.workspaceState.update(`directories:${serial}`, [root, ...recent.filter(p => p !== root)].slice(0,20));
  }
  function readDirectory(serial, directory) {
    const key = `${serial}:${directory}`;
    if (!directoryCache.has(key)) {
      const pending = adb.list(serial, directory).catch(e => { if (directoryCache.get(key) === pending) directoryCache.delete(key); throw e; });
      directoryCache.set(key, pending);
      if (directoryCache.size > 128) directoryCache.delete(directoryCache.keys().next().value);
    }
    return directoryCache.get(key);
  }
  async function refreshDevices() {
    const next = c.devices(await adb.exec(null, ['devices', '-l']));
    for (const serial of adb.fileRoots.keys()) if (!next.some(d => d.serial === serial && d.state === 'device')) adb.fileRoots.delete(serial);
    if (selected && !next.some(d => d.serial === selected && d.state === 'device')) { selected = undefined; updateFileHeader(); status.text = '$(device-mobile) Android: 已断开'; refreshFiles(); }
    if (JSON.stringify(next) !== JSON.stringify(deviceList)) { deviceList = next; deviceEvent.fire(); }
  }
  async function refresh() { await refreshDevices(); refreshFiles(); }
  async function device() {
    if (!selected) await chooseDevice();
    if (!selected) throw new Error('未选择可用设备');
    return selected;
  }
  async function chooseDevice(item) {
    await refreshDevices();
    const pick = item?.serial ? deviceList.find(d => d.serial === item.serial) : await v.window.showQuickPick(deviceList.map(d => ({ label: `${d.model || d.serial} · ${d.state}`, description: d.serial, ...d })), { placeHolder: '选择目标设备（需已授权）' });
    if (!pick) return;
    if (pick.state !== 'device') throw new Error(`设备 ${pick.serial} ${pick.state}，请检查 USB 调试授权`);
    const changedDevice = selected !== pick.serial; selected = pick.serial;
    if (changedDevice) { root = ctx.workspaceState.get(`directory:${selected}`, '/sdcard'); back.length = 0; forward.length = 0; }
    updateFileHeader(); status.text = `$(device-mobile) ${selected}`; deviceEvent.fire(); if (changedDevice) refreshFiles();
  }
  async function chooseProject() {
    const projects = await c.discover((v.workspace.workspaceFolders || []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath), v.workspace.getConfiguration('androidTools').get('scanDepth', 4));
    const choices = projects.map(p => ({ label: path.basename(p), description: p, value: p }));
    choices.push({ label: '手动选择项目目录…' });
    const pick = projects.length === 1 ? choices[0] : await v.window.showQuickPick(choices, { placeHolder: '选择 Android Gradle 项目' });
    if (!pick) return;
    project = pick.value || (await v.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false }))?.[0]?.fsPath;
    if (project) { await ctx.workspaceState.update('project', project); v.window.showInformationMessage(`Android 项目：${project}`); }
    updateAppView(); return project;
  }
  async function getProject() { if (!project) await chooseProject(); if (!project) throw new Error('未选择项目'); await fs.access(project); return project; }
  async function artifact(projectRoot) {
    const p = projectRoot || await getProject();
    const choices = await c.artifacts(p);
    if (!choices.length) return undefined;
    const picked = choices.length === 1 ? { value: choices[0] } : await v.window.showQuickPick(choices.map(a => ({ label: `${a.variant || 'APK'} · ${a.packageName || ''}`, description: path.relative(p, a.apk), value: a })), { placeHolder: '选择 APK / 构建变体' });
    return picked?.value;
  }
  async function pkg(force = false) {
    if (!force) return currentPackage();
    const p = await getProject(), a = await artifact(p);
    const value = await v.window.showInputBox({ title: `目标设备 ${selected}`, prompt: '确认 applicationId（优先来自 APK 元数据）', value: a?.packageName || ctx.workspaceState.get(`package:${p}`, '') });
    if (!value) return;
    c.packageName(value); await ctx.workspaceState.update(`package:${p}`, value); updateAppView(); return value;
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
    c.packageName(value); await ctx.workspaceState.update(`package:${p}`, value); updateAppView(); return value;
  }
  async function confirm(message) { return await v.window.showWarningMessage(message, { modal: true }, '确认') === '确认'; }
  async function progress(title, action) { return v.window.withProgress({ location: v.ProgressLocation.Notification, title, cancellable: true }, (progress, token) => action({ token, timeout: 1800000, onOutput: s => { output.append(s); const line = s.trim().split(/\r?\n/).pop(); if (line) progress.report?.({ message: line.slice(-160) }); } })); }
  function node(item) { return typeof item?.remote === 'string' ? item : { remote: root, directory: true, serial: selected }; }
  async function target(item) { if (item?.parent) throw new Error('返回上一级不是设备文件，不能执行文件操作'); const serial = item?.serial || await device(); const t = node(item); c.remotePath(t.remote); return { ...t, serial }; }
  const devicesProvider = { onDidChangeTreeData: deviceEvent.event, getChildren: () => deviceList, getTreeItem: d => {
    const item = new v.TreeItem(`${d.model || d.serial} (${d.state})`); item.description = `${d.serial}${selected === d.serial ? ' · 当前' : ''}`;
    item.contextValue = d.state === 'device' ? 'androidDevice' + captures.state(d.serial) : 'androidDeviceUnavailable';
    item.iconPath = new v.ThemeIcon('device-mobile'); item.command = { command: 'androidTools.selectDevice', title: '选择设备', arguments: [d] }; return item;
  }};
  const filesProvider = { getParent: item => item.parentNode, onDidChangeTreeData: fileEvent.event, getChildren: async item => {
    if (!selected && !item) return [];
    const serial = item?.serial || selected, dir = item?.target || item?.remote || root;
    const parent = !item && root !== '/' ? [{ parent: true, remote: path.posix.dirname(root), serial }] : [];
    try {
      const children = (await readDirectory(serial, dir)).map(f => ({ ...f, remote: path.posix.join(dir, f.name), serial, parentNode: item, treePath: path.posix.join(item?.treePath || item?.remote || root, f.name) }));
      if (!item && filesView) filesView.message = children.length ? root : `${root}（空目录）`;
      return [...parent, ...children];
    } catch (e) {
      error(e);
      return [...parent, { error: e.message, name: '读取失败（可右键刷新）', remote: dir, serial, parentNode: item, treePath: item?.treePath || dir }];
    }
  }, getTreeItem: f => {
    if (f.error) { const item = new v.TreeItem(f.name); item.id = `error:${f.serial}:${f.parentNode?.treePath || f.remote}`; item.contextValue = 'androidError'; item.iconPath = new v.ThemeIcon('warning'); item.tooltip = f.error; return item; }
    if (f.parent) {
      const item = new v.TreeItem('返回上一级', v.TreeItemCollapsibleState.None);
      item.id = `parent:${f.serial}:${root}`; item.contextValue = 'androidParent'; item.iconPath = new v.ThemeIcon('arrow-up'); item.tooltip = f.remote;
      item.command = { command: 'androidTools.goParent', title: '返回上一级' }; return item;
    }
    const item = new v.TreeItem(f.name, f.directory || f.unknown ? v.TreeItemCollapsibleState.Collapsed : v.TreeItemCollapsibleState.None);
    item.id = `${f.serial}:${f.treePath || f.remote}`;
    item.contextValue = f.unknown ? 'androidRestricted' : f.symlink ? (f.directory ? 'androidLinkDirectory' : 'androidLinkFile') : f.directory ? 'androidDirectory' : 'androidFile';
    item.description = !f.directory && f.size !== undefined ? c.formatSize(f.size) : undefined;
    item.tooltip = `${f.serial}:${f.remote}${f.symlink ? ` → ${f.target || '目标不可读取'}` : ''}${f.unknown ? '（属性不可读取，可能权限受限）' : ''}${f.modified !== undefined ? `\n修改时间：${new Date(f.modified).toLocaleString()}` : ''}${f.size !== undefined ? `\n大小：${f.size.toLocaleString()} 字节` : ''}`;
    item.iconPath = new v.ThemeIcon(f.unknown ? 'lock' : f.symlink ? (f.directory ? 'file-symlink-directory' : 'file-symlink-file') : (f.directory ? 'folder' : 'file'));
    if (!f.directory && !f.unknown) item.command = { command: 'androidTools.open', title: '编辑', arguments: [f] }; return item;
  }};
  const handlers = {
    screenshot: async item => { await captures.screenshot(item?.serial || await device()); },
    record: async item => { await captures.record(item?.serial || await device()); },
    stopRecording: async item => { await captures.stop(item?.serial || await device()); },
    refresh, selectDevice: chooseDevice, selectProject: chooseProject,
    selectPackage: async () => pkg(true),
    installProject: async () => {
      trust(); const serial = await device(), p = await getProject(), a = await artifact(p); if (!a) throw new Error('未找到项目 APK，请先构建，或选择安装其他 APK');
      if (a.filters.length) throw new Error('请选择通用 APK，拆分包请通过安装其他 APK 多选完整包集');
      c.packageName(a.packageName);
      await progress(`安装项目 APK 到 ${serial}`, opts => adb.exec(serial, ['install', '-r', a.apk], opts));
      await ctx.workspaceState.update(`package:${p}`, c.packageName(a.packageName)); updateAppView(); v.window.showInformationMessage(`已安装 ${a.packageName} 到 ${serial}`);
    },
    goParent: async () => navigate(path.posix.dirname(root)),
    goBack: async () => { if (back.length) { const next = back.pop(); forward.push(root); await navigate(next, false); } },
    goForward: async () => { if (forward.length) { const next = forward.pop(); back.push(root); await navigate(next, false); } },
    recentDirectories: async () => { const serial = await device(); const chosen = await v.window.showQuickPick(ctx.workspaceState.get(`directories:${serial}`, []), { placeHolder: '最近访问的设备目录' }); if (chosen) await navigate(chosen); },
    enterDirectory: async item => { const t = await target(item); await navigate(t.target || t.remote); },
    copyPath: async item => { const t = await target(item); await v.env.clipboard.writeText(t.remote); },
    refreshDirectory: async item => { const t = await target(item); if (t.directory) refreshFiles(t); else refreshParent(t); },
    openAppDirectory: async () => {
      const serial = await device(), packageId = await currentPackage(); if (!packageId) return;
      await adb.enableFileRoot(serial); directoryCache.clear(); updateFileHeader();
      const directory = `/data/data/${packageId}`;
      try { await readDirectory(serial, directory); }
      catch (e) { throw new Error(`目录不存在或无权访问：${serial}:${directory}。请确认该变体已安装，且 Root 授权有效。${e.message}`); }
      await navigate(directory); await v.commands.executeCommand('androidFiles.focus');
    },
    browse: async () => { await device(); const value = await v.window.showInputBox({ value: root, prompt: '设备绝对路径' }); if (value) await navigate(value) },
    open: async item => {
      const t = await target(item); if (t.directory) return; if (t.unknown) throw new Error('文件属性不可读取，请检查设备权限');
      const remote = c.remotePath(t.target || t.remote), key = `${t.serial}:${remote}`;
      let local = [...edited].find(([, entry]) => entry.serial === t.serial && entry.remote === remote)?.[0];
      if (local) { try { await fs.access(local); } catch { local = undefined; } }
      if (!local) {
        if (!opening.has(key)) opening.set(key, (async () => {
          const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'android-tools-'));
          const file = path.join(temp, c.filename(path.posix.basename(remote)));
          try {
            await progress(`打开 ${t.serial}:${remote}`, opts => adb.pullFile(t.serial, remote, file, opts));
            edited.set(file, { ...t, remote, temp, needsUpload: false }); return file;
          } catch (e) { await fs.rm(temp, { recursive: true, force: true }); throw e; }
        })());
        try { local = await opening.get(key); } finally { opening.delete(key); }
      }
      await v.commands.executeCommand('vscode.open', v.Uri.file(local), { preview: false }); updateEditStatus();
    },
    save: async () => {
      trust(); const doc = v.window.activeTextEditor?.document, t = edited.get(doc?.uri.fsPath);
      if (!t) throw new Error('当前文件不是由设备下载的编辑副本');
      if (!await confirm(`覆盖 ${t.serial}:${t.remote}？`)) return;
      if (!await doc.save()) throw new Error('本地保存失败');
      const version = doc.version;
      await progress('保存到设备', opts => adb.pushFile(t.serial, doc.uri.fsPath, t.remote, opts));
      t.needsUpload = doc.version !== version; updateEditStatus(); refreshParent(t); v.window.showInformationMessage(t.needsUpload ? `此版本已上传，后续修改仍待同步：${t.serial}:${t.remote}` : `已同步到 ${t.serial}:${t.remote}`);
    },
    rename: async item => { trust(); if (!item?.remote) throw new Error('请右键选择文件或目录'); const t = await target(item); const name = await v.window.showInputBox({ value: path.posix.basename(t.remote), prompt: '新名称（目标存在时禁止覆盖）' }); if (!name) return;
      const dest = path.posix.join(path.posix.dirname(t.remote), c.filename(name));
      await adb.fileScript(t.serial, `if [ -e ${c.quote(dest)} ] || [ -L ${c.quote(dest)} ]; then echo '目标已存在' >&2; exit 1; fi; mv -- ${c.quote(c.remotePath(t.remote))} ${c.quote(dest)}`);
      if (!t.symlink) for (const entry of edited.values()) if (entry.serial === t.serial && (entry.remote === t.remote || entry.remote.startsWith(t.remote + '/'))) { entry.remote = dest + entry.remote.slice(t.remote.length); entry.parentNode = undefined; }
      updateEditStatus(); refreshParent(t); },
    delete: async item => { trust(); if (!item?.remote) throw new Error('请右键选择文件或目录'); const t = await target(item); if ((['/', '/sdcard', '/storage', '/data', '/data/data', '/data/user', '/data/user_de'].includes(c.remotePath(t.remote)) || /^\/data\/(user|user_de)\/\d+$/.test(c.remotePath(t.remote)))) throw new Error('禁止删除根目录'); if (await confirm(`永久删除 ${t.serial}:${t.remote} 及其内容？`)) { await adb.fileShell(t.serial, ['rm', '-rf', '--', t.remote]); refreshParent(t); } },
    download: async item => {
      const t = await target(item);
      const dest = t.directory ? (await v.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false }))?.[0] : await v.window.showSaveDialog({ title: `另存为 · ${t.serial}:${t.remote}`, defaultUri: v.Uri.file(path.join(os.homedir(),path.posix.basename(t.remote))) });
      if (!dest) return; if (dest.scheme !== 'file') throw new Error('请选择本地保存路径');
      const local = t.directory ? path.join(dest.fsPath, path.posix.basename(t.remote)) : dest.fsPath;
      if (t.directory) { try { await fs.access(local); if (!await confirm(`本地 ${local} 已存在，合并目录并覆盖同名文件？`)) return; } catch(e) { if (e.code !== 'ENOENT') throw e; } }
      await progress(`下载 ${t.serial}:${t.remote}`, opts => adb.pullFile(t.serial, t.remote, dest.fsPath, opts)); v.window.showInformationMessage(`已下载到 ${dest.fsPath}`);
    },
    build: () => buildAndRun(false),
    clearDataAndRun: () => buildAndRun(true),
    install: async () => { trust(); const serial = await device(); const files = await v.window.showOpenDialog({ canSelectMany: true, filters: { APK: ['apk'] } }); if (!files?.length) return;
      await progress(`安装到 ${serial}`, opts => adb.exec(serial, [files.length > 1 ? 'install-multiple' : 'install', '-r', ...files.map(f => f.fsPath)], opts)); },
    importLogcat: async () => importLogcat(ctx, adb, error),
    logcat: async () => { const serial = await device(); openLogcat(ctx, adb, serial, error, undefined, v.ViewColumn.Active, currentPackage); }
  };
  async function buildAndRun(clearData) {
    trust(); const serial = await device(), p = await getProject();
    const wrapper = path.join(p, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'); await fs.access(wrapper);
    const gradle = (taskArgs, opts) => process.platform === 'win32' ? c.run('cmd.exe', ['/d', '/c', 'gradlew.bat', ...taskArgs], { ...opts, cwd: p }) : c.run('/bin/sh', [wrapper, ...taskArgs], { ...opts, cwd: p });
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'android-run-targets-'));
    let targets;
    try {
      const init = path.join(temp, 'targets.gradle'); await fs.writeFile(init, runTargets.initScript);
      const listing = await progress('识别应用模块', opts => gradle(['help', '--init-script', init, '--no-configuration-cache', '--no-configure-on-demand', '--console=plain', '-q'], opts));
      targets = runTargets.parseTargets(listing);
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
    const choices = runTargets.preferredTargets(targets, ctx.workspaceState.get(`runTask:${p}`));
    if (!choices.length) throw new Error('未找到可运行的 Android 应用变体');
    const target = choices.length === 1 ? choices[0] : (await v.window.showQuickPick(choices.map(t => ({ label: t.task.split(':').slice(0,-1).join(':') || ':', description: t.variant, target:t })), { placeHolder: '选择要运行的应用／渠道（将记住选择）' }))?.target;
    if (!target) return;
    await ctx.workspaceState.update(`runTask:${p}`, target.task);
    await progress(`构建 ${target.task}`, opts => gradle([target.task, '--console=plain'], opts));
    const artifacts = runTargets.targetArtifacts(await c.artifacts(target.outputDir), target);
    const universal = artifacts.filter(a => !a.filters.length);
    if (universal.length !== 1) throw new Error('未找到当前运行变体的唯一通用 APK，请检查构建产物或拆分 APK 配置');
    const a = universal[0];
    if (a.filters.length) throw new Error('此 APK 含拆分过滤条件，请使用通用 APK 或手动安装完整 APK 集');
    c.packageName(a.packageName);
    if (clearData && !await confirm(`清除数据并运行：${serial} / ${p} / ${a.packageName}？应用数据将被永久删除。`)) return;
    await progress(`安装 ${serial}`, opts => adb.exec(serial, ['install', '-r', a.apk], opts));
    await ctx.workspaceState.update(`package:${p}`, c.packageName(a.packageName));
    if (clearData) {
      const result = await adb.shell(serial, ['pm', 'clear', a.packageName]);
      if (result.trim() !== 'Success') throw new Error(result || '清除应用数据失败');
    }
    await launch(serial, a.packageName);
  }
  async function launch(serial, packageId) {
    const component = (await adb.shell(serial, ['cmd', 'package', 'resolve-activity', '--brief', packageId])).trim().split(/\r?\n/).pop();
    if (!component?.includes('/')) throw new Error('找不到可启动 Activity');
    const result = await adb.shell(serial, ['am', 'start', '-n', component]); if (/Error:|Exception/.test(result)) throw new Error(result); output.appendLine(result);
  }
  for (const [id, command] of Object.entries({ stop: ['am', 'force-stop'], uninstall: ['pm', 'uninstall'], clearData: ['pm', 'clear'], revoke: ['pm', 'reset-permissions'] })) {
    handlers[id] = async () => {
      trust(); const serial = await device(), packageId = await pkg(); if (!packageId) return;
      if (['uninstall','clearData','revoke'].includes(id) && !await confirm(`${{uninstall:'卸载应用',clearData:'清空应用数据',revoke:'撤销运行时权限'}[id]}：${serial} / ${project || ''} / ${packageId}？`)) return;
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
  handlers.appSettings = async () => {
    trust(); const serial = await device(), packageId = await pkg(); if (!packageId) return;
    await openSettings(serial, 'android.settings.APPLICATION_DETAILS_SETTINGS', 'package:' + packageId);
  };
  for (const [id, action] of Object.entries({
    dateSettings: 'android.settings.DATE_SETTINGS',
    languageSettings: 'android.settings.LOCALE_SETTINGS',
    developerSettings: 'android.settings.APPLICATION_DEVELOPMENT_SETTINGS'
  })) handlers[id] = async () => { trust(); await openSettings(await device(), action); };
  async function openSettings(serial, action, data) {
    const args = ['am', 'start', '-W', '-a', action];
    if (data) args.push('-d', data);
    const result = await adb.shell(serial, args);
    if (/Error:|Exception/.test(result)) throw new Error(result);
    output.appendLine(result);
  }
  handlers.launch = async () => { trust(); const serial = await device(), packageId = await pkg(); if (packageId) await launch(serial, packageId); };
  for (const directory of [false, true]) handlers[directory ? 'newFolder' : 'newFile'] = async item => {
    trust(); const t = await target(item); const name = await v.window.showInputBox({ prompt: directory ? '文件夹名称' : '文件名称' }); if (!name) return;
    const dest = path.posix.join(t.directory ? t.remote : path.posix.dirname(t.remote), c.filename(name));
    await adb.createFile(t.serial, dest, directory); if (t.directory) refreshFiles(t); else refreshParent(t);
  };
  for (const folder of [false, true]) handlers[folder ? 'uploadFolder' : 'upload'] = async item => {
    trust(); const t = await target(item), dir = t.directory ? t.remote : path.posix.dirname(t.remote);
    const sources = await v.window.showOpenDialog({ canSelectFolders: folder, canSelectFiles: !folder, canSelectMany: true }); if (!sources) return;
    if (!await confirm(`上传至 ${t.serial}:${dir}，合并目录并覆盖同名文件？`)) return;
    await progress('上传到设备', async opts => { for (const source of sources) await adb.pushFile(t.serial, source.fsPath, dir + '/', opts); }); if (t.directory) refreshFiles(t); else refreshParent(t); v.window.showInformationMessage(`上传完成：${t.serial}:${dir}`);
  };
  for (const [id, handler] of Object.entries(handlers)) ctx.subscriptions.push(v.commands.registerCommand(`androidTools.${id}`, (...args) => Promise.resolve().then(() => handler(...args)).catch(e => { error(e); }).finally(() => updateAppView())));
  ctx.subscriptions.push(v.window.registerTreeDataProvider('androidDevices', devicesProvider), filesView = v.window.createTreeView('androidFiles', { treeDataProvider: filesProvider, showCollapseAll: true }), output, status, deviceEvent, fileEvent);
  updateAppView = registerAppView(ctx, () => ({ project: project || '', device: selected || '', packageName: project ? ctx.workspaceState.get(`package:${project}`, '') : '' }), id => v.commands.executeCommand(`androidTools.${id}`));
  updateFileHeader();
  const editStatus = v.window.createStatusBarItem(v.StatusBarAlignment.Right);
  editStatus.command = 'androidTools.save';
  function updateEditStatus() {
    const doc = v.window.activeTextEditor?.document, item = edited.get(doc?.uri.fsPath);
    if (!item) { editStatus.hide(); return; }
    editStatus.text = item.needsUpload || doc.isDirty ? '$(cloud-upload) 待同步设备' : '$(check) 设备文件已同步';
    editStatus.tooltip = `${item.serial}:${item.remote}\n本地保存不会上传；点击同步到设备`;
    editStatus.show();
  }
  ctx.subscriptions.push(editStatus, v.window.onDidChangeActiveTextEditor(updateEditStatus), v.workspace.onDidChangeTextDocument(event => {
    const item = edited.get(event.document.uri.fsPath); if (item) { item.needsUpload = true; updateEditStatus(); }
  }), v.workspace.onDidSaveTextDocument(updateEditStatus));
  let refreshing = false;
  const poll = setInterval(async () => { if (refreshing) return; refreshing = true; try { await refreshDevices(); } catch { /* manual refresh shows ADB setup errors */ } finally { refreshing = false; } }, 5000);
  ctx.subscriptions.push({ dispose() { clearInterval(poll); for (const t of edited.values()) fs.rm(t.temp, { recursive: true, force: true }).catch(() => {}); } });
  ctx.subscriptions.push(v.workspace.onDidChangeWorkspaceFolders(() => { project = undefined; ctx.workspaceState.update('project', undefined); updateAppView(); }));
  refresh().catch(error);
}
module.exports = { activate };
