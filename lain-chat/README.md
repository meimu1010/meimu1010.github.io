# serial experiments lain — Wired Chat Terminal

岩倉玲音 (『serial experiments lain』) と会話できるチャットサイトです。
**Groq API (`qwen/qwen3.8-27b`)** の Function Calling(エージェントモード)を使い、
玲音自身が「検索が必要」と判断したときだけ **Wired(Web検索)** に接続します。
**Web検索は APIキー不要・クレカ不要**(Jina→DuckDuckGo→Wikipedia→DDG-IA の多段フォールバック)。

```
┌──────────────┐   tools: wired_search    ┌──────────────────────┐
│   Groq API    │ ───────────────────────▶ │ キー不要検索チェーン   │
│ qwen3.8-27b   │ ◀─────────────────────── │ Jina/DDG/Wiki/DDG-IA │
└──────────────┘  role:"tool" で結果を返却  └──────────────────────┘
        │
        ▼  エージェントループ (最大5往復・429自動リトライ付き)
   最終回答を生成 → タイプライター演出で表示
```

## ファイル構成

```
lain-chat/
├── index.html          # 画面本体 (チャットUI + 設定パネル)
├── css/
│   └── style.css       # CRT走査線・ノイズ・デジタルレイン・グリッチ
├── js/
│   ├── system-prompt.js  # 玲音の人格定義 (lite/full) + ツール定義
│   ├── search.js         # キー不要の多段Web検索
│   └── app.js            # エージェントループ・UI・設定管理
└── README.md
```

## 1. API キーの取得 (必要なのは Groq だけ)

1. **<https://console.groq.com/keys>** を開く
   (未登録なら Google / GitHub アカウントで無料サインアップ → 左メニュー **API Keys**)
2. **Create API Key** をクリック
3. `gsk_...` で始まるキーをコピー(**再表示できないのでその場で保存**)

> Web検索用のキー(Tavily等)は**一切不要**です。
> 検索は Jina Reader→DuckDuckGo→Wikipedia→DDG Instant Answer の順で
> すべてキーフリーの経路を自動フォールバックします。

### キー不要検索チェーンの詳細

| 順 | 経路 | 特徴 |
|---|---|---|
| 1 | Jina Reader → DuckDuckGo | 実際のWeb検索結果。CORS対応・無料(約20req/分) |
| 2 | DuckDuckGo HTML + 公開CORSプロキシ | 同じDDGを別経路で |
| 3 | Wikipedia API (ja→en) | 公式CORS。百科知識系クエリに強い |
| 4 | DuckDuckGo Instant Answer API | 最終手段。要約+関連トピックのみ |

どの経路が使われたかは `>> ...接続完了。N 件の断片を取得。 [provider名]` で確認できます。

## 2. 起動方法

ビルド不要の静的サイトです。どちらでも動きます。

```bash
# 方法A: そのまま開く
open lain-chat/index.html     # macOS
start lain-chat\index.html    # Windows
xdg-open lain-chat/index.html # Linux

# 方法B: ローカルサーバー経由(推奨)
cd lain-chat && python3 -m http.server 8080
# → http://localhost:8080  (Node: npx serve .)
```

## 3. 設定 (⚙ CONFIG ボタン / Ctrl+,)

| 項目 | 説明 |
|---|---|
| `GROQ_API_KEY` | 必須。`gsk_...` — 取得: <https://console.groq.com/keys> |
| `MODEL` | プルダウンで切替: `qwen/qwen3.8-27b`(既定) / `llama-3.3-70b-versatile` / `llama-3.1-8b-instant`(軽量・制限緩め) / `openai/gpt-oss-120b` / `openai/gpt-oss-20b` / `minimaxai/minimax-m2.7` / **その他…(手入力)**。ツール呼び出し対応モデルの一覧は <https://console.groq.com/docs/models> |
| `TEMPERATURE` | 既定 **0.7** (Groq公式のInstructモード推奨値)。上げると返答に揺らぎ・遊び、下げると安定して淡々 |
| `PERSONA` | `lite`(約970トークン・既定) / `full`(約2,360トークン)。429が頻発するなら lite |
| `THINKING MODE` | qwen3.8-27b / gpt-oss は reasoning モデル。`none`(Instruct・既定=速い/節約) / `low` / `default`(深い思考)。非対応モデル(llama系)には自動で送られません |

キーは**このブラウザの localStorage にのみ保存**されます。
会話ログはメモリのみ(リロードで消去)、✕ RESET で手動初期化もできます。

## 4. 使い方・演出

