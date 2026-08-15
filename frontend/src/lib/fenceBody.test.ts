import { describe, expect, test } from 'vitest';
import { locateFenceBody, replaceFenceBody } from './fenceBody';

/**
 * 圍欄程式碼區塊「內文定位與替換」的單元測試。
 *
 * 對應設計文件 §4（程式碼區塊直編）、§9.1（fenceBody 測試計畫）與 v2 修訂第 8（blockquote
 * 前綴同 tableSpec 一套）、9（CRLF）、17（縮排「程式碼區塊」非圍欄、不在本模組職責）條。
 *
 * 收尾判定＝同前綴、同圍欄字元（``` 或 ~~~）、長度 ≥ 起始圍欄（CommonMark）；
 * 內文含 ``` 字樣但前綴／長度不符 → 不當收尾。找不到收尾（未閉合）→ 內文到最後一行。
 */

describe('locateFenceBody：圍欄內文定位', () => {
  const simple = ['前文', '```js', 'const a = 1;', 'const b = 2;', '```', '後文'].join('\n');

  test('基本 ``` 圍欄：回內文行索引範圍（0-based、含首尾）與圍欄資訊', () => {
    expect(locateFenceBody(simple, 2)).toEqual({
      bodyStart: 2,
      bodyEnd: 3,
      prefix: '',
      fenceChar: '`',
      fenceLen: 3,
    });
  });

  test('~~~ 圍欄也支援', () => {
    const content = ['~~~', 'x', '~~~'].join('\n');
    expect(locateFenceBody(content, 1)).toEqual({
      bodyStart: 1,
      bodyEnd: 1,
      prefix: '',
      fenceChar: '~',
      fenceLen: 3,
    });
  });

  test('起始圍欄帶資訊字串（lang:filename）不影響定位', () => {
    const content = ['```ts:app.ts', 'x', '```'].join('\n');
    expect(locateFenceBody(content, 1)).toMatchObject({ bodyStart: 1, bodyEnd: 1 });
  });

  test('blockquote 前綴：收尾須同前綴，回傳 prefix', () => {
    const content = ['> ```', '> code1', '> code2', '> ```'].join('\n');
    expect(locateFenceBody(content, 1)).toEqual({
      bodyStart: 1,
      bodyEnd: 2,
      prefix: '> ',
      fenceChar: '`',
      fenceLen: 3,
    });
  });

  test('疑似收尾但前綴不符（blockquote 圍欄裡的裸 ```）→ 整塊降級回 null（v2-8：不炸不寫壞）', () => {
    // 裸 ``` 在 CommonMark 會終止 blockquote 容器，純函數掃描無法安全判定內文範圍——
    // 有歧義就降級為不可直編，絕不猜（猜錯會把圍欄外內容當內文吃掉）。
    const content = ['> ```', '> a', '```', '> b', '> ```'].join('\n');
    expect(locateFenceBody(content, 1)).toBeNull();
  });

  test('內文含 ``` 但長度不足 → 不當收尾（四反引號圍欄裡的三反引號）', () => {
    const content = ['````', '```', '````'].join('\n');
    expect(locateFenceBody(content, 1)).toEqual({
      bodyStart: 1,
      bodyEnd: 1,
      prefix: '',
      fenceChar: '`',
      fenceLen: 4,
    });
  });

  test('收尾長度可比起始長（CommonMark：長度 ≥ 起始即closes）', () => {
    const content = ['```', 'a', '````'].join('\n');
    expect(locateFenceBody(content, 1)).toMatchObject({ bodyStart: 1, bodyEnd: 1 });
  });

  test('疑似收尾行帶尾隨文字 → 不當收尾', () => {
    const content = ['```', 'a', '``` x', '```'].join('\n');
    expect(locateFenceBody(content, 1)).toMatchObject({ bodyStart: 1, bodyEnd: 2 });
  });

  test('圍欄字元不同 → 不當收尾（``` 圍欄內的 ~~~）', () => {
    const content = ['```', 'a', '~~~', '```'].join('\n');
    expect(locateFenceBody(content, 1)).toMatchObject({ bodyStart: 1, bodyEnd: 2 });
  });

  test('縮排前綴：同縮排收尾正常定位', () => {
    const content = ['  ```', '  a', '  ```'].join('\n');
    expect(locateFenceBody(content, 1)).toMatchObject({ bodyStart: 1, bodyEnd: 1, prefix: '  ' });
  });

  test('疑似收尾但縮排不符 → 整塊降級回 null（不猜收尾位置）', () => {
    // CommonMark 其實允許收尾縮排 0-3 格與起始不同——本模組刻意收窄為「前綴完全一致」，
    // 對不上就降級（回 null）而非跳過去繼續掃：跳過去可能誤配到後面不相干的圍欄、
    // 把中間的真實內容當程式碼內文吃掉（對抗式復審 CRITICAL 的回歸鎖）。
    const content = ['  ```', '  a', '```', '  ```'].join('\n');
    expect(locateFenceBody(content, 1)).toBeNull();
  });

  test('回歸鎖（資料遺失防護）：縮排收尾被跳過後誤配到後面不相干圍欄 → 一律 null、replace 不吃內容', () => {
    // 情境：使用者手動把收尾圍欄多縮排 3 格（CommonMark 合法收尾），
    // 後面又剛好有另一個程式碼區塊——絕不能把「   ```」與後面段落當成內文改寫掉。
    const content = ['```', 'code', '   ```', '圍欄外的真實段落', '```', 'other', '```'].join('\n');
    expect(locateFenceBody(content, 1)).toBeNull();
    expect(replaceFenceBody(content, 1, 'x = 1')).toBeNull();
  });

  test('未閉合圍欄 → 內文到文件最後一行', () => {
    const content = ['```', 'a', 'b'].join('\n');
    expect(locateFenceBody(content, 1)).toMatchObject({ bodyStart: 1, bodyEnd: 2 });
  });

  test('空內文（開圍欄緊接收尾）→ bodyEnd < bodyStart 的空範圍', () => {
    const content = ['```', '```'].join('\n');
    expect(locateFenceBody(content, 1)).toMatchObject({ bodyStart: 1, bodyEnd: 0 });
  });

  test('fenceLine 指到非圍欄行 → 回 null', () => {
    expect(locateFenceBody(simple, 1)).toBeNull(); // 第 1 行是「前文」
  });

  test('fenceLine 越界 → 回 null', () => {
    expect(locateFenceBody(simple, 0)).toBeNull();
    expect(locateFenceBody(simple, 99)).toBeNull();
  });

  test('CRLF 內容：定位結果與 LF 相同、prefix 不含 \\r', () => {
    const content = ['> ```', '> code', '> ```'].join('\r\n');
    expect(locateFenceBody(content, 1)).toEqual({
      bodyStart: 1,
      bodyEnd: 1,
      prefix: '> ',
      fenceChar: '`',
      fenceLen: 3,
    });
  });
});

