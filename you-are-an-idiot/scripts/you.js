// ==== 安全版 you.js（最大5個） ====

var maxWindows = 5;
var openWindows = 0;

function bookmark() {
	if ((navigator.appName == "Microsoft Internet Explorer") && (parseInt(navigator.appVersion) >= 4)) {
		var url = "lol.html";
		var title = "Idiot!";
		window.external.AddFavorite(url, title);
	}
}

var xOff = 5;
var yOff = 5;
var xPos = 400;
var yPos = -100;
var flagRun = 1;

function changeTitle(title) {
	document.title = title;
}

function openWindow(url) {
	if (openWindows >= maxWindows) return; // 最大数チェック
	window.open(url, "_blank", 'menubar=no, status=no, toolbar=no, resizable=no, width=357, height=330, titlebar=no, alwaysRaised=yes');
	openWindows++;
}

function proCreate() {
	openWindow('lol.html'); // 上限チェックは openWindow 側で行う
}

function newXlt() {
	xOff = Math.ceil(-6 * Math.random()) * 5 - 10;
	window.focus();
}

function newXrt() {
	xOff = Math.ceil(7 * Math.random())  * 5 - 10;
	window.focus();
}

function newYup() {
	yOff = Math.ceil(-6 * Math.random()) * 5 - 10;
	window.focus();
}

function newYdn() {
	yOff = Math.ceil( 7 * Math.random()) * 5 - 10;
	window.focus();
}

function fOff(){
	flagRun = 0;
}

function playBall() {
    xPos += xOff;
    yPos += yOff;
    
	if (xPos > screen.width - 357) newXlt();    
	if (xPos < 0) newXrt();
    
	if (yPos > screen.height - 330) newYup(); 		
	if (yPos < 0) newYdn();
    
	if (flagRun == 1) {
        window.moveTo(xPos, yPos);
        setTimeout('playBall()', 1);
    }
}

/* 初期化 */
window.onload = function () {
	flagRun = 1;

	// 最初に5個作る
	for (var i=0; i<maxWindows; i++) {
		openWindow('lol.html');
	}

	playBall();
	bookmark(); // IE only
	return true;
};

/* イベント */
window.onmouseout = function () { proCreate(); return null; }

window.oncontextmenu = function() { return false; }

window.onkeydown = function(event) {	
	var keyCode = event.keyCode;
	if (keyCode == 17 || keyCode == 18 || keyCode == 46 || keyCode == 115) {
		alert("You are an idiot!");
		proCreate();
	}
	return null;
}

window.onbeforeunload = function() {
    return "Are you an idiot?";
};
