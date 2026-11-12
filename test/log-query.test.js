const {test}=require('node:test');const assert=require('node:assert/strict');const {compileQuery}=require('../src/log-query');
const e={line:'11-12 E Network: failed request',level:'E',tag:'Network',message:'failed request',processName:'com.demo:remote',timestamp:10000};
test('Studio queries combine fields, exclusions, regex, mine and groups',()=>{
 assert.ok(compileQuery('package:mine level:ERROR -tag:Noise',{mine:['com.demo']}).test(e));
 assert.ok(compileQuery('(tag:Other | tag:Network) & message~:"failed.*request"').test(e));
 assert.ok(compileQuery('tag:Other tag:Network').test(e));
 assert.equal(compileQuery('tag:Other & tag:Network').test(e),false);
 assert.equal(compileQuery('-package:demo').test(e),false);
 assert.ok(compileQuery('name:"Network errors" process:remote').name==='Network errors');
 assert.ok(compileQuery('age:5s',{now:()=>12000}).test(e));
 assert.equal(compileQuery('age:1s',{now:()=>12000}).test(e),false);
 assert.ok(compileQuery('message:"failed request"').test(e));
 assert.ok(compileQuery('is:crash').test({...e,line:'FATAL EXCEPTION: main'}));
 for(const query of ['tag:', '(tag:x', 'tag:"x', 'bad:x','level:NO','age:foo','tag:x |'])assert.throws(()=>compileQuery(query));
});