describe('replaceFenceBody：圍欄內文替換', () => {
  const simple = ['前文', '```js', 'const a = 1;', 'const b = 2;', '```', '後文'].join('\n');

  test('替換內文，其餘行位元組不變', () => {
    expect(replaceFenceBody(simple, 2, 'x = 9')).toBe(
      ['前文', '```js', 'x = 9', '```', '後文'].join('\n')
    );
  });

  test('內文行數可增減（2 行換成 3 行）', () => {
    expect(replaceFenceBody(simple, 2, 'l1\nl2\nl3')).toBe(
      ['前文', '```js', 'l1', 'l2', 'l3', '```', '後文'].join('\n')
    );
  });

  test('blockquote 前綴逐行補回（含空行）', () => {
    const content = ['> ```', '> old', '> ```'].join('\n');
    expect(replaceFenceBody(content, 1, 'a\n\nb')).toBe(
      ['> ```', '> a', '> ', '> b', '> ```'].join('\n')
    );
  });

  test('newBody 為空字串 → 內文清空（零行）', () => {
    const content = ['```js', 'a', '```'].join('\n');
    expect(replaceFenceBody(content, 1, '')).toBe(['```js', '```'].join('\n'));
  });

  test('未閉合圍欄：替換到文件末尾、不自行補收尾', () => {
    const content = ['```', 'old1', 'old2'].join('\n');
    expect(replaceFenceBody(content, 1, 'new')).toBe(['```', 'new'].join('\n'));
  });

  test('CRLF 內容：新內文行也用 CRLF、整份行尾風格一致', () => {
    const content = ['```', 'old', '```'].join('\r\n');
    expect(replaceFenceBody(content, 1, 'n1\nn2')).toBe(['```', 'n1', 'n2', '```'].join('\r\n'));
  });

  test('newBody 自帶 CRLF 換行 → 正規化處理不外洩 \\r', () => {
    const content = ['```', 'old', '```'].join('\n');
    expect(replaceFenceBody(content, 1, 'n1\r\nn2')).toBe(['```', 'n1', 'n2', '```'].join('\n'));
  });

  test('fenceLine 非圍欄行 → 回 null', () => {
    expect(replaceFenceBody('普通文字', 1, 'x')).toBeNull();
    expect(replaceFenceBody(simple, 1, 'x')).toBeNull();
  });

  test('round-trip：以原內文替換 → 整份內容位元組不變', () => {
    expect(replaceFenceBody(simple, 2, 'const a = 1;\nconst b = 2;')).toBe(simple);
  });

  test('blockquote round-trip：剝掉前綴的內文原樣塞回 → 位元組不變', () => {
    const content = ['> ```', '> code1', '> code2', '> ```'].join('\n');
    expect(replaceFenceBody(content, 1, 'code1\ncode2')).toBe(content);
  });
});
