# シンプル暗記カード（flashcard-pwa)

Anki の忘却曲線・出題制限を取り払ったシンプルな暗記カード PWA。
make-anki-cards が生成する TSV（`Scripts/anki_export/cards_*.txt`）を手動インポートして使う。

- 設計書（正本）: `~/OneDrive/Scripts/superpowers-docs/specs/2026-07-16-simple-flashcard-pwa-design.md`
- ホスティング: GitHub Pages（アプリ本体のみ。カードデータは端末の localStorage にのみ保存）

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `index.html` | 3画面（ホーム・学習・統計）のマークアップ |
| `app.js` | UI と localStorage の配線（`APP_VERSION` を持つ） |
| `logic.js` | 純粋ロジック（TSV パース・マージ・出題・集計）。Node テスト対象 |
| `style.css` | モバイル前提のスタイル（ライト/ダーク対応） |
| `sw.js` | オフライン用 Service Worker（`CACHE_VERSION` を持つ） |
| `manifest.json` | PWA マニフェスト |
| `tests/logic.test.mjs` | 単体テスト |

## 更新手順（重要）

1. コードを修正する
2. **`app.js` の `APP_VERSION` と `sw.js` の `CACHE_VERSION` を同じ値で上げる**（例: 1.0.0 → 1.0.1）。これを忘れると iPhone 側のキャッシュが入れ替わらない
3. テスト実行: `node --test tests/logic.test.mjs`
4. commit & push（GitHub Pages が自動反映）
5. iPhone 側はアプリ再起動、または「アプリの更新を確認」ボタンで新バージョン表示になることを確認

## ローカル動作確認

```
python -m http.server 8123
```

を本フォルダで実行し、ブラウザで <http://localhost:8123/> を開く（Service Worker は file:// では動かないためサーバ経由が必須）。
