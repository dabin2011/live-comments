/* script.js - 修正版（ログイン / コメント / アンケート / 将棋 / プロフィール画像アップロード） */

/*
  前提（HTMLに存在すること）:
  loginArea, userArea, emailInput, passwordInput, loginBtn, logoutBtn, username, avatar,
  commentInput, sendCommentBtn, commentList,
  pollQuestion, pollOptionsContainer, addPollOptionBtn, createPollBtn, pollArea,
  profileImageFile, uploadProfileBtn,
  gameArea, startGameBtn, shogiContainer, gamesList, createGameBtn, gameModal, gameTitle, gameControls, gameInfo
  CSS: .grid, .grid-cell, .highlight, .koma-gote などを用意してください
  Firebase SDK と fetch が利用可能であること
  assets/koma/ に駒画像を配置してください
  GAS_URL は実際の Apps Script デプロイ URL に置き換えてください
*/

/* =========================
   Firebase 初期化（設定を置き換えてください）
   ========================= */
const firebaseConfig = {
  apiKey: "AIzaSyD1AK05uuGBw2U4Ne5LbKzzjzCqnln60mg",
  authDomain: "shige-live.firebaseapp.com",
  databaseURL: "https://shige-live-default-rtdb.firebaseio.com",
  projectId: "shige-live",
  storageBucket: "shige-live.firebasestorage.app",
  messagingSenderId: "135620625815",
  appId: "1:135620625815:web:514ba3dd5cd625c144f0d2",
  measurementId: "G-5Y7F6V9668"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();
const commentsRef = db.ref('comments');
const pollsRef = db.ref('polls');
const gamesRef = db.ref('games');

/* Apps Script URL（プロフィール画像アップロード用） */
const GAS_URL = "https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec";

/* =========================
   ユーティリティ
   ========================= */
function el(id){ return document.getElementById(id) || null; }
function now(){ return Date.now(); }
function escapeHtml(s){ if (s == null) return ''; return String(s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
function safeAddListener(id, event, fn){ const e = el(id); if (e) e.addEventListener(event, fn); }

/* =========================
   全体初期化（DOM が準備できてから）
   ========================= */
document.addEventListener('DOMContentLoaded', () => {
  initAuthUI();
  initCommentFeature();
  initPollFeature();
  initProfileUpload();
  initGameFeature();
});

/* =========================
   認証 UI ロジック
   ========================= */
function initAuthUI(){
  safeAddListener('loginBtn','click', () => {
    const email = el('emailInput')?.value || '';
    const password = el('passwordInput')?.value || '';
    if (!email || !password) return alert('メールとパスワードを入力してください');
    auth.signInWithEmailAndPassword(email, password).catch(e=>{
      console.error('signIn error', e);
      alert('ログイン失敗: ' + (e.message || e));
    });
  });

  safeAddListener('logoutBtn','click', () => {
    auth.signOut().catch(e=>console.error('signOut failed', e));
  });

  auth.onAuthStateChanged(user => {
    try {
      if (user) {
        if (el('loginArea')) el('loginArea').style.display = 'none';
        if (el('userArea')) el('userArea').style.display = 'block';
        if (el('username')) el('username').textContent = user.displayName || user.email || '';
        if (el('avatar')) el('avatar').src = user.photoURL || '';
      } else {
        if (el('loginArea')) el('loginArea').style.display = 'block';
        if (el('userArea')) el('userArea').style.display = 'none';
        if (el('username')) el('username').textContent = '';
        if (el('avatar')) el('avatar').src = '';
      }
    } catch(e){ console.error('onAuthStateChanged handler error', e); }
  });
}

/* =========================
   コメント機能
   ========================= */
function initCommentFeature(){
  const sendBtn = el('sendCommentBtn');
  const input = el('commentInput');
  const list = el('commentList');
  if (!sendBtn || !input || !list) {
    console.warn('コメント機能の要素が足りません');
    return;
  }

  sendBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return alert('コメントを入力してください');
    const user = auth.currentUser;
    if (!user) return alert('ログインしてください');
    commentsRef.push({
      uid: user.uid,
      name: user.displayName || user.email || 'ユーザー',
      text,
      ts: now()
    }).then(()=>{ input.value = ''; }).catch(e=>{ console.error('comment push failed', e); alert('コメント送信失敗'); });
  });

  // 既存コメント表示
  commentsRef.limitToLast(100).on('child_added', snap => {
    try {
      const d = snap.val();
      if (!d) return;
      const row = document.createElement('div');
      row.className = 'comment';
      row.innerHTML = `<strong>${escapeHtml(d.name)}</strong>: ${escapeHtml(d.text)}`;
      // 先頭に追加
      if (list.firstChild) list.insertBefore(row, list.firstChild); else list.appendChild(row);
    } catch(e){ console.error('render comment failed', e); }
  });
}

/* =========================
   アンケート（Poll）機能
   ========================= */
function initPollFeature(){
  const createBtn = el('createPollBtn');
  const addOptionBtn = el('addPollOptionBtn');
  const optionsContainer = el('pollOptionsContainer');
  const pollArea = el('pollArea');
  if (!createBtn || !optionsContainer || !pollArea) {
    console.warn('アンケート機能の要素が足りません');
    return;
  }

  // 最低2つの選択肢がなければ追加
  if (optionsContainer.querySelectorAll('.pollOption').length < 2) {
    for (let i=0;i<2;i++){
      const inp = document.createElement('input'); inp.type='text'; inp.className='pollOption'; inp.placeholder = '選択肢';
      optionsContainer.appendChild(inp);
    }
  }

  addOptionBtn && addOptionBtn.addEventListener('click', ()=>{
    const inp = document.createElement('input'); inp.type='text'; inp.className='pollOption'; inp.placeholder='選択肢';
    optionsContainer.appendChild(inp);
  });

  createBtn.addEventListener('click', ()=>{
    if (!auth.currentUser) return alert('ログインしてください');
    const question = el('pollQuestion')?.value?.trim();
    if (!question) return alert('質問を入力してください');
    const labels = Array.from(optionsContainer.querySelectorAll('.pollOption')).map(i=>i.value.trim()).filter(v=>v);
    if (labels.length < 2) return alert('選択肢を2つ以上用意してください');
    const options = labels.map(label => ({ id: Math.random().toString(36).slice(2), label, count: 0 }));
    pollsRef.child('active').set({ question, options }).catch(e=>{ console.error('create poll failed', e); alert('アンケート作成失敗'); });
  });

  // 投票 UI 更新
  pollsRef.child('active').on('value', snap => {
    try {
      const poll = snap.val();
      pollArea.innerHTML = '';
      if (!poll) return;
      const h = document.createElement('h3'); h.textContent = poll.question || '';
      pollArea.appendChild(h);
      const opts = Array.isArray(poll.options) ? poll.options : (poll.options ? Object.values(poll.options) : []);
      opts.forEach(opt => {
        const btn = document.createElement('button');
        btn.textContent = `${opt.label} (${opt.count ?? 0})`;
        btn.addEventListener('click', async ()=>{
          try {
            const pRef = pollsRef.child('active/options');
            const snapshot = await pRef.once('value');
            const stored = snapshot.val();
            if (Array.isArray(stored)) {
              for (let i=0;i<stored.length;i++) if (stored[i].id === opt.id) stored[i].count = (stored[i].count||0) + 1;
              await pRef.set(stored);
            } else {
              // object map
              for (const k in stored || {}) {
                if (stored[k].id === opt.id) stored[k].count = (stored[k].count||0) + 1;
              }
              await pRef.set(stored);
            }
          } catch(e){ console.error('vote failed', e); alert('投票に失敗しました'); }
        });
        pollArea.appendChild(btn);
      });
    } catch(e){ console.error('render poll failed', e); }
  });
}

/* =========================
   プロフィール画像アップロード（Apps Script 経由）
   ========================= */
function initProfileUpload(){
  const uploadBtn = el('uploadProfileBtn');
  const fileInput = el('profileImageFile');
  if (!uploadBtn || !fileInput) { console.warn('プロフィールアップロード要素が不足'); return; }
  uploadBtn.addEventListener('click', async ()=>{
    if (!auth.currentUser) return alert('ログインしてください');
    const file = fileInput.files && fileInput.files[0];
    if (!file) return alert('ファイルを選択してください');
    try {
      const form = new FormData();
      form.append('uid', auth.currentUser.uid);
      form.append('file', file, file.name);
      const res = await fetch(GAS_URL, { method: 'POST', body: form });
      if (!res.ok) throw new Error('GAS upload failed: ' + res.status);
      const data = await res.json();
      if (data && data.url) {
        await auth.currentUser.updateProfile({ photoURL: data.url });
        if (el('avatar')) el('avatar').src = data.url;
        alert('プロフィール画像を更新しました');
      } else {
        console.error('GAS returned invalid:', data);
        alert('アップロードに失敗しました');
      }
    } catch(e){ console.error('uploadProfile error', e); alert('アップロード中にエラーが発生しました'); }
  });
}

/* =========================
   将棋ゲーム機能
   - create / list / open / join / pickAndStart / render / move / end
   ========================= */
const pieceImages = {
  'p': 'pawn.png','P': 'pawn.png',
  'l': 'lance.png','L': 'lance.png',
  'n': 'knight.png','N': 'knight.png',
  's': 'silver.png','S': 'silver.png',
  'g': 'gold.png','G': 'gold.png',
  'k': 'king.png','K': 'king.png',
  'r': 'rook.png','R': 'rook.png',
  'b': 'bishop.png','B': 'bishop.png',
  '+p': 'tokin.png',
  '+s': 'promoted_silver.png',
  '+n': 'promoted_knight.png',
  '+l': 'promoted_lance.png',
  '+r': 'dragon.png',
  '+b': 'horse.png'
};

let selectedPiece = null;
let currentGameIdLocal = null;
let gameLocalState = null;

/* 初期盤面 */
function initialShogiBoard(){
  return [
    ['l','n','s','g','k','g','s','n','l'],
    ['.','r','.','.','.','.','.','b','.'],
    ['p','p','p','p','p','p','p','p','p'],
    ['.','.','.','.','.','.','.','.','.'],
    ['.','.','.','.','.','.','.','.','.'],
    ['.','.','.','.','.','.','.','.','.'],
    ['P','P','P','P','P','P','P','P','P'],
    ['.','B','.','.','.','.','.','R','.'],
    ['L','N','S','G','K','G','S','N','L']
  ];
}

/* ゲーム一覧購読 */
function initGameListSubscribe(){
  const listEl = el('gamesList');
  if (!listEl) { console.warn('gamesList 要素がない'); return; }
  gamesRef.on('value', snap=>{
    try {
      listEl.innerHTML = '';
      const val = snap.val() || {};
      Object.values(val).forEach(g => {
        const row = document.createElement('div');
        row.className = 'game-row';
        row.textContent = `${g.type || 'game'} [${g.status || 'lobby'}] - ${g.id}`;
        row.addEventListener('click', ()=> openGameUI(g.id, g));
        listEl.appendChild(row);
      });
    } catch(e){ console.error('render games list failed', e); }
  });
}

/* ゲーム作成 */
function initGameFeature(){
  // create game
  safeAddListener('createGameBtn','click', async ()=>{
    if (!auth.currentUser) return alert('ログインしてください');
    try {
      const gid = gamesRef.push().key;
      const gameObj = {
        id: gid,
        type: 'shogi',
        hostUid: auth.currentUser.uid,
        status: 'lobby',
        createdAt: now(),
        players: { [auth.currentUser.uid]: { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email, accepted: true, role:'host', ts: now() } },
        shogi: { board: initialShogiBoard(), turn: auth.currentUser.uid, moves: [] },
        activePlayers: { [auth.currentUser.uid]: true }
      };
      await gamesRef.child(gid).set(gameObj);
      openGameUI(gid, gameObj);
    } catch(e){ console.error('create game failed', e); alert('ゲーム作成に失敗しました'); }
  });

  // start init list subscribe
  initGameListSubscribe();

  // subscribe lobby/running changes
  initGameAutoSubscribe();
}

/* オートサブスクライブ（イベント管理） */
function initGameAutoSubscribe(){
  try {
    gamesRef.orderByChild('status').equalTo('lobby').on('child_added', ()=>{ /* 用途に応じてUI更新可 */ });
    gamesRef.orderByChild('status').equalTo('running').on('child_added', ()=>{ /* */ });
    gamesRef.on('child_changed', snap=> {
      const g = snap.val(); if (!g) return;
      if (currentGameIdLocal === g.id) { gameLocalState = g; renderGameState(g); renderGameHeader(g); }
    });
    gamesRef.on('child_removed', snap=> {
      const removed = snap.val(); if (!removed) return;
      if (currentGameIdLocal === removed.id) closeGameUI();
    });
  } catch(e){ console.error('initGameAutoSubscribe error', e); }
}

/* ゲーム UI を開く（購読開始） */
function openGameUI(gid, initialObj){
  if (!gid) return;
  try { if (currentGameIdLocal) gamesRef.child(currentGameIdLocal).off(); } catch(e){}
  currentGameIdLocal = gid;
  gameLocalState = initialObj || null;
  const ga = el('gameArea'); if (ga) ga.style.display = 'block';
  renderGameHeader(initialObj || {});
  // subscribe to updates
  gamesRef.child(gid).on('value', snap => {
    const g = snap.val();
    if (!g) { closeGameUI(); return; }
    gameLocalState = g;
    renderGameState(g);
    renderGameHeader(g);
  });
}

/* ゲームヘッダー描画 */
function renderGameHeader(game){
  const title = el('gameTitle'); if (title) title.textContent = game.type === 'shogi' ? '将棋（対戦）' : 'ゲーム';
  const controls = el('gameControls'); if (!controls) return;
  controls.innerHTML = '';

  const statusBadge = document.createElement('span');
  statusBadge.textContent = game.status || 'lobby'; statusBadge.style.marginRight='8px'; statusBadge.style.fontWeight='700';
  controls.appendChild(statusBadge);

  const hostInfo = document.createElement('span');
  hostInfo.textContent = game.hostUid ? `主催: ${game.hostUid}` : '主催: なし';
  hostInfo.style.marginRight='12px'; hostInfo.style.opacity='0.85';
  controls.appendChild(hostInfo);

  if (auth?.currentUser) {
    if (game.status === 'lobby') {
      const joinBtn = document.createElement('button'); joinBtn.textContent = '参加希望'; joinBtn.onclick = ()=> requestJoinGame(game.id); controls.appendChild(joinBtn);
      if (auth.currentUser.uid === game.hostUid) {
        const pickBtn = document.createElement('button'); pickBtn.textContent = '参加者から選出して開始'; pickBtn.onclick = ()=> pickAndStartGame(game.id); controls.appendChild(pickBtn);
      }
    } else if (game.status === 'running') {
      if (auth.currentUser.uid === game.hostUid) {
        const endBtn = document.createElement('button'); endBtn.textContent = '強制終了'; endBtn.onclick = ()=> endGame(game.id, null); controls.appendChild(endBtn);
      }
    }
  } else {
    const info = document.createElement('span'); info.textContent = '参加するにはログインしてください'; info.style.marginLeft='8px'; info.style.color='#666'; controls.appendChild(info);
  }
}

/* 参加希望 */
async function requestJoinGame(gid){
  if (!auth.currentUser) return alert('ログインしてください');
  const u = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || 'ユーザー', accepted:false, ts: now() };
  try { await gamesRef.child(gid).child('players').child(u.uid).set(u); alert('参加希望を出しました。主催者が選出するまでお待ちください。'); }
  catch(e){ console.error('requestJoin failed', e); alert('参加申請に失敗しました'); }
}

