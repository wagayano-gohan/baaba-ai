# UIプロトタイプ実装プロセス記録（統合文書作成担当への引き継ぎ資料）

## 1. senior-ux：画面仕様書
最終版: `C:\Users\user\Desktop\ばーばAI\docs\ui-prototype-spec.md`
（qa-accessibilityによる事前レビューで3件差し戻し→修正→再レビュー「実装着手可」で確定）

## 2. frontend-web：実装完了報告（初回）

作成・変更したファイル（すべて `C:\Users\user\Desktop\ばーばAI` 配下）：

**プロジェクト設定**
- `package.json`（name変更のみ）, `index.html`（title/lang/viewport変更）, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `.gitignore`, `.oxlintrc.json`（すべてVite標準スキャフォールドのまま利用）

**アプリ本体**
- `src/main.tsx`（Viteデフォルトのまま）
- `src/App.tsx` — 画面遷移の状態管理（React Router不使用、`useState`によるシンプルな画面切替）
- `src/index.css` — 共通スタイル
- `src/data/schedules.ts` — 仕様書11章のダミーデータ（No.1〜5）、出発時刻、祖母の呼び名
- `src/utils/greeting.ts` — 日付表示・時間帯別挨拶文のロジック
- `src/components/icons.tsx` — 家/カレンダー/マイク/停止の線画アイコン
- `src/components/BottomNav.tsx` / `BottomNav.css` — 下部メニュー
- `src/screens/HomeScreen.tsx` / `.css` — ①ホーム画面
- `src/screens/RecordingScreen.tsx` / `.css` — ②録音中画面
- `src/screens/ConfirmScreen.tsx` / `.css` — ③AI確認画面（「へんこう」編集もmode="edit"で再利用）
- `src/screens/ScheduleListScreen.tsx` / `.css` — ④予定一覧画面（削除確認ダイアログ含む）

削除したもの: Viteデフォルトの`App.css`、`react.svg`/`vite.svg`/`hero.png`、`public/icons.svg`、初期生成`README.md`

起動方法：
```
cd "C:\Users\user\Desktop\ばーばAI"
npm install
npm run dev
```
確認URL: http://localhost:5173/ （ポートは起動時の空き状況により変動する場合あり）

画面と仕様の対応：
| 画面 | 対応章 | 実装ファイル |
|---|---|---|
| ①ホーム画面 | 7章 | `HomeScreen.tsx` |
| ②録音中画面 | 8章 | `RecordingScreen.tsx` |
| ③AI確認画面 | 9章、10.4（へんこう再利用） | `ConfirmScreen.tsx` |
| ④予定一覧画面 | 10章 | `ScheduleListScreen.tsx` |

画面遷移：ホーム→(マイク)→録音中→(停止)→AI確認→「はい」で1.5秒「とうろくしました」表示後ホームへ自動遷移／「ちがう」で即ホームへ。ホーム↔予定一覧は下部メニュー。予定一覧の「へんこう」→AI確認レイアウト流用（「へんこうする」タップで1.5秒「へんこうしました」→一覧へ、「やめる」で即一覧へ）。「けす」タップで「本当に けしますか？」ダイアログ表示。

仕様書との差異：日付・挨拶文は現在時刻から動的算出（仕様書7.3の「時間帯に応じて自動切替」規定に基づく）。予定削除は`useState`配列からのその場除外（本保存なし、リロードで復元）。

## 3. code-reviewer：レビュー結果
**総合判定：問題なし、次工程（qa-accessibilityによるブラウザ確認）へ進んでよい**

確認内容：
- 仕様書との整合性：文言・数値・配色・画面遷移すべて一致
- 「実装しないもの」の混入：OpenAI API・実録音処理・Supabase・認証/PIN・外部通信・APIキー・PWA関連ファイル、いずれも検出されず
- コード品質：型安全性良好、`any`/`console.log`/TODO類ゼロ件
- 数値検証：最重要時刻40px、主見出し32px、本文28px、補助ラベル22px、マイク/停止ボタン直径140px、タップ領域min-height 88px、すべて仕様通り
- セキュリティ：`dangerouslySetInnerHTML`不使用、XSSリスクなし
- 実行確認：`npx tsc -b`エラーなし、`npm run build`成功、`npm run lint`（oxlint）エラーなし

軽微な参考指摘（差し戻し理由にはしない）：
1. 予定一覧の「へんこう/けす」ボタン（24px）と確認画面の「はい/ちがう」（28px）のフォントサイズ不統一
2. `index.html`のviewportで`maximum-scale=1.0`によりピンチズーム無効化
3. マイクボタンの`aria-label`と直下案内文が同一テキストで、スクリーンリーダーでの二重読み上げの可能性

## 4. qa-accessibility：ブラウザ確認（1回目）→ 差し戻し

Chrome DevTools ProtocolによるヘッドレスChrome自動操作（iPhone相当390×844、375×667のデバイスエミュレーション）で実施。

**発見した重大な問題（2件、差し戻し理由）：**
- **問題A**：予定一覧の削除確認ダイアログが`position: absolute`のため、丈高なドキュメント全体基準で配置され、ビューポート下端からわずかしか見えない（実測：ダイアログ上端806px、ビューポート高844px）。実機で約900pxスクロールしないと確認ボタンに到達できない。
- **問題B**：下部メニューが仕様「常に固定表示」に反し、`position: fixed/sticky`になっていない。ホーム画面で初期表示時に文字ラベルが隠れる、予定一覧では最下部まで到達しないと出現しない。

参考指摘3点（code-reviewerの指摘と同じ）への判断：いずれも許容範囲・軽微。

## 5. frontend-web：修正報告（2回目）

修正内容：
- `src/index.css`：html/body/#root/.app-shellの高さを`min-height`から`height`（100%/100dvh）に変更、`.app-shell`に`transform: translateZ(0)`追加
- `src/screens/ScheduleListScreen.css`：`.delete-dialog-overlay`を`position: fixed`に変更
- `src/components/BottomNav.css`：`.bottom-nav`に`position: sticky; bottom: 0; z-index: 10;`追加
- 副次対応：`RecordingScreen.css`/`ConfirmScreen.css`に`overflow-y: auto`追加

自己検証（ヘッドレスChrome、390×844・375×667）で問題解消を確認、`npx tsc -b`・`npm run lint`とも問題なし。

## 6. qa-accessibility：ブラウザ確認（2回目・最終）→ 合格

**総合判定：合格（完了報告へ進んでよい）**

- 削除確認ダイアログ：`position: fixed`を実測確認、390×844・375×667いずれもビューポート内に完全表示（`fullyInViewport: true`）
- 下部メニュー：`position: sticky`を実測確認、初期表示・スクロール後とも常時完全可視（`navFullyVisible: true`）
- 375×667でのマイクボタン見切れは仕様書2章の想定内挙動（縦スクロールで解消、`micFullyVisible: true`）であり問題なしと判定
- 既存の画面遷移（はい/ちがう、へんこう編集フロー）への副作用なし
- 参考指摘3点（フォントサイズ不統一、ピンチズーム無効化、aria-label重複）は引き続き許容範囲、差し戻し理由に該当せず

作業完了後、開発サーバー・ヘッドレスChromeプロセスはすべて停止済み。

## 7. 監督AンAIによる補足：ユーザー向け起動確認
上記のQA完了後、監督AI自身がユーザーの「UI見たい」というリクエストに応じ、`npm run dev`を実行してユーザーに直接確認用URLを案内した（ポート5173が使用中だったため5174で起動）。これはコード変更やレビュー判断を伴わない操作案内であり、実装・レビュー内容そのものへの介入は行っていない。
