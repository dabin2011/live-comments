/* script.js - 修正版（ログインポップアップ / コメント / アンケート / 将棋 / プロフィール） */

/* ---------- 必須設定（置き換えてください） ---------- */
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
const GAS_URL = "https://script.google.com/macros/s/AKfycbx4wOZbfs_5oln8NQpK_6VXyEzqJDGdn5MvK4NNtMkH1Ve_az-8e_J5ukKe8JNrbHgO/exec";

/* ---------- Firebase 初期化 ---------- */
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();
const commentsRef = db.ref('comments');
const pollsRef = db.ref('polls');
const gamesRef = db.ref('games');

/* ---------- ユーティリティ ---------- */
function el(id){ return document.getElementById(id) || null; }
function now(){ return Date.now(); }
function escapeHtml(s){ if (s == null) return ''; return String(s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
function show(elm){ if (!elm) return; elm.style.display = 'block'; elm.setAttribute('aria-hidden','false'); }
function hide(elm){ if (!elm) return; elm.style.display = 'none'; elm.setAttribute('aria-hidden','true'); }

/* ---------- DOMContentLoaded で初期化 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  initUIControls();
  initAuth();
  initCommentFeature();
  initPollFeature();
  initProfileUpload();
  initGameFeature();
  initGameListSubscribe();
});

/* ---------- UI コントロール（モーダル開閉） ---------- */
function initUIControls(){
  const loginModal = el('loginModal');
  safeAdd('openLoginBtn','click', ()=> show(loginModal));
  safeAdd('closeLoginBtn','click', ()=> hide(loginModal));
  // モーダル外クリックで閉じる
  if (loginModal) loginModal.addEventListener('click', (ev)=>{ if (ev.target === loginModal) hide(loginModal); });
  // ESC で閉じる
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(loginModal); });
}
function safeAdd(id, ev, fn){ const e = el(id); if (e) e.addEventListener(ev, fn); }

/* ---------- 認証処理 ---------- */
function initAuth(){
  safeAdd('loginBtn','click', async ()=>{
    const email = el('emailInput')?.value || '';
    const password = el('passwordInput')?.value || '';
    if (!email || !password) return alert('メールとパスワードを入力してください');
    try {
      await auth.signInWithEmailAndPassword(email, password);
      hide(el('loginModal'));
    } catch(e){
      console.error('login error', e);
      alert('ログイン失敗: ' + (e.message || e));
    }
  });

  safeAdd('logoutBtn','click', ()=> auth.signOut().catch(e=>console.error('signOut failed', e)));

  auth.onAuthStateChanged(user => {
    if (user) {
      if (el('loginArea')) el('loginArea').style.display = 'none';
      if (el('userArea')) el('userArea').style.display = 'flex';
      if (el('username')) el('username').textContent = user.displayName || user.email || user.uid;
      if (el('avatar')) el('avatar').src = user.photoURL || '';
    } else {
      if (el('loginArea')) el('loginArea').style.display = 'flex';
      if (el('userArea')) el('userArea').style.display = 'none';
      if (el('username')) el('username').textContent = '';
      if (el('avatar')) el('avatar').src = '';
    }
  });
}

/* ---------- コメント機能 ---------- */
function initCommentFeature(){
  const sendBtn = el('sendCommentBtn');
  const input = el('commentInput');
  const list = el('commentList');
  if (!sendBtn || !input || !list) { console.warn('コメント要素不足'); return; }

  // 送信
  sendBtn.addEventListener('click', async ()=>{
    const text = input.value.trim();
    if (!text) return alert('コメントを入力してください');
    const user = auth.currentUser;
    if (!user) return alert('ログインしてください');
    sendBtn.disabled = true;
    try {
      await commentsRef.push({
        uid: user.uid,
        name: user.displayName || user.email || 'ユーザー',
        text,
        ts: now()
      });
      input.value = '';
    } catch(e){
      console.error('comment push failed', e);
      alert('コメント送信に失敗しました');
    } finally {
      sendBtn.disabled = false;
    }
  });

  // 表示（過去200件＋新着）
  // 既存 handler を一旦外して重複を防ぐ
  commentsRef.limitToLast(200).off('child_added');
  commentsRef.limitToLast(200).on('child_added', snap=>{
    try {
      const d = snap.val();
      if (!d) return;
      const row = document.createElement('div');
      row.className = 'comment';
      const time = d.ts ? new Date(d.ts).toLocaleString() : '';
      row.innerHTML = `<div class="comment-head"><strong>${escapeHtml(d.name)}</strong><span class="comment-time">${escapeHtml(time)}</span></div><div class="comment-body">${escapeHtml(d.text)}</div>`;
      // 新着を上に
      const first = list.firstChild;
      if (first) list.insertBefore(row, first); else list.appendChild(row);
    } catch(err){
      console.error('render comment failed', err);
    }
  });
}