/* 主催が参加者を選んで開始 */
async function pickAndStartGame(gid){
  try {
    const snap = await gamesRef.child(gid).child('players').once('value');
    const players = []; snap.forEach(ch=>{ const v = ch.val(); v?.uid && players.push(v); });
    const candidates = players.filter(p=>p.uid !== auth.currentUser.uid);
    if (candidates.length === 0) return alert('参加希望者がいません');
    const pick = candidates[Math.floor(Math.random()*candidates.length)];
    const updates = {};
    updates[`players/${auth.currentUser.uid}`] = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || '主催者', accepted:true, role:'host', ts: now() };
    updates[`players/${pick.uid}`] = { uid: pick.uid, name: pick.name, accepted:true, role:'player', ts: now() };
    updates['status'] = 'running';
    updates['startedAt'] = now();
    updates['activePlayers'] = { [auth.currentUser.uid]: true, [pick.uid]: true };
    await gamesRef.child(gid).update(updates);
    await gamesRef.child(gid).child('shogi').set({ board: initialShogiBoard(), turn: auth.currentUser.uid, moves: [] });
  } catch(e){ console.error('pickAndStartGame error', e); alert('開始処理でエラーが発生しました'); }
}

/* 描画: 将棋ボード（駒クリックで選択、マスクリックで移動） */
function renderGameState(game){
  if (!game) return;
  if (game.type === 'shogi') {
    const shogi = game.shogi || {};
    renderShogiBoard(game.id, shogi);
    const info = el('gameInfo');
    if (auth?.currentUser && info) {
      info.textContent = (shogi.turn === auth.currentUser.uid) ? "あなたの番です" : "相手の番です";
    }
  }
}