- 入力欄にメッセージを書いて **Enter**(改行は Shift+Enter)
- 玲音が検索が必要と判断すると `>> Wired に接続中...` → `>> プロトコルを参照: "query"` → `>> ...接続完了。N 件の断片を取得。` と表示され、出典リンクが並びます
- NAVI ブートシーケンス、デジタルレイン背景、ランダム画面グリッチ、タイプライター表示(クリックでスキップ)、処理中のトッププログレスバーなどの演出付き
- 429(レートリミット)時は「try again in Xs」を解析して**自動リトライ**(カウントダウン表示、最大3回)

## 5. セキュリティ注意(本番運用時)

APIキーはブラウザから Groq に直接送信される**クライアントサイド方式**です。
個人利用・ローカル利用には問題ありませんが、**自分のキーをコードに埋め込んで公開リポジトリに push するのは絶対にNG**
(GitHub のシークレットスキャンで検出され、Groq 側で無効化されます)。
本アプリは BYOK(訪問者が各自のキーを各自のブラウザに入れる)設計なので、サイト本体に秘密情報は含まれません。
公開運用で「キー入力なしで誰でも使える」形にする場合は、Cloudflare Workers 等でプロキシしてキーをサーバー側に置いてください。

## 6. トラブルシューティング

| 症状 | 対処 |
|---|---|
| `NAVI が認証に失敗` (401) | ⚙ CONFIG で Groq キーを再確認。取得: <https://console.groq.com/keys> |
| `モデルIDが見つかりません` (404) | <https://console.groq.com/docs/models> の現行IDに変更 |
| `……Wiredが、混雑してる` (429) | **自動リトライ対応済み**。それでも失敗したら1分待って再送 |
| 検索ターンで頻繁に429になる | 入力の分間制限 (ITPM) が原因。対策: ①PERSONA=`lite` ②THINKING=`none` ③送信間隔を空ける ④MODELを `llama-3.1-8b-instant` に変更(制限が別枠で緩め) ⑤Dev Tier(有料)。詳細は「8. トークンダイエット」 |
| `Wired が、濁ってる...`(検索失敗) | 全経路が失敗したときに表示。時間をおいて再送、または検索語を変えてみる(Jinaは約20req/分の制限あり) |
| 玲音が検索を使わない | 「今日のニュースは?」など外部情報が必要な質問を。検索指示は `js/system-prompt.js` で調整可 |

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

公開前に必ず「5. セキュリティ注意」を確認してください(BYOK設計なので通常はそのまま公開してOK)。

## 8. 429 (レートリミット) が起きる仕組みと「トークンダイエット」

Groq 無料枠の `qwen/qwen3.8-27b` は **入力の分間制限 (ITPM) が 7,000〜8,000トークン程度**
(組織・ティアにより異なり、429エラー文中の `Limit` の値がその時点の実値)。
検索ありの1ターンはリクエストが2回走る (①ツール判断 → ②検索結果込みの回答生成) ため、
**2回の入力の合計**がこの枠を超えると429になります。

### よくある誤解: 「思考をオフにすれば full ペルソナでも収まる?」

**ITPM は入力トークンの制限なので、thinking オフでは減りません。**
`reasoning_effort="none"` が効くのは出力側(応答速度・出力トークン=OTPM)です。
入力を減らすには PERSONA=`lite`(システムプロンプト 2,360→970)が最も効果的です。

### 1リクエストの内訳と削減策 (実測値)

| 構成要素 | フル版 | 軽量版 | 削減策 |
|---|---|---|---|
| システムプロンプト | 2,362 | **974** | ⚙ CONFIG の PERSONA を `lite` に (既定) |
| ツール定義 | 260 | **192** | description を短縮済み |
| 検索結果ペイロード | — | **3件×220字** | UIは5件表示のまま、モデルへは痩せて返す |
| 古い履歴の検索結果 | — | **100字に圧縮** | 直近1件のみ全文保持 |
| 履歴メッセージ数 | — | **16** | trimHistory で自動刈り込み |

**検索ターンの入力合計 (実会話ログでシミュレートした実測値):**

| PERSONA | 通常の会話 | 履歴が16件上限まで伸びた場合 | 制限7K | 制限8K |
|---|---|---|---|---|
| lite | ≈3,400 | ≈6,000 | ✅ 常に余裕 | ✅ 常に余裕 |
| full | ≈6,200 | ≈9,000超 | ⚠️ 普段は収まるが長会話で溢れる(自動リトライが吸収) | ✅ 概ね収まる |

→ ペイロードスリム化・履歴圧縮のおかげで **full でも普通の会話なら7Kに収まります**。
長丁場の会話や連投で429が増えたら lite に落とす、が実用的な運用です。

## 免責

『serial experiments lain』は Production 2nd / 安倍吉俊・中村隆太郎ほかの著作物です。
本プロジェクトは非公式のファンメイド技術デモであり、営利利用を目的としません。
