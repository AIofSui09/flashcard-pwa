// app.js — UI と保存（localStorage）の配線。ロジックは logic.js に分離。
import {
  parseTSV,
  mergeCards,
  sortFileNamesOldestFirst,
  eligibleGuids,
  pickNext,
  deckStats,
  weakCards,
  excludedCards,
  validateBackup,
} from './logic.js';

export const APP_VERSION = '1.0.1'; // sw.js の CACHE_VERSION と揃えて更新する

const KEYS = { cards: 'sfc.cards', state: 'sfc.state', meta: 'sfc.meta' };

// ---------- 保存層 ----------

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    toast('保存に失敗しました（容量不足の可能性）。変更は反映されていません');
    return false;
  }
}

let cards = loadJSON(KEYS.cards, {});
let state = loadJSON(KEYS.state, {});
let meta = loadJSON(KEYS.meta, { selectedDecks: [], lastImport: null });

// ---------- 画面切替 ----------

const screens = {
  home: document.getElementById('screen-home'),
  study: document.getElementById('screen-study'),
  stats: document.getElementById('screen-stats'),
};

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  window.scrollTo(0, 0);
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('visible'), 4000);
}

// ---------- ホーム画面 ----------

function renderHome() {
  const stats = deckStats(cards, state);
  const empty = document.getElementById('empty-state');
  const deckArea = document.getElementById('deck-area');
  empty.hidden = stats.length > 0;
  deckArea.hidden = stats.length === 0;

  const list = document.getElementById('deck-list');
  list.textContent = '';
  const selected = new Set(meta.selectedDecks);
  for (const d of stats) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = d.deck;
    cb.checked = selected.has(d.deck);
    cb.addEventListener('change', onDeckSelectionChange);
    const info = document.createElement('span');
    info.className = 'deck-info';
    const name = document.createElement('span');
    name.className = 'deck-name';
    name.textContent = d.deck;
    const sub = document.createElement('span');
    sub.className = 'deck-sub';
    const acc = d.accuracy === null ? '—' : `${Math.round(d.accuracy * 100)}%`;
    sub.textContent = `${d.total}枚（除外 ${d.excluded}）・正答率 ${acc}`;
    info.append(name, sub);
    label.append(cb, info);
    li.append(label);
    list.append(li);
  }
  updateStartButton();
  document.getElementById('version-label').textContent = `v${APP_VERSION}`;
}

function onDeckSelectionChange() {
  const checked = [...document.querySelectorAll('#deck-list input:checked')].map((c) => c.value);
  meta.selectedDecks = checked;
  saveJSON(KEYS.meta, meta);
  updateStartButton();
}

function updateStartButton() {
  const n = eligibleGuids(cards, state, meta.selectedDecks).length;
  const btn = document.getElementById('btn-start');
  btn.disabled = n === 0;
  btn.textContent = n === 0 ? '学習開始（デッキを選択）' : `学習開始（${n}枚）`;
}

document.getElementById('btn-select-all').addEventListener('click', () => {
  const boxes = [...document.querySelectorAll('#deck-list input')];
  const allChecked = boxes.every((b) => b.checked);
  boxes.forEach((b) => (b.checked = !allChecked));
  onDeckSelectionChange();
});

// ---------- インポート ----------

document.getElementById('input-tsv').addEventListener('change', async (ev) => {
  const files = [...ev.target.files];
  ev.target.value = '';
  if (files.length === 0) return;
  // 増分の是正再生成を新しい内容で上書きするため、古い順に取り込む
  const order = sortFileNamesOldestFirst(files.map((f) => f.name));
  files.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

  const report = [];
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  for (const file of files) {
    let text;
    try {
      text = await file.text();
    } catch {
      report.push(`${file.name}: 読み込み失敗`);
      continue;
    }
    const parsed = parseTSV(text);
    if (!parsed.sawHeader) {
      report.push(`${file.name}: カード TSV ではないため無視しました`);
      continue;
    }
    if (parsed.cards.length === 0) {
      totalSkipped += parsed.skipped;
      report.push(`${file.name}: 有効なカード行がありません（スキップ ${parsed.skipped}行）`);
      continue;
    }
    const merged = mergeCards(cards, parsed.cards);
    cards = merged.cards;
    totalAdded += merged.added;
    totalUpdated += merged.updated;
    totalSkipped += parsed.skipped;
    report.push(`${file.name}: 追加 ${merged.added}・更新 ${merged.updated}・スキップ ${parsed.skipped}行`);
  }
  if (totalAdded + totalUpdated > 0) {
    meta.lastImport = new Date().toISOString().slice(0, 10);
    if (!saveJSON(KEYS.cards, cards)) return;
    saveJSON(KEYS.meta, meta);
  }
  toast(`取込完了: 追加 ${totalAdded}・更新 ${totalUpdated}・スキップ ${totalSkipped}行`);
  document.getElementById('import-report').textContent = report.join('\n');
  renderHome();
});

// ---------- バックアップ ----------

function backupJSON() {
  return JSON.stringify({ version: APP_VERSION, exportedAt: new Date().toISOString(), cards, state });
}

