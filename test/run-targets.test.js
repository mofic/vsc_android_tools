'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseTargets,preferredTargets,targetArtifacts}=require('../src/run-targets');
const debug={task:':app:assembleDebug',variant:'debug',buildType:'debug',outputDir:'/project/app/build/outputs/apk'};
const release={...debug,task:':app:assembleRelease',variant:'release',buildType:'release'};
test('run defaults to application debug and reuses only valid remembered targets',()=>{
 assert.deepEqual(preferredTargets([release,debug]),[debug]);
 assert.deepEqual(preferredTargets([release,debug],release.task),[release]);
 assert.deepEqual(preferredTargets([debug],':deleted:assembleDebug'),[debug]);
 const flavor={...debug,task:':app:assembleFreeDebug',variant:'freeDebug'};
 assert.equal(preferredTargets([debug,flavor]).length,2);
 assert.deepEqual(preferredTargets([]),[]);
});
test('model parsing accepts application paths and rejects invalid model output',()=>{
 assert.deepEqual(parseTargets('noise\nANDROID_TOOLS_TARGETS='+JSON.stringify([debug])),[debug]);
 assert.equal(parseTargets('ANDROID_TOOLS_TARGETS='+JSON.stringify([{...debug,task:':assembleDebug'}])).length,1);
 for(const bad of ['no model','ANDROID_TOOLS_TARGETS={}','ANDROID_TOOLS_TARGETS='+JSON.stringify([{...debug,task:'--help'}])])assert.throws(()=>parseTargets(bad));
});
test('install only uses the built module and variant',()=>{
 const apk=debug.outputDir+'/debug/app.apk';
 const artifacts=[{apk,variant:'debug',filters:[]},{apk:debug.outputDir+'/release/app.apk',variant:'release'},{apk:'/project/other/build/outputs/apk/debug/app.apk',variant:'debug'},{apk:debug.outputDir+'-other/debug/app.apk',variant:'debug'}];
 assert.deepEqual(targetArtifacts(artifacts,debug),[artifacts[0]]);
});
