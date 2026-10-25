'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { compare } = require('../ranking');

test('离线浏览器与服务器采用相同排序，旧记录和相同成绩顺序稳定', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../ranking.js'), 'utf8'), context);
  const records = [
    { name: '高总分', maxTile: 64, score: 9999, at: 1 },
    { name: '晚提交', maxTile: 128, score: 200, at: 30 },
    { name: '早提交', maxTile: 128, score: 200, at: 20 },
    { name: '完全相同', maxTile: 128, score: 200, at: 20 },
    { name: '总分更高', maxTile: 128, score: 300, at: 40 },
    { name: '最大块', maxTile: '256', score: '4', at: 50 }
  ];
  const expected = ['最大块', '总分更高', '早提交', '完全相同', '晚提交', '高总分'];
  assert.deepEqual([...records].sort(compare).map(entry => entry.name), expected);
  assert.deepEqual([...records].sort(context.MskwRanking.compare).map(entry => entry.name), expected);
});
