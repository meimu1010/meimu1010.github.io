# serial experiments lain — Wired Chat Terminal

岩倉玲音 (『serial experiments lain』) と会話できるチャットサイトです。
**Groq API (`qwen/qwen3.8-27b`)** の Function Calling(エージェントモード)を使い、
玲音自身が「検索が必要」と判断したときだけ **Wired(Web検索)** に接続します。

```
┌──────────────┐    tools: wired_search     ┌──────────────────────┐
│  qwen3.8-27b │ ──────────────────────────▶│ キー不要検索チェーン  │
│   (Groq)     │ ◀──────────────────────────│ Tavily/Jina/DDG/Wiki │
└──────────────┘   role:"tool" で結果を返却   └──────────────────────┘
        │
        ▼  エージェントループ (最大5往復)
   最終回答を生成 → タイプライター演出で表示
```

## ファイル構成

```
lain-chat/
├── index.html          # 画面本体 (チャットUI + 設定パネル)
├── css/
│   └── style.css       # CRT走査線・グリッチ・ターミナル風デザイン
├── js/
│   ├── system-prompt.js  # 玲音の人格定義システムプロンプト + ツール定義
│   ├── search.js         # 多段検索: Tavily(任意) / Jina→DDG / Wikipedia / DDG-IA
│   └── app.js            # エージェントループ・UI・設定管理
└── README.md
```

## 1. API キーの取得

### Groq API キー(必須)

1. <https://console.groq.com/> にアクセスし、Google/GitHub アカウントでログイン
2. 左メニュー **API Keys** → **Create API Key**
3. `gsk_...` で始まるキーをコピー(**再表示できないので即保存**)

### Tavily API キー(**任意** — なくてもWeb検索は動きます)

> ⚠️ Tavily は登録にクレジットカードが必要な場合があります。
> **未設定でも検索機能はゼロキーで動作します**(下記「キー不要検索チェーン」参照)。
> 検索品質を上げたい場合のみ設定してください(無料枠: 月1,000クレジット)。

1. <https://app.tavily.com/home> にアクセスし、Google/GitHub アカウントで登録
2. ダッシュボードに表示される `tvly-...` で始まるキーをコピー

### キー不要検索チェーン(デフォルト)

Tavily キーがない場合、以下の順で自動フォールバックします(すべて**APIキー・クレカ不要**):

| 順 | 経路 | 特徴 |
|---|---|---|
| 1 | Jina Reader → DuckDuckGo | 実際のWeb検索結果。CORS対応・無料(約20req/分) |
| 2 | DuckDuckGo HTML + 公開CORSプロキシ | 上と同じDDGを別経路で |
| 3 | Wikipedia API (ja→en) | 公式CORS。百科知識系クエリに強い |
| 4 | DuckDuckGo Instant Answer API | 最終手段。要約+関連トピックのみ |

どの経路が使われたかはチャットログの `>> ...接続完了。N 件の断片を取得。 [provider名]` で確認できます。

## 2. 起動方法

ビルド不要の静的サイトです。どちらでも動きます。

**方法A: そのまま開く**

```bash
# index.html をダブルクリック、または
open lain-chat/index.html     # macOS
start lain-chat\index.html    # Windows
xdg-open lain-chat/index.html # Linux
```

**方法B: ローカルサーバー経由(推奨)**

```bash
cd lain-chat
python3 -m http.server 8080
# → http://localhost:8080 を開く
# (Node の場合: npx serve .)
```

## 3. API キーの設定場所

ページ右上の **⚙ CONFIG** ボタン(または `Ctrl + ,`)で設定パネルを開き、以下を入力して **SAVE**:

| 項目 | 説明 |
|---|---|
| `GROQ_API_KEY` | 必須。`gsk_...` |
| `TAVILY_API_KEY` | Web検索(Wired接続)に使用。`tvly-...` |
| `MODEL` | 既定値 `qwen/qwen3.8-27b`。Groq の他モデルIDにも変更可 |
| `TEMPERATURE` | 既定値 `0.9`(玲音らしさのため少し高め) |
| `SEARCH PROVIDER` | `auto`(キーあればTavily優先→なければキー不要検索) / `free`(キー不要のみ) / `tavily` |
| `PERSONA` | `lite`(約970トークン・既定) / `full`(約2,360トークン)。ITPMが厳しい環境では lite |
| `THINKING MODE` | qwen3.8-27b は reasoning モデル。`none`(Instruct・既定=速い/節約) / `low` / `default`(深い思考)。非対応モデルでは自動で無視されます |

キーは **このブラウザの localStorage にのみ保存**され、送信先は Groq / Tavily(設定時のみ)です。
キー不要検索の送信先は Jina(r.jina.ai)・DuckDuckGo・Wikipedia で、いずれもクエリ以外の情報は送りません。
コード上の保存場所を変更したい場合は `js/app.js` 冒頭の `LS_KEYS` を参照してください。

## 4. 使い方・演出

- 入力欄にメッセージを書いて **Enter**(改行は Shift+Enter)
- 玲音が検索が必要と判断すると、チャットログに
  `>> Wired に接続中...` → `>> プロトコルを参照: "query"` → `>> ...接続完了。N 件の断片を取得。`
  と表示され、取得した出典リンクが並びます
- 起動時の NAVI ブートシーケンス、ランダムな画面グリッチ、タイプライター表示などの演出付き
- 会話のリセットは右上 **✕ RESET**

