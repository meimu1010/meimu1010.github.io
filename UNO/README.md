# 🃏 UNO Online

HTML/CSS/JavaScript だけで動作するオンライン UNO ゲームです。  
GitHub Pages へそのままアップロードするだけで遊べます。

---

## 🚀 GitHub Pages 公開手順

### 1. リポジトリ作成

1. GitHub にログインして、新しいリポジトリを作成  
   例: `my-uno-game`

### 2. ファイルをアップロード

```
my-uno-game/
├── index.html
├── css/
│   └── style.css
└── js/
    ├── main.js
    ├── game.js
    ├── room.js
    ├── peer.js
    ├── ai.js
    └── ui.js
```

ファイルをすべて上記の構造でリポジトリにプッシュします。

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/あなたのユーザー名/my-uno-game.git
git push -u origin main
```

### 3. GitHub Pages を有効化

1. リポジトリの **Settings** タブを開く  
2. 左メニューの **Pages** をクリック  
3. **Source** を `Deploy from a branch` に設定  
4. **Branch** を `main` / `/(root)` に設定  
5. **Save** をクリック  

数分後、以下の URL でアクセス可能になります:

```
https://あなたのユーザー名.github.io/my-uno-game/
```

---

## 🎮 遊び方

### AI 対戦

1. 「ゲームを始める」→「AI 対戦」を選択
2. プレイヤー名・AI 人数・難易度を設定
3. 「ゲーム開始」でスタート

### オンライン対戦

**ホスト（部屋を作る人）:**

1. 「ゲームを始める」→「オンライン対戦」→「ルーム作成」
2. 名前・ルーム名・最大人数を設定して「ルームを作成」
3. 表示された招待 URL をフレンドに送る
4. 全員揃ったら「ゲーム開始」をクリック

**ゲスト（参加する人）:**

- 招待 URL をそのまま開く（自動入力されます）
- または「ルーム参加」→ ルーム ID（ホストの Peer ID）を入力

> ⚠️ ルーム ID 欄にはホストの **PeerJS Peer ID** を入力します。  
> 招待 URL の `?room=xxxxxx` の部分が Peer ID です。

---

## 📋 UNO ルール

| カード | 効果 |
|--------|------|
| 数字 (0〜9) | 色か数字が一致すれば出せる |
| Skip ⊘ | 次のプレイヤーをスキップ |
| Reverse ⇄ | 順番を逆にする |
| Draw Two +2 | 次のプレイヤーが 2 枚ドロー |
| Wild ★ | 色を自由に宣言 |
| Wild Draw Four +4 | 色を宣言 + 次が 4 枚ドロー |

- 手札が **1 枚** になったら必ず「**UNO!**」ボタンを押す
- 宣言忘れはペナルティで **2 枚ドロー**
- 手札が **0 枚** になったプレイヤーが勝利

---

## 🛠️ 技術スタック

- **HTML5 / CSS3 / Vanilla JS (ES2022)**
- **PeerJS 1.5.4** (WebRTC P2P 通信)
- フレームワーク・ビルドツール不要
- npm 不要・GitHub Pages に直接配置可能

---

## 📁 ファイル構成

```
index.html      - メイン HTML・全画面の骨格
css/
  style.css     - スタイル・アニメーション
js/
  main.js       - エントリーポイント・画面管理・AI ゲーム制御
  game.js       - UNO コアロジック（デッキ・ルール・状態管理）
  ai.js         - AI 戦略（Easy / Normal / Hard）
  ui.js         - UI レンダリング・アニメーション
  room.js       - オンラインルーム管理・PeerJS ホスト/クライアント
  peer.js       - PeerJS ラッパー・接続管理
```

---

## 💡 注意事項

- オンライン対戦は **PeerJS の公開サーバー** を使用します
- 同一ネットワーク外でのプレイには NAT 越えが必要です（PeerJS が自動処理）
- ホストが切断するとゲームが終了します
- プレイヤーが途中切断した場合、AI が引き継ぎます