/* simple legal move calc (only pawn forward implemented) */
function calcMoves(piece, r, c, board){
  const moves = [];
  if (!piece) return moves;
  if (piece.toLowerCase() === 'p') {
    const dir = (piece === 'P') ? -1 : 1;
    const nr = r + dir;
    if (nr >= 0 && nr < 9 && board[nr][c] === '.') moves.push({ r: nr, c });
  }
  return moves;
}

/* ボード描画 */
function renderShogiBoard(gid, shogiState){
  const container = el('shogiContainer');
  if (!container) return;
  container.innerHTML = '';
  const board = shogiState?.board || initialShogiBoard();
  gameLocalState = gameLocalState || {};
  gameLocalState.shogi = shogiState || gameLocalState.shogi;

  const grid = document.createElement('div'); grid.className = 'grid';
  for (let r=0;r<9;r++){
    for (let c=0;c<9;c++){
      const sq = document.createElement('div'); sq.className = 'grid-cell';
      sq.dataset.r = r; sq.dataset.c = c;
      const piece = board[r][c];
      if (piece && piece !== '.') {
        const img = document.createElement('img');
        img.alt = piece;
        img.src = `assets/koma/${pieceImages[piece] || 'pawn.png'}`;
        if (piece === piece.toLowerCase()) img.classList.add('koma-gote');

        img.addEventListener('click', (ev)=>{
          ev.stopPropagation();
          const user = auth.currentUser;
          if (!user) return alert('ログインしてください');
          const shogi = gameLocalState?.shogi || {};
          if (shogi.turn !== user.uid) return; // 自分の番でなければ選べない
          clearHighlights();
          selectedPiece = { r, c, piece };
          const moves = calcMoves(piece, r, c, board);
          moves.forEach(m=>{
            const target = grid.querySelector(`.grid-cell[data-r="${m.r}"][data-c="${m.c}"]`);
            if (target) target.classList.add('highlight');
          });
        });

        sq.appendChild(img);
      }

      sq.addEventListener('click', ()=>{
        if (!selectedPiece) return;
        const from = { r: selectedPiece.r, c: selectedPiece.c };
        const to = { r: parseInt(sq.dataset.r,10), c: parseInt(sq.dataset.c,10) };
        const boardNow = (gameLocalState && gameLocalState.shogi && gameLocalState.shogi.board) ? gameLocalState.shogi.board : initialShogiBoard();
        const legal = calcMoves(selectedPiece.piece, from.r, from.c, boardNow).some(m=>m.r===to.r && m.c===to.c);
        if (!legal) { selectedPiece = null; clearHighlights(); return; }
        makeShogiMove(gid, auth.currentUser.uid, from, to);
        selectedPiece = null; clearHighlights();
      });

      grid.appendChild(sq);
    }
  }
  container.appendChild(grid);
}

