<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>You are an idiot! Controller</title>
<style>
  body {
    font-family: sans-serif;
    text-align: center;
    margin-top: 50px;
  }
  button {
    font-size: 18px;
    padding: 10px 20px;
    margin: 10px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
  }
  #openBtn { background-color: #4CAF50; color: white; }
  #closeBtn { background-color: #f44336; color: white; }
</style>
</head>
<body>
  <h1>You are an idiot! 🎭</h1>
  <button id="openBtn">＋ ウィンドウを開く</button>
  <button id="closeBtn">－ ウィンドウを閉じる</button>
  <p>最大 5 個まで開けます。</p>

<script>
var maxWindows = 5;
var windowsList = [];

// ==== ウィンドウを開く ====
function openWindow(url) {
    if (windowsList.length >= maxWindows) {
        alert("もうこれ以上開けません！（最大 " + maxWindows + " 個）");
        return;
    }

    var w = window.open(url, "_blank",
        "menubar=no,status=no,toolbar=no,resizable=no" +
        ",width=357,height=330,left=200,top=200"
    );

    if (w) {
        // 強制サイズ補正（バグ防止）
        var fixSize = setInterval(function() {
            try {
                w.resizeTo(357, 330);
                w.moveTo(200 + windowsList.length * 40, 200 + windowsList.length * 40);
            } catch (e) {}
        }, 100);

        setTimeout(function() { clearInterval(fixSize); }, 2000);

        windowsList.push(w);
    }
}

// ==== ウィンドウを閉じる ====
function closeWindow() {
    if (windowsList.length === 0) {
        alert("閉じるウィンドウがありません。");
        return;
    }

    var w = windowsList.pop();
    if (w && !w.closed) {
        w.close();
    }
}

// ==== ボタンイベント ====
document.getElementById("openBtn").onclick = function() {
    openWindow("lol.html");
};
document.getElementById("closeBtn").onclick = function() {
    closeWindow();
};
</script>
</body>
</html>