document.getElementById('btn-backup').addEventListener('click', async () => {
  const json = backupJSON();
  const fileName = `flashcard-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], fileName, { type: 'application/json' });
  // 第一手段: iOS 共有シート（ファイルに保存 / OneDrive へ渡せる）
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'フラッシュカード バックアップ' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // ユーザーキャンセル
    }
  }
  // 第二手段: クリップボード
  try {
    await navigator.clipboard.writeText(json);
    toast('共有シートが使えないため、クリップボードにコピーしました。メモ等に貼り付けて保存してください');
    return;
  } catch {
    // 第三手段（デスクトップ向け）: ダウンロード
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }
});

document.getElementById('input-restore').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch {
    toast('JSON として読めませんでした。復元を中止します');
    return;
  }
  const v = validateBackup(obj);
  if (!v.ok) {
    toast(`バックアップ形式が不正です: ${v.reason}。復元を中止します`);
    return;
  }
  if (!confirm(`バックアップから復元します（カード ${Object.keys(obj.cards).length}枚）。現在のデータは置き換えられます。よろしいですか？`)) return;
  cards = obj.cards;
  state = obj.state;
  if (!saveJSON(KEYS.cards, cards)) return;
  saveJSON(KEYS.state, state);
  toast('復元しました');
  renderHome();
});

// ---------- 学習画面 ----------

let session = { guids: [], last: null, current: null, revealed: false, done: 0, correct: 0 };

document.getElementById('btn-start').addEventListener('click', () => {
  session = {
    guids: eligibleGuids(cards, state, meta.selectedDecks),
    last: null,
    current: null,
    revealed: false,
    done: 0,
    correct: 0,
  };
  show('study');
  nextCard();
});

function nextCard() {
  session.current = pickNext(session.guids, session.last);
  session.revealed = false;
  renderCard();
}

function renderCard() {
  const front = document.getElementById('card-front');
  const back = document.getElementById('card-back');
  const hint = document.getElementById('reveal-hint');
  const answers = document.getElementById('answer-buttons');
  const counter = document.getElementById('session-counter');
  counter.textContent = `${session.done}枚（正解 ${session.correct}）・残り候補 ${session.guids.length}枚`;

  if (!session.current) {
    front.innerHTML = '出題できるカードがありません';
    back.hidden = true;
    hint.hidden = true;
    answers.hidden = true;
    return;
  }
  const c = cards[session.current];
  front.innerHTML = c.front; // #html:true の TSV のため HTML として描画
  back.innerHTML = c.back;
  back.hidden = !session.revealed;
  hint.hidden = session.revealed;
  answers.hidden = !session.revealed;
}

document.getElementById('card').addEventListener('click', () => {
  if (!session.current || session.revealed) return;
  session.revealed = true;
  renderCard();
});

function recordAnswer(correct) {
  const guid = session.current;
  if (!guid) return;
  const s = state[guid] || { excluded: false, correct: 0, wrong: 0 };
  if (correct) s.correct++;
  else s.wrong++;
  state[guid] = s;
  saveJSON(KEYS.state, state);
  session.done++;
  if (correct) session.correct++;
  session.last = guid;
  nextCard();
}

document.getElementById('btn-correct').addEventListener('click', () => recordAnswer(true));
document.getElementById('btn-wrong').addEventListener('click', () => recordAnswer(false));

document.getElementById('btn-exclude').addEventListener('click', () => {
  const guid = session.current;
  if (!guid) return;
  const s = state[guid] || { excluded: false, correct: 0, wrong: 0 };
  s.excluded = true;
  state[guid] = s;
  saveJSON(KEYS.state, state);
  session.guids = session.guids.filter((g) => g !== guid);
  toast('このカードを除外しました（統計画面から戻せます）');
  nextCard();
});

document.getElementById('btn-study-back').addEventListener('click', () => {
  renderHome();
  show('home');
});

// ---------- 統計画面 ----------

document.getElementById('btn-stats').addEventListener('click', () => {
  renderStats();
  show('stats');
});

document.getElementById('btn-stats-back').addEventListener('click', () => {
  renderHome();
  show('home');
});

function renderStats() {
  const deckList = document.getElementById('stats-decks');
  deckList.textContent = '';
  for (const d of deckStats(cards, state)) {
    const li = document.createElement('li');
    const acc = d.accuracy === null ? '—' : `${Math.round(d.accuracy * 100)}%`;
    li.textContent = `${d.deck}: 正答率 ${acc}（正解 ${d.correct}・不正解 ${d.wrong}・${d.total}枚・除外 ${d.excluded}）`;
    deckList.append(li);
  }

  const weakList = document.getElementById('stats-weak');
  weakList.textContent = '';
  const weak = weakCards(cards, state);
  document.getElementById('stats-weak-empty').hidden = weak.length > 0;
  for (const c of weak) {
    const li = document.createElement('li');
    li.textContent = `${c.back} — 不正解 ${c.wrong}・正解 ${c.correct}`;
    weakList.append(li);
  }

  const exList = document.getElementById('stats-excluded');
  exList.textContent = '';
  const ex = excludedCards(cards, state);
  document.getElementById('stats-excluded-empty').hidden = ex.length > 0;
  for (const c of ex) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'restore-btn';
    btn.textContent = '戻す';
    btn.addEventListener('click', () => {
      state[c.guid].excluded = false;
      saveJSON(KEYS.state, state);
      toast(`「${c.back}」を出題対象に戻しました`);
      renderStats();
    });
    const span = document.createElement('span');
    span.textContent = `${c.back}（${c.deck}）`;
    li.append(btn, span);
    exList.append(li);
  }
}

// ---------- Service Worker 登録・更新 ----------

let reloading = false;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

document.getElementById('btn-update').addEventListener('click', async () => {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    toast('オフライン機能が未登録です（初回読み込み直後の可能性）');
    return;
  }
  await reg.update();
  toast('更新を確認しました。新しいバージョンがあれば自動で再読み込みされます');
});

// ---------- 起動 ----------

renderHome();
show('home');
