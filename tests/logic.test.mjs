// logic.js の単体テスト。実行: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTSV,
  mergeCards,
  sortFileNamesOldestFirst,
  eligibleGuids,
  pickNext,
  deckStats,
  weakCards,
  excludedCards,
  deleteDeck,
  validateBackup,
} from '../logic.js';

// 実物 TSV（cards_2026-07-06_reverse-財務.txt）と同形のサンプル
const SAMPLE = [
  '#separator:Tab',
  '#html:true',
  '#notetype:基本',
  '#guid column:3',
  '#deck column:4',
  '#tags column:5',
  '#columns:表面\t裏面\tguid\tdeck\ttags',
  '説明文A<br>2行目\tCAPM\tguid-a\tKB::逆引き::財務\ttag1 tag2',
  '説明文B\tEBITDA\tguid-b\tKB::逆引き::財務\t',
  '列が\t足りない行',
  '説明文C\tPER\tguid-c\tKB::逆引き::税制\ttag3',
].join('\r\n');

test('parseTSV: ヘッダをスキップし5列だけ取り込む', () => {
  const r = parseTSV(SAMPLE);
  assert.equal(r.sawHeader, true);
  assert.equal(r.cards.length, 3);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.cards[0], {
    front: '説明文A<br>2行目',
    back: 'CAPM',
    guid: 'guid-a',
    deck: 'KB::逆引き::財務',
    tags: 'tag1 tag2',
  });
});

test('parseTSV: ヘッダ無しファイルは sawHeader=false', () => {
  const r = parseTSV('ただのテキスト\nもう1行');
  assert.equal(r.sawHeader, false);
  assert.equal(r.cards.length, 0);
});

test('parseTSV: 空ファイル・空行のみでも壊れない', () => {
  const r = parseTSV('\n\n');
  assert.equal(r.cards.length, 0);
  assert.equal(r.skipped, 0);
});

test('parseTSV: guid/front/back が空の行はスキップ', () => {
  const r = parseTSV('#separator:Tab\n\turaA\tg1\td1\tt1\nomoteB\turaB\t\td1\tt1');
  assert.equal(r.cards.length, 0);
  assert.equal(r.skipped, 2);
});

test('mergeCards: 新規追加と GUID 上書き更新、無いカードは保持', () => {
  const existing = {
    'guid-a': { front: '旧A', back: 'A', deck: 'D1', tags: '' },
    'guid-x': { front: 'X', back: 'X', deck: 'D1', tags: '' },
  };
  const incoming = [
    { front: '新A', back: 'A', guid: 'guid-a', deck: 'D1', tags: '' },
    { front: 'B', back: 'B', guid: 'guid-b', deck: 'D2', tags: '' },
  ];
  const r = mergeCards(existing, incoming);
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.cards['guid-a'].front, '新A'); // 上書き
  assert.ok(r.cards['guid-x']); // 増分に無くても保持
  assert.equal(Object.keys(r.cards).length, 3);
  assert.equal(existing['guid-a'].front, '旧A'); // 元オブジェクトは破壊しない
});

test('sortFileNamesOldestFirst: 日付付きファイル名が古い順になる', () => {
  const r = sortFileNamesOldestFirst([
    'cards_2026-07-06_reverse-財務.txt',
    'cards_2026-06-15_reverse.txt',
    'cards_2026-06-10.txt',
  ]);
  assert.deepEqual(r, [
    'cards_2026-06-10.txt',
    'cards_2026-06-15_reverse.txt',
    'cards_2026-07-06_reverse-財務.txt',
  ]);
});

const CARDS = {
  g1: { front: 'f1', back: 'b1', deck: 'D1', tags: '' },
  g2: { front: 'f2', back: 'b2', deck: 'D1', tags: '' },
  g3: { front: 'f3', back: 'b3', deck: 'D2', tags: '' },
};

test('eligibleGuids: 選択デッキ内の未除外のみ', () => {
  const state = { g2: { excluded: true, correct: 0, wrong: 0 } };
  assert.deepEqual(eligibleGuids(CARDS, state, ['D1']), ['g1']);
  assert.deepEqual(eligibleGuids(CARDS, state, ['D1', 'D2']).sort(), ['g1', 'g3']);
  assert.deepEqual(eligibleGuids(CARDS, state, []), []);
});