## 5. セキュリティ注意(本番運用時)

この実装は**APIキーをブラウザから直接送信するクライアントサイド方式**です。
個人利用・ローカル利用には問題ありませんが、インターネット上に公開する場合は
キーが第三者に抜かれます。公開する際は以下いずれかを:

- 簡易バックエンド(Cloudflare Workers / Vercel Functions など)を立ててプロキシし、キーはサーバー側の環境変数に置く
- あるいは Groq / Tavily のキーに利用上限を設定したうえで自己責任で運用

## 6. トラブルシューティング

| 症状 | 対処 |
|---|---|
| `HTTP 401 — APIキーが無効` | ⚙ CONFIG で Groq キーを再確認 |
| `HTTP 404 — モデルIDが見つかりません` | <https://console.groq.com/docs/models> で最新のモデルIDを確認し MODEL を変更 |
| `……Wiredが、混雑してる` (429) | **自動リトライ対応済み** (Groqが返す「try again in Xs」を解析して待機→再接続、最大3回)。それでも失敗したら1分待って再送 |
| 検索ターンで頻繁に429になる | 無料枠の `qwen/qwen3.8-27b` は入力の分間制限 (ITPM) が **7,000〜8,000トークン程度** と低く、検索ありの1ターン(リクエスト2回)で上限に届きます。対策: ①PERSONA を `lite` に ②THINKING MODE を `none` に ③少し間隔を空けて送る ④軽いモデル (例 `llama-3.1-8b-instant`) に変更 ⑤Dev Tier にアップグレード。詳細は「8. トークンダイエット」 |
| `Wired が、濁ってる...`(検索失敗) | 全経路が失敗したときに表示。時間をおいて再送、または検索語を変えてみる。Jinaは約20req/分の制限あり |
| 検索結果が百科事典的すぎる | キー不要チェーンの下位(Wikipedia/DDG-IA)に落ちている可能性。少し待って再送するとJina経路が復活します |
| 玲音が検索を使わない | 「今日のニュースは?」など外部情報が必要な質問を試す。システムプロンプトの検索指示は `js/system-prompt.js` で調整可 |

## 免責

『serial experiments lain』は Production 2nd / 安倍吉俊・中村隆太郎ほかの著作物です。
本プロジェクトは非公式のファンメイド技術デモであり、営利利用を目的としません。

## 7. GitHub Pages へのデプロイ

完全静的サイトなので GitHub Pages でそのまま公開できます。

```bash
cd lain-chat
git init && git add -A && git commit -m "lain wired chat terminal"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
git push -u origin main
```

または GitHub の Web UI からファイルをアップロードし、
**Settings → Pages → Build and deployment → Source: Deploy from a branch → main / (root)** を選択。
数分で `https://<ユーザー名>.github.io/<リポジトリ名>/` に公開されます。
(`.nojekyll` を同梱済みなので Jekyll ビルドはスキップされます)

### ⚠️ 公開前の重要注意

- **自分の API キーをコードに書き込んで push しないでください。**
  公開リポジトリのソースやネットワークタブから誰でも抜けます
  (GitHub には `gsk_...` キーを自動検知するシークレットスキャンもあり、検出されると Groq 側で無効化されます)。
- 本アプリは **BYOK (Bring Your Own Key) 設計**です。訪問者それぞれが
  ⚙ CONFIG で自分のキーを自分のブラウザ (localStorage) に入れるため、
  サイト本体に秘密情報は含まれず、そのまま公開して問題ありません。
- 会話内容もすべてブラウザ内で完結し、GitHub のサーバーには送信されません
  (送信先は Groq API と検索経路のみ)。

## 8. 429 (レートリミット) が起きる仕組みと「トークンダイエット」

Groq 無料枠の `qwen/qwen3.8-27b` は **入力の分間制限 (ITPM) が 7,000〜8,000トークン程度**
(組織・ティアにより異なり、429エラー文中の `Limit` の値がその時点の実値)。
検索ありの1ターンはリクエストが2回走る (①ツール判断 → ②検索結果込みの回答生成) ため、
合計がこの枠を超えると429になります。

### 1リクエストの内訳と削減策 (実測値)

| 構成要素 | フル版 | 軽量版 | 削減策 |
|---|---|---|---|
| システムプロンプト | 2,362 | **974** | ⚙ CONFIG の PERSONA を `lite` に (既定) |
| ツール定義 | 260 | **192** | description を短縮済み |
| 検索結果ペイロード | 4件×280字 | **3件×220字** | UIは5件表示のまま、モデルへは痩せて返す |
| 古い履歴の検索結果 | 全文 | **100字に圧縮** | 直近1件のみ全文保持 |
| 履歴メッセージ数 | 40 | **16** | trimHistory で自動刈り込み |

**検索ターンの合計目安: lite ≈ 4,900 (7K/8Kどちらでも余裕) / full ≈ 7,600 (8Kならギリギリ収まるが履歴が伸びると429→自動リトライで回復)**

### それでも429が出るとき

1. 送信間隔を少し空ける (ウィンドウは1分単位)
2. ⚙ CONFIG でモデルを `llama-3.1-8b-instant` 等に変更 (無料枠の制限がモデル別に別枠)
3. 429時はアプリが「try again in Xs」を解析して自動リトライするので、基本は待つだけで復旧
4. 常用するなら Groq Dev Tier (有料) で ITPM が 250K に