/* ---------- アンケート機能 ---------- */
function initPollFeature(){
  const createBtn = el('createPollBtn');
  const addOptionBtn = el('addPollOptionBtn');
  const optionsContainer = el('pollOptionsContainer');
  const pollArea = el('pollArea');
  if (!createBtn || !optionsContainer || !pollArea) { console.warn('poll elements missing'); return; }

  // 最低2つの選択肢を準備
  if (optionsContainer.querySelectorAll('.pollOption').length < 2) {
    for (let i=0;i<2;i++){
      const inp = document.createElement('input'); inp.type='text'; inp.className='pollOption'; inp.placeholder='選択肢';
      optionsContainer.appendChild(inp);
    }
  }

  addOptionBtn && addOptionBtn.addEventListener('click', ()=> {
    const inp = document.createElement('input'); inp.type='text'; inp.className='pollOption'; inp.placeholder='選択肢';
    optionsContainer.appendChild(inp);
    inp.focus();
  });

  createBtn.addEventListener('click', async ()=>{
    try {
      if (!auth.currentUser) return alert('ログインしてください');
      const question = el('pollQuestion')?.value?.trim();
      if (!question) return alert('質問を入力してください');
      const labels = Array.from(optionsContainer.querySelectorAll('.pollOption')).map(i=>i.value.trim()).filter(v=>v);
      if (labels.length < 2) return alert('選択肢を2つ以上用意してください');
      const options = labels.map(label => ({ id: Math.random().toString(36).slice(2), label, count: 0 }));
      await pollsRef.child('active').set({ question, options });
      // clear editor
      el('pollQuestion').value = '';
      optionsContainer.innerHTML = '';
      // re-add two blanks
      for (let i=0;i<2;i++){ const inp = document.createElement('input'); inp.type='text'; inp.className='pollOption'; inp.placeholder='選択肢'; optionsContainer.appendChild(inp); }
      alert('アンケートを作成しました');
    } catch(e){ console.error('create poll failed', e); alert('アンケート作成に失敗しました'); }
  });

  // 表示と投票
  pollsRef.child('active').off('value');
  pollsRef.child('active').on('value', snap=>{
    try {
      const poll = snap.val(); pollArea.innerHTML = '';
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
            let stored = snapshot.val();
            if (stored == null) stored = Array.isArray(poll.options) ? poll.options : (poll.options ? Object.values(poll.options) : []);
            if (Array.isArray(stored)) {
              for (let i=0;i<stored.length;i++) if (stored[i].id === opt.id) stored[i].count = (stored[i].count||0) + 1;
              await pRef.set(stored);
            } else {
              for (const k in stored) if (stored[k].id === opt.id) stored[k].count = (stored[k].count||0) + 1;
              await pRef.set(stored);
            }
          } catch(e){ console.error('vote failed', e); alert('投票に失敗しました'); }
        });
        pollArea.appendChild(btn);
      });
    } catch(e){ console.error('render poll failed', e); }
  });
}