test('pickNext: 直前カードを連続で出さない・1枚なら許容・0枚は null', () => {
  assert.equal(pickNext([], null), null);
  assert.equal(pickNext(['g1'], 'g1'), 'g1');
  for (let i = 0; i < 20; i++) {
    const picked = pickNext(['g1', 'g2', 'g3'], 'g2', Math.random);
    assert.notEqual(picked, 'g2');
  }
  // rand 注入で決定的に検証（pool は last 除外後の ['g1','g3']）
  assert.equal(pickNext(['g1', 'g2', 'g3'], 'g2', () => 0.99), 'g3');
});

test('deckStats: デッキ別集計と正答率', () => {
  const state = {
    g1: { excluded: false, correct: 3, wrong: 1 },
    g2: { excluded: true, correct: 0, wrong: 0 },
  };
  const r = deckStats(CARDS, state);
  const d1 = r.find((d) => d.deck === 'D1');
  assert.equal(d1.total, 2);
  assert.equal(d1.excluded, 1);
  assert.equal(d1.accuracy, 0.75);
  const d2 = r.find((d) => d.deck === 'D2');
  assert.equal(d2.accuracy, null); // 未回答は null（0% と区別）
});

test('weakCards: 間違い多い順・間違いゼロは含めない', () => {
  const state = {
    g1: { excluded: false, correct: 5, wrong: 1 },
    g2: { excluded: false, correct: 0, wrong: 3 },
    g3: { excluded: false, correct: 9, wrong: 0 },
  };
  const r = weakCards(CARDS, state);
  assert.deepEqual(r.map((c) => c.guid), ['g2', 'g1']);
});

test('excludedCards: 除外中のみ返す', () => {
  const state = { g3: { excluded: true, correct: 0, wrong: 0 } };
  assert.deepEqual(excludedCards(CARDS, state).map((c) => c.guid), ['g3']);
});

test('validateBackup: 正当なバックアップは ok', () => {
  const r = validateBackup({ version: '1.0.0', cards: CARDS, state: {} });
  assert.equal(r.ok, true);
});

test('validateBackup: 欠損・型不正は理由付きで拒否', () => {
  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup({ cards: {} }).ok, false); // state 欠損
  assert.equal(validateBackup({ cards: { g: { front: 1, back: 'b', deck: 'd' } }, state: {} }).ok, false);
});

test('validateBackup: 正誤カウントが数値でない state は拒否', () => {
  const bad = { cards: CARDS, state: { g1: { excluded: false, correct: '3', wrong: 0 } } };
  assert.equal(validateBackup(bad).ok, false);
  const good = { cards: CARDS, state: { g1: { excluded: false, correct: 3, wrong: 0 } } };
  assert.equal(validateBackup(good).ok, true);
});

test('deleteDeck: 対象デッキのカードと統計だけ消え、他デッキは残る', () => {
  const state = {
    g1: { excluded: false, correct: 2, wrong: 1 },
    g3: { excluded: true, correct: 0, wrong: 4 },
  };
  const r = deleteDeck(CARDS, state, 'D1');
  assert.equal(r.removed, 2);
  assert.deepEqual(Object.keys(r.cards), ['g3']);
  assert.deepEqual(r.state, { g3: { excluded: true, correct: 0, wrong: 4 } });
});

test('deleteDeck: 存在しないデッキは no-op（removed=0）', () => {
  const state = { g1: { excluded: false, correct: 1, wrong: 0 } };
  const r = deleteDeck(CARDS, state, '存在しないデッキ');
  assert.equal(r.removed, 0);
  assert.deepEqual(r.cards, CARDS);
  assert.deepEqual(r.state, state);
});

test('deleteDeck: 引数の cards/state を変更しない（純粋性）', () => {
  const cards = { ...CARDS };
  const state = { g1: { excluded: false, correct: 1, wrong: 0 } };
  deleteDeck(cards, state, 'D1');
  assert.deepEqual(cards, CARDS);
  assert.deepEqual(state, { g1: { excluded: false, correct: 1, wrong: 0 } });
});

test('deleteDeck: state に無い guid のカードでも安全に消える', () => {
  const r = deleteDeck(CARDS, {}, 'D2');
  assert.equal(r.removed, 1);
  assert.deepEqual(Object.keys(r.cards).sort(), ['g1', 'g2']);
  assert.deepEqual(r.state, {});
});
