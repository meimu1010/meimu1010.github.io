// ===== 震度スケール定義 (P2P地震情報のscale値) =====
const SHINDO = {
  10:{label:"1",  color:"#5a6b8c"},
  20:{label:"2",  color:"#4aa3df"},
  30:{label:"3",  color:"#36b37e"},
  40:{label:"4",  color:"#f2c744"},
  45:{label:"5弱",color:"#f7941d"},
  50:{label:"5強",color:"#f7681d"},
  55:{label:"6弱",color:"#e8403a"},
  60:{label:"6強",color:"#c4222e"},
  70:{label:"7",  color:"#a01a8d"},
};
function shindo(scale){
  return SHINDO[scale] || {label:"-", color:"#3a4658"};
}

// ===== 状態 =====
let quakes = [];
let selectedId = null;
let layerGroup;
const API = "https://api.p2pquake.net/v2/history?codes=551&codes=556&limit=80";

// ===== 地図初期化 (地理院タイル) =====
const map = L.map('map',{zoomControl:true, attributionControl:true})
  .setView([37.5, 137.5], 5);
L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/dark/{z}/{x}/{y}.png',{
  attribution:"地理院タイル", maxZoom:14, minZoom:3
}).addTo(map);
// ダークタイルが無い環境向けフォールバック
map.on('tileerror', ()=>{});
layerGroup = L.layerGroup().addTo(map);

// ===== 凡例 =====
(function buildLegend(){
  const el = document.getElementById('legend');
  let html = '<div style="margin-bottom:4px;color:#8a97ad">最大震度</div>';
  [10,20,30,40,45,50,55,60,70].forEach(s=>{
    const v = shindo(s);
    html += `<div class="row"><span class="sw" style="background:${v.color}"></span>震度 ${v.label}</div>`;
  });
  el.innerHTML = html;
})();

// ===== データ取得 =====
async function fetchData(){
  setStatus("取得中…");
  try{
    const res = await fetch(API);
    if(!res.ok) throw new Error(res.status);
    const data = await res.json();
    quakes = data
      .filter(d => d.earthquake && d.earthquake.hypocenter)
      .map(normalize);
    render();
    setStatus("最終更新 " + new Date().toLocaleTimeString('ja-JP'));
  }catch(e){
    setStatus("取得失敗");
    console.error(e);
  }
}

function normalize(d){
  const isEew = d.code === 556;
  let h, mag, depth, name, maxScale, time, tsunami;
  if(isEew){
    // 緊急地震速報
    const eq = d.earthquake || {};
    h = eq.hypocenter || {};
    mag = h.magnitude; depth = h.depth; name = h.name || "不明";
    maxScale = d.areas && d.areas.length ?
      Math.max(...d.areas.map(a=>a.scaleTo||a.scaleFrom||0)) : (h.maxScale||0);
    time = eq.originTime || eq.arrivalTime || d.time;
    tsunami = null;
  }else{
    const eq = d.earthquake;
    h = eq.hypocenter;
    mag = h.magnitude; depth = h.depth; name = h.name || "不明";
    maxScale = eq.maxScale; time = eq.time; tsunami = eq.domesticTsunami;
  }
  return {
    id:d.id, isEew, name,
    lat:h.latitude, lon:h.longitude,
    mag, depth, maxScale, time, tsunami,
    points:d.points || []
  };
}

// ===== 描画 =====
function render(){
  const filter = document.getElementById('filterSelect').value;
  const list = quakes.filter(q=>{
    if(filter==='info') return !q.isEew;
    if(filter==='eew')  return q.isEew;
    return true;
  });
  renderList(list);
  renderMarkers(list);
  document.getElementById('count').textContent = `(${list.length})`;
}

function renderList(list){
  const ul = document.getElementById('quakeList');
  ul.innerHTML = "";
  list.forEach(q=>{
    const v = shindo(q.maxScale);
    const li = document.createElement('li');
    li.dataset.id = q.id;
    if(q.id===selectedId) li.classList.add('active');
    li.innerHTML = `
      <div class="mini-badge" style="background:${v.color}">${v.label}</div>
      <div class="li-body">
        <div class="li-name">${q.name}${q.isEew?'<span class="eew-tag">緊急速報</span>':''}</div>
        <div class="li-meta">${fmtTime(q.time)} ・ M${fmtMag(q.mag)} ・ 深さ${fmtDepth(q.depth)}</div>
      </div>`;
    li.addEventListener('click', ()=>select(q.id));
    ul.appendChild(li);
  });
}

