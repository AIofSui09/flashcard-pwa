// logic.js — 純粋ロジック層（UI・localStorage 非依存）
// ブラウザ（app.js から import）と Node（tests/logic.test.mjs）の両方から使う。

// make-anki-cards の TSV（#ヘッダ行＋5列: 表面\t裏面\tguid\tdeck\ttags）を解析する。
// ヘッダ行（# 始まり）が1行も無いファイルはカード TSV とみなさない（sawHeader で判定）。
export function parseTSV(text) {
  const lines = text.split(/\r?\n/);
  const cards = [];
  let skipped = 0;
  let sawHeader = false;
  for (const line of lines) {
    if (line.trim() === '') continue;
    if (line.startsWith('#')) {
      sawHeader = true;
      continue;
    }
    const cols = line.split('\t');
    if (cols.length !== 5) {
      skipped++;
      continue;
    }
    const [front, back, guid, deck, tags] = cols;
    if (!front || !back || !guid) {
      skipped++;
      continue;
    }
    cards.push({ front, back, guid, deck: deck || '未分類', tags: tags || '' });
  }
  return { cards, skipped, sawHeader };
}

// GUID キーで累積マージする。増分エクスポート対応のため、incoming に無い既存カードは残す。
// 統計・除外状態（state）は別マップなので、ここでは触らない＝自然に保持される。
export function mergeCards(existing, incoming) {
  const cards = { ...existing };
  let added = 0;
  let updated = 0;
  for (const c of incoming) {
    if (Object.prototype.hasOwnProperty.call(cards, c.guid)) {
      updated++;
    } else {
      added++;
    }
    cards[c.guid] = { front: c.front, back: c.back, deck: c.deck, tags: c.tags };
  }
  return { cards, added, updated };
}

// 複数ファイルの取込順（古い順）。cards_YYYY-MM-DD… 形式は辞書順＝日付順になる。
export function sortFileNamesOldestFirst(names) {
  return [...names].sort((a, b) => a.localeCompare(b, 'en'));
}

// 選択デッキ内の出題対象（未除外）guid 一覧。
export function eligibleGuids(cards, state, selectedDecks) {
  const decks = new Set(selectedDecks);
  return Object.entries(cards)
    .filter(([guid, c]) => decks.has(c.deck) && !(state[guid] && state[guid].excluded))
    .map(([guid]) => guid);
}

// ランダムに次のカードを選ぶ。2枚以上あるときは直前のカードを連続で出さない。
export function pickNext(guids, lastGuid, rand = Math.random) {
  if (guids.length === 0) return null;
  if (guids.length === 1) return guids[0];
  const pool = guids.filter((g) => g !== lastGuid);
  return pool[Math.floor(rand() * pool.length)];
}

// デッキ別の集計（カード数・除外数・正誤累計・正答率）。deck 名でソートして返す。
export function deckStats(cards, state) {
  const map = new Map();
  for (const [guid, c] of Object.entries(cards)) {
    if (!map.has(c.deck)) {
      map.set(c.deck, { deck: c.deck, total: 0, excluded: 0, correct: 0, wrong: 0 });
    }
    const d = map.get(c.deck);
    d.total++;
    const s = state[guid];
    if (s) {
      if (s.excluded) d.excluded++;
      d.correct += s.correct || 0;
      d.wrong += s.wrong || 0;
    }
  }
  return [...map.values()]
    .map((d) => ({
      ...d,
      accuracy: d.correct + d.wrong > 0 ? d.correct / (d.correct + d.wrong) : null,
    }))
    .sort((a, b) => a.deck.localeCompare(b.deck, 'ja'));
}

// 苦手カード: 間違い1回以上を、間違い多い順→正解少ない順で返す。
export function weakCards(cards, state, limit = 20) {
  return Object.entries(cards)
    .map(([guid, c]) => {
      const s = state[guid] || {};
      return { guid, ...c, correct: s.correct || 0, wrong: s.wrong || 0 };
    })
    .filter((c) => c.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || a.correct - b.correct)
    .slice(0, limit);
}

// 除外中カードの一覧。
export function excludedCards(cards, state) {
  return Object.entries(cards)
    .filter(([guid]) => state[guid] && state[guid].excluded)
    .map(([guid, c]) => ({ guid, ...c }))
    .sort((a, b) => a.deck.localeCompare(b.deck, 'ja') || a.back.localeCompare(b.back, 'ja'));
}

// バックアップ JSON の検証。壊れたデータで現状を上書きしないための入口ゲート。
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'JSON がオブジェクトではありません' };
  if (!obj.cards || typeof obj.cards !== 'object') return { ok: false, reason: 'cards がありません' };
  if (!obj.state || typeof obj.state !== 'object') return { ok: false, reason: 'state がありません' };
  for (const [guid, c] of Object.entries(obj.cards)) {
    if (!c || typeof c.front !== 'string' || typeof c.back !== 'string' || typeof c.deck !== 'string') {
      return { ok: false, reason: `カード ${guid} の形式が不正です` };
    }
  }
  for (const [guid, s] of Object.entries(obj.state)) {
    if (!s || typeof s !== 'object') {
      return { ok: false, reason: `state ${guid} の形式が不正です` };
    }
    if (('correct' in s && typeof s.correct !== 'number') || ('wrong' in s && typeof s.wrong !== 'number')) {
      return { ok: false, reason: `state ${guid} の正誤カウントが数値ではありません` };
    }
  }
  return { ok: true };
}
