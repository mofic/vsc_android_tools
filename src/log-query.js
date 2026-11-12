'use strict';
const levels = { V:0, VERBOSE:0, D:1, DEBUG:1, I:2, INFO:2, W:3, WARN:3, E:4, ERROR:4, F:5, ASSERT:5 };
function compileQuery(query = '', { mine = [], now = () => Date.now() } = {}) {
  if (typeof query !== 'string' || query.length > 2000) throw new Error('查询长度不能超过 2000 字符');
  const tokens = []; let i = 0;
  while (i < query.length) {
    if (/\s/.test(query[i])) { i++; continue; }
    if ('()&|'.includes(query[i])) { tokens.push({ op:query[i++] }); continue; }
    let text = '', quoted = false;
    while (i < query.length && !/[\s()&|]/.test(query[i])) {
      if (query[i] === '"' || query[i] === "'") {
        const delimiter = query[i++]; quoted ||= text.length === 0;
        while (i < query.length && query[i] !== delimiter) {
          if (query[i] === '\\' && query[i+1] === delimiter) i++;
          text += query[i++];
        }
        if (query[i++] !== delimiter) throw new Error('查询引号未闭合');
      } else text += query[i++];
    }
    tokens.push({ text, quoted });
    if (tokens.length > 100) throw new Error('查询条件过多');
  }
  let cursor = 0, depth = 0, name = '', usesMine = false, usesAge = false;
  function term() {
    const token = tokens[cursor++];
    if (!token) throw new Error('查询缺少条件');
    if (token.op === '(') {
      if (++depth > 12) throw new Error('查询括号嵌套过深');
      const result = or(); if (tokens[cursor++]?.op !== ')') throw new Error('查询括号未闭合'); depth--; return { test:result };
    }
    if (token.op) throw new Error(`意外的运算符 ${token.op}`);
    const match = !token.quoted && token.text.match(/^(-?)([a-z]+)(~?):(.*)$/i);
    if (!match) return { test:e => e.line.toLowerCase().includes(token.text.toLowerCase()) };
    const [, negative, rawKey, regexFlag] = match, key = rawKey.toLowerCase();
    let value = match[4];
    if (!value && tokens[cursor]?.text !== undefined) value = tokens[cursor++].text;
    if (!value) throw new Error(`${key}: 缺少值`);
    if (regexFlag && !['tag','package','process','message','line'].includes(key)) throw new Error(`${key} 不支持正则修饰符`);
    let test;
    if (key === 'name') { name = value; test = () => true; }
    else if (key === 'level') {
      const minimum = levels[value.toUpperCase()]; if (minimum === undefined) throw new Error('无效日志级别');
      test = e => levels[e.level] >= minimum;
    } else if (key === 'age') {
      const duration = value.match(/^(\d+)([smhd])$/i); if (!duration) throw new Error('age 格式示例：5m、30s');
      usesAge = true;
      const milliseconds = Number(duration[1]) * ({s:1000,m:60000,h:3600000,d:86400000})[duration[2].toLowerCase()];
      if (!Number.isFinite(milliseconds)) throw new Error('age 数值过大');
      test = e => Number.isFinite(e.timestamp) && e.timestamp >= now() - milliseconds && e.timestamp <= now();
    } else if (key === 'is') {
      if (!['crash','stacktrace'].includes(value)) throw new Error('is 仅支持 crash / stacktrace');
      test = value === 'crash' ? e => /FATAL EXCEPTION|Fatal signal|am_crash|crash_dump|>>> .* <<</i.test(e.line) : e => /^\s*(at\s+[\w.$]+\(|Caused by:|Suppressed:)/.test(e.message || e.line);
    } else if (['tag','package','process','message','line'].includes(key)) {
      const read = e => key === 'package' ? (e.processName || '').split(':')[0] : key === 'process' ? e.processName || '' : key === 'message' ? e.message ?? e.line : e[key] || '';
      if (key === 'package' && value === 'mine' && !regexFlag) { usesMine = true; test = e => mine.includes(read(e)); }
      else if (regexFlag) {
        if (/\([^)]*[+*][^)]*\)[+*{]/.test(value)) throw new Error('请避免嵌套重复的正则表达式');
        const regex = new RegExp(value, 'i'); test = e => regex.test(read(e));
      } else test = e => read(e).toLowerCase().includes(value.toLowerCase());
    } else throw new Error(`未知查询字段：${key}`);
    return { key:negative ? undefined : key, test:negative ? e => !test(e) : test };
  }
  function and() {
    const groups = []; let implicit = [];
    const flush = () => {
      const grouped = new Map(), others = [];
      for (const item of implicit) { if (item.key) { const list = grouped.get(item.key) || []; list.push(item.test); grouped.set(item.key,list); } else others.push(item.test); }
      groups.push(e => others.every(f=>f(e)) && [...grouped.values()].every(list=>list.some(f=>f(e)))); implicit = [];
    };
    implicit.push(term());
    while (cursor < tokens.length && !['|',')'].includes(tokens[cursor].op)) {
      if (tokens[cursor].op === '&') { cursor++; flush(); }
      implicit.push(term());
    }
    flush(); return e => groups.every(f=>f(e));
  }
  function or() { const alternatives = [and()]; while (tokens[cursor]?.op === '|') { cursor++; alternatives.push(and()); } return e=>alternatives.some(f=>f(e)); }
  const test = tokens.length ? or() : () => true;
  if (cursor !== tokens.length) throw new Error('查询存在多余括号或条件');
  return { test, name, usesMine, usesAge };
}
module.exports = { compileQuery };