function renderMarkers(list){
  layerGroup.clearLayers();
  list.forEach(q=>{
    if(q.lat==null || q.lon==null || q.lat===0) return;
    const v = shindo(q.maxScale);
    const size = 18 + (q.maxScale/70)*26;
    const icon = L.divIcon({
      className:'',
      html:`<div class="epi-icon" style="width:${size}px;height:${size}px;background:${v.color};font-size:${size*0.45}px">${v.label}</div>`,
      iconSize:[size,size], iconAnchor:[size/2,size/2]
    });
    const m = L.marker([q.lat,q.lon],{icon}).addTo(layerGroup);
    // 震源の範囲（マグニチュード比例の円）
    L.circle([q.lat,q.lon],{
      radius: Math.max(20000, Math.pow(2,q.mag||3)*4000),
      color:v.color, weight:1, fillColor:v.color, fillOpacity:0.12
    }).addTo(layerGroup);
    m.on('click', ()=>select(q.id));
    m.bindPopup(`<b>${q.name}</b><br>最大震度 ${v.label} / M${fmtMag(q.mag)}<br>${fmtTime(q.time)}`);
    if(q.id===selectedId) m.openPopup();
  });
}

function select(id){
  selectedId = id;
  const q = quakes.find(x=>x.id===id);
  if(!q) return;
  renderDetail(q);
  render();
  if(q.lat && q.lon) map.flyTo([q.lat,q.lon], 7, {duration:0.8});
}

function renderDetail(q){
  const v = shindo(q.maxScale);
  const card = document.getElementById('detailCard');
  let tsunamiHtml = "";
  if(q.tsunami){
    const map_={None:["津波の心配なし","#36b37e"],Unknown:["津波情報なし","#5a6b8c"],
      NonEffective:["若干の海面変動","#f2c744"],Watch:["津波注意報","#f7681d"],Warning:["津波警報","#e8403a"]};
    const t = map_[q.tsunami]||["—","#5a6b8c"];
    tsunamiHtml = `<div class="tsunami" style="background:${t[1]}22;color:${t[1]};border:1px solid ${t[1]}">${t[0]}</div>`;
  }
  card.innerHTML = `
    <div class="detail-head">
      <div class="shindo-badge" style="background:${v.color}">
        <small>最大震度</small><b>${v.label}</b>
      </div>
      <div>
        <div class="h-name">${q.name}${q.isEew?'<span class="eew-tag">緊急地震速報</span>':''}</div>
        <div class="h-time">${fmtTime(q.time)}</div>
      </div>
    </div>
    <div class="detail-grid">
      <div class="cell"><span>マグニチュード</span><strong>M ${fmtMag(q.mag)}</strong></div>
      <div class="cell"><span>震源の深さ</span><strong>${fmtDepth(q.depth)}</strong></div>
      <div class="cell"><span>緯度</span><strong>${q.lat ?? '—'}</strong></div>
      <div class="cell"><span>経度</span><strong>${q.lon ?? '—'}</strong></div>
    </div>
    ${tsunamiHtml}`;
}

// ===== ユーティリティ =====
function fmtTime(t){ return t ? t.replace(/\//g,'/').slice(0,16) : '不明'; }
function fmtMag(m){ return (m==null||m<0) ? '—' : Number(m).toFixed(1); }
function fmtDepth(d){ return (d==null||d<0) ? '不明' : (d===0?'ごく浅い':`${d}km`); }
function setStatus(s){ document.getElementById('status').textContent = s; }

// ===== イベント・自動更新 =====
let timer = null;
function startTimer(){ timer = setInterval(fetchData, 30000); }
function stopTimer(){ clearInterval(timer); }
document.getElementById('refreshBtn').addEventListener('click', fetchData);
document.getElementById('filterSelect').addEventListener('change', render);
document.getElementById('autoUpdate').addEventListener('change', e=>{
  e.target.checked ? startTimer() : stopTimer();
});

// 起動
fetchData();
startTimer();