/* ---------- プロフィール画像アップロード（Apps Script経由） ---------- */
function initProfileUpload(){
  const uploadBtn = el('uploadProfileBtn');
  const fileInput = el('profileImageFile');
  if (!uploadBtn || !fileInput) { console.warn('profile upload elements missing'); return; }

  uploadBtn.addEventListener('click', async ()=>{
    if (!auth.currentUser) return alert('ログインしてください');
    const file = fileInput.files && fileInput.files[0];
    if (!file) return alert('ファイルを選択してください');
    try {
      const form = new FormData();
      form.append('uid', auth.currentUser.uid);
      form.append('file', file, file.name);
      const res = await fetch(GAS_URL, { method:'POST', body: form });
      if (!res.ok) throw new Error('GAS upload failed: ' + res.status);
      const data = await res.json();
      if (data && data.url) {
        await auth.currentUser.updateProfile({ photoURL: data.url });
        if (el('avatar')) el('avatar').src = data.url;
        alert('プロフィール画像を更新しました');
      } else {
        console.error('GAS returned invalid', data);
        alert('アップロードに失敗しました');
      }
    } catch(e){ console.error('uploadProfile error', e); alert('アップロードエラー'); }
  });
}

/* ---------- 将棋ゲーム機能（作成 / リスト / 開始 / 描画 / 移動） ---------- */
const pieceImages = {
  'p':'pawn.png','P':'pawn.png','l':'lance.png','L':'lance.png','n':'knight.png','N':'knight.png',
  's':'silver.png','S':'silver.png','g':'gold.png','G':'gold.png','k':'king.png','K':'king.png',
  'r':'rook.png','R':'rook.png','b':'bishop.png','B':'bishop.png',
  '+p':'tokin.png','+s':'promoted_silver.png','+n':'promoted_knight.png','+l':'promoted_lance.png','+r':'dragon.png','+b':'horse.png'
};

let selectedPiece = null;
let currentGameIdLocal = null;
let gameLocalState = null;

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

function initGameFeature(){
  safeAdd('createGameBtn','click', async ()=>{
    if (!auth.currentUser) return alert('ログインしてください');
    try {
      const gid = gamesRef.push().key;
      const gameObj = {
        id: gid, type: 'shogi', hostUid: auth.currentUser.uid, status:'lobby', createdAt: now(),
        players:{ [auth.currentUser.uid]: { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email, accepted:true, role:'host', ts: now() } },
        shogi: { board: initialShogiBoard(), turn: auth.currentUser.uid, moves: [] },
        activePlayers: { [auth.currentUser.uid]: true }
      };
      await gamesRef.child(gid).set(gameObj);
      openGameUI(gid, gameObj);
    } catch(e){ console.error('create game failed', e); alert('ゲーム作成失敗'); }
  });

  safeAdd('startGameBtn','click', async ()=>{
    if (!currentGameIdLocal) return alert('ゲームを選択してください');
    try { await gamesRef.child(currentGameIdLocal).update({ status:'running', startedAt: now() }); }
    catch(e){ console.error('startGame failed', e); }
  });
}

function initGameListSubscribe(){
  const listEl = el('gamesList');
  if (!listEl) return;
  gamesRef.off('value');
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

function initGameAutoSubscribe(){
  // child change notifications handled in openGameUI subscription
  gamesRef.on('child_changed', snap => {
    const g = snap.val();
    if (!g) return;
    if (currentGameIdLocal === g.id) { gameLocalState = g; renderGameState(g); renderGameHeader(g); }
  });
  gamesRef.on('child_removed', snap => {
    const r = snap.val();
    if (!r) return;
    if (currentGameIdLocal === r.id) closeGameUI();
  });
}

function openGameUI(gid, initialObj){
  if (!gid) return;
  try { if (currentGameIdLocal) gamesRef.child(currentGameIdLocal).off('value'); } catch(e){}
  currentGameIdLocal = gid;
  gameLocalState = initialObj || null;
  show(el('gameArea'));
  renderGameHeader(initialObj || {});
  gamesRef.child(gid).off('value');
  gamesRef.child(gid).on('value', snap => {
    const g = snap.val();
    if (!g) { closeGameUI(); return; }
    gameLocalState = g;
    renderGameState(g);
    renderGameHeader(g);
  });
}

function renderGameHeader(game){
  const title = el('gameTitle'); if (title) title.textContent = game.type === 'shogi' ? '将棋（対戦）' : 'ゲーム';
  const controls = el('gameControls'); if (!controls) return;
  controls.innerHTML = '';
  const statusBadge = document.createElement('span'); statusBadge.textContent = game.status || 'lobby'; statusBadge.style.marginRight='8px'; statusBadge.style.fontWeight='700'; controls.appendChild(statusBadge);
  const hostInfo = document.createElement('span'); hostInfo.textContent = game.hostUid ? `主催: ${game.hostUid}` : '主催: なし'; hostInfo.style.marginRight='12px'; hostInfo.style.opacity='0.85'; controls.appendChild(hostInfo);
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

async function requestJoinGame(gid){
  if (!auth.currentUser) return alert('ログインしてください');
  const u = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || 'ユーザー', accepted:false, ts: now() };
  try { await gamesRef.child(gid).child('players').child(u.uid).set(u); alert('参加希望を送りました'); }
  catch(e){ console.error('requestJoin failed', e); alert('参加申請失敗'); }
}

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
  } catch(e){ console.error('pickAndStartGame error', e); alert('開始処理でエラー'); }
}

