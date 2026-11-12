'use strict';
const path = require('node:path');
// Query evaluated application variants: library and test modules never enter the list.
const initScript = `def androidToolsTargets = []
gradle.beforeProject { p ->
  p.pluginManager.withPlugin('com.android.application') {
    def components = p.extensions.getByName('androidComponents')
    components.onVariants(components.selector().all()) { variant ->
      def name = variant.name
      androidToolsTargets.add([
        task: (p.path == ':' ? ':' : p.path + ':') + 'assemble' + name.capitalize(),
        variant: name,
        buildType: variant.buildType,
        outputDir: p.layout.buildDirectory.dir('outputs/apk').get().asFile.absolutePath
      ])
    }
  }
}
gradle.projectsEvaluated {
  println('ANDROID_TOOLS_TARGETS=' + groovy.json.JsonOutput.toJson(androidToolsTargets))
}
`;
function parseTargets(output) {
  const line = output.split(/\r?\n/).find(line => line.startsWith('ANDROID_TOOLS_TARGETS='));
  if (!line) throw new Error('无法识别应用模块，请确认项目使用 Android application 插件及 AGP 7.0 或更高版本');
  const targets = JSON.parse(line.slice('ANDROID_TOOLS_TARGETS='.length));
  if (!Array.isArray(targets) || targets.some(t => !t || typeof t.task !== 'string' || !/^:(?:[\w.-]+:)*assemble\w+$/.test(t.task) || typeof t.variant !== 'string' || !t.variant || typeof t.outputDir !== 'string' || !path.isAbsolute(t.outputDir))) throw new Error('无效的应用构建目标');
  return targets;
}
function preferredTargets(targets, remembered) {
  const previous = targets.find(t => t.task === remembered);
  if (previous) return [previous];
  const debug = targets.filter(t => t.buildType === 'debug');
  return debug.length ? debug : targets;
}
function targetArtifacts(artifacts, target) {
  const prefix = path.resolve(target.outputDir) + path.sep;
  return artifacts.filter(a => a.variant === target.variant && path.resolve(a.apk).startsWith(prefix));
}
module.exports = { initScript, parseTargets, preferredTargets, targetArtifacts };
