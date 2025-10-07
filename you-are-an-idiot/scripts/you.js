// ==== 完全安全版 you.js（最大5個固定） ====

var maxWindows = 5;
var openWindows = 0;

var xOff = 5;
var yOff = 5;
var xPos = 400;
var yPos = -100;
var flagRun = 1;

// IE専用ブックマーク（残しても安全）
function bookmark() {
    if ((navigator.appName == "Microsoft Internet Explorer") && (parseInt(navigator.appVersion) >= 4)) {
        var url = "lol.html";
        var title = "Idiot!";
        window.external.AddFavorite(url, title);
    }
}

function changeTitle(title) {
    document.title = title;
}

// ウィンドウを開く関数（最大5個まで）
function openWindow(url) {
    if (openWindows >= maxWindows) return;

    var w = window.open(url, "_blank",
        "menubar=no,status=no,toolbar=no,resizable=no" +
        ",width=357,height=330,left=100,top=100"
    );

    if (w) {
        // 確実に小さいサイズに矯正する（何度も実行）
        var fixSize = setInterval(function() {
            try {
                w.resizeTo(357, 330);
                w.moveTo(100 + openWindows * 50, 100 + openWindows * 50);
            } catch (e) {}
        }, 100);

        // 数秒後に監視終了
        setTimeout(function() {
            clearInterval(fixSize);
        }, 2000);
    }

    openWindows++;
}

// ウィンドウ移動の挙動
function newXlt() { xOff = Math.ceil(-6*Math.random())*5-10; window.focus(); }
function newXrt() { xOff = Math.ceil(7*Math.random())*5-10; window.focus(); }
function newYup() { yOff = Math.ceil(-6*Math.random())*5-10; window.focus(); }
function newYdn() { yOff = Math.ceil(7*Math.random())*5-10; window.focus(); }
function fOff(){ flagRun=0; }

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

// ==== 初期化 ====
window.onload = function() {
    flagRun = 1;

    // 親ウィンドウだけ最初に5個作成（0.3秒間隔で順番に）
    if (!window.opener) {
        let i = 0;
        let openerInterval = setInterval(function() {
            if (i < maxWindows) {
                openWindow('lol.html');
                i++;
            } else {
                clearInterval(openerInterval);
            }
        }, 300); // 0.3秒ごとに1つ開く
    } else {
        // 子ウィンドウでは増殖イベントを削除
        window.onmouseout = null;
        window.onkeydown = null;
    }

    playBall();
    bookmark();
    return true;
};

// ==== イベント（親ウィンドウのみ） ====
if (!window.opener) {
    window.onmouseout = function(){ openWindow('lol.html'); return null; }
    window.oncontextmenu = function(){ return false; }
    window.onkeydown = function(event){    
        var keyCode = event.keyCode;
        if (keyCode==17||keyCode==18||keyCode==46||keyCode==115){
            alert("You are an idiot!");
            openWindow('lol.html');
        }
        return null;
    }
}

// ウィンドウ閉じるときの警告（そのまま）
window.onbeforeunload = function(){ return "Are you an idiot?"; };