/* 移動処理（transaction） */
function makeShogiMove(gid, uid, from, to){
  if (!gid || !gamesRef) return;
  const shogiRef = gamesRef.child(gid).child('shogi');
  shogiRef.transaction(current=>{
    if (!current) return current;
    const board = current.board || initialShogiBoard();
    const piece = board[from.r][from.c];
    if (!piece || piece === '.') return current;
    if (current.turn && current.turn !== uid) return current; // ターン不一致

    const legal = calcMoves(piece, from.r, from.c, board).some(m=>m.r===to.r && m.c===to.c);
    if (!legal) return current;

    const target = board[to.r][to.c];
    if (target === 'k' || target === 'K') {
      // 王を取った -> 終了
      board[to.r][to.c] = piece;
      board[from.r][from.c] = '.';
      current.board = board;
      current.moves = current.moves || [];
      current.moves.push({ by: uid, from, to, ts: now() });
      current.turn = null;
      gamesRef.child(gid).update({ status:'finished', finishedAt: now(), winnerUid: uid }).catch(e=>console.error('update finish failed', e));
      if (uid === auth.currentUser?.uid) alert('あなたの勝利'); else alert('あなたの負け');
      return current;
    }

    // 通常移動
    board[to.r][to.c] = piece;
    board[from.r][from.c] = '.';
    current.board = board;
    current.moves = current.moves || [];
    current.moves.push({ by: uid, from, to, ts: now() });
    const active = current.activePlayers ? Object.keys(current.activePlayers) : [];
    const other = active.find(id=>id!==uid) || uid;
    current.turn = other;
    return current;
  }, (err, committed, snapshot)=> {
    if (err) console.error('makeShogiMove transaction error', err);
  });
}

