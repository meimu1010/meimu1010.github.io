// ==== 安全版 you.js（最大5個固定） ====

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
	if (openWindows >= maxWindows) return; // 上限チェック
	window.open(url, "_blank", 'menubar=no, status=no, toolbar=no, resizable=no, width=357, height=330, titlebar=no, alwaysRaised=yes');
	openWindows++;
}

// 生成関数（親ウィンドウだけ有効）
function proCreate() {
	if (window.opener) return; // 子ウィンドウでは何もしない
	openWindow('lol.html');
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

	// 親ウィンドウだけ最初に5個作成
	if (!window.opener) {
		for (var i=0;i<maxWindows;i++){
			openWindow('lol.html');
		}
	}

	playBall();
	bookmark();
	return true;
};

// ==== イベント（子ウィンドウでは増殖しない） ====
window.onmouseout = function(){ if(!window.opener) proCreate(); return null; }

window.oncontextmenu = function(){ return false; }

window.onkeydown = function(event){	
	var keyCode = event.keyCode;
	if (keyCode==17||keyCode==18||keyCode==46||keyCode==115){
		alert("You are an idiot!");
		if(!window.opener) proCreate();
	}
	return null;
}

window.onbeforeunload = function(){ return "Are you an idiot?"; };