function renderGameState(game){
  if (!game) return;
  if (game.type === 'shogi') {
    const shogi = game.shogi || {};
    renderShogiBoard(game.id, shogi);
    const info = el('gameInfo');
    if (auth?.currentUser && info) info.textContent = (shogi.turn === auth.currentUser.uid) ? "あなたの番です" : "相手の番です";
  }
}

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
          if (shogi.turn !== user.uid) return;
          clearHighlights();
          selectedPiece = { r, c, piece };
          const moves = calcMoves(piece, r, c, board);
          moves.forEach(m => {
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

function clearHighlights(){
  document.querySelectorAll('.highlight').forEach(e => e.classList.remove('highlight'));
}

function makeShogiMove(gid, uid, from, to){
  if (!gid || !gamesRef) return;
  const shogiRef = gamesRef.child(gid).child('shogi');
  shogiRef.transaction(current=>{
    if (!current) return current;
    const board = current.board || initialShogiBoard();
    const piece = board[from.r][from.c];
    if (!piece || piece === '.') return current;
    if (current.turn && current.turn !== uid) return current;
    const legal = calcMoves(piece, from.r, from.c, board).some(m=>m.r===to.r && m.c===to.c);
    if (!legal) return current;
    const target = board[to.r][to.c];
    if (target === 'k' || target === 'K') {
      board[to.r][to.c] = piece; board[from.r][from.c] = '.';
      current.board = board; current.moves = current.moves || []; current.moves.push({ by: uid, from, to, ts: now() });
      current.turn = null;
      gamesRef.child(gid).update({ status:'finished', finishedAt: now(), winnerUid: uid }).catch(e=>console.error('update finish failed', e));
      if (uid === auth.currentUser?.uid) alert('あなたの勝利'); else alert('あなたの負け');
      return current;
    }
    board[to.r][to.c] = piece; board[from.r][from.c] = '.';
    current.board = board; current.moves = current.moves || []; current.moves.push({ by: uid, from, to, ts: now() });
    const active = current.activePlayers ? Object.keys(current.activePlayers) : [];
    const other = active.find(id=>id!==uid) || uid;
    current.turn = other;
    return current;
  }, (err)=>{ if (err) console.error('makeShogiMove transaction error', err); });
}

async function endGame(gid, winnerUid){
  if (!gid) return;
  try {
    await gamesRef.child(gid).update({ status:'finished', finishedAt: now(), winnerUid: winnerUid || null });
    setTimeout(async ()=> { try { await gamesRef.child(gid).remove(); } catch(e){ console.warn('remove game failed', e); } closeGameUI(); }, 2000);
  } catch(e){ console.error('endGame error', e); }
}

function closeGameUI(){ try { if (currentGameIdLocal) gamesRef.child(currentGameIdLocal).off(); } catch(e){} currentGameIdLocal = null; gameLocalState = null; hide(el('gameArea')); }

/* ---------- 自動購読（初期化時） ---------- */
function initGameListSubscribe(){
  const listEl = el('gamesList');
  if (!listEl) return;
  gamesRef.off('value');
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

/* ---------- 補助関数 ---------- */
function safeAdd(id, ev, fn){ const e = el(id); if (e) e.addEventListener(ev, fn); }