/* 強制終了 */
async function endGame(gid, winnerUid){
  if (!gid) return;
  try {
    await gamesRef.child(gid).update({ status:'finished', finishedAt: now(), winnerUid: winnerUid || null });
    setTimeout(async ()=> {
      try { await gamesRef.child(gid).remove(); } catch(e){ console.warn('remove game failed', e); }
      closeGameUI();
    }, 2000);
  } catch(e){ console.error('endGame error', e); }
}

/* ゲーム UI を閉じる */
function closeGameUI(){
  try { if (currentGameIdLocal) gamesRef.child(currentGameIdLocal).off(); } catch(e){}
  currentGameIdLocal = null;
  gameLocalState = null;
  if (el('gameArea')) el('gameArea').style.display = 'none';
}

/* =========================
   初期化処理（ページロード完了時に呼ばれる）
   ========================= */
function init(){
  // ゲームリスト購読（あれば）
  try { initGameListSubscribe(); } catch(e){ console.error('initGameListSubscribe failed', e); }
}
init();

/* =========================
   補助: ゲームリスト購読（独立して呼べるように分離）
   ========================= */
function initGameListSubscribe(){
  const listEl = el('gamesList');
  if (!listEl) return;
  gamesRef.on('value', snap=>{
    try {
      listEl.innerHTML = '';
      const val = snap.val() || {};
      Object.values(val).forEach(g=>{
        const row = document.createElement('div');
        row.className = 'game-row';
        row.textContent = `${g.type || 'game'} [${g.status || 'lobby'}] - ${g.id}`;
        row.addEventListener('click', ()=> openGameUI(g.id, g));
        listEl.appendChild(row);
      });
    } catch(e){ console.error('render games list failed', e); }
  });
}
