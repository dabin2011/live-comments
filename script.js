/* script.js - 統合版（ログイン / コメント / アンケート / 将棋 / プロフィール画像アップロード） */

/*
  前提:
  - HTML上に以下のIDを持つ要素が存在すること
    loginArea, userArea, emailInput, passwordInput, loginBtn, logoutBtn, username, avatar,
    commentInput, sendCommentBtn, commentList,
    pollQuestion, pollOption1, pollOption2, addPollOptionBtn, pollOptionsContainer, createPollBtn, pollArea,
    profileImageFile, uploadProfileBtn,
    gameArea, startGameBtn, gameInfo, shogiContainer, gamesList, createGameBtn, gameModal, gameTitle, gameControls
  - Firebase SDK が先に読み込まれていること
  - assets/koma/ に駒画像が配置されていること
  - Apps Script のデプロイ URL を GAS_URL に入れること
  - CSSで .grid, .grid-cell, .highlight, .koma-gote などスタイルを用意すること
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
firebase.initializeApp(firebaseConfig);
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
function el(id){ return document.getElementById(id); }
function now(){ return Date.now(); }
function escapeHtml(s){ if (!s) return ''; return String(s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }

/* =========================
   認証 UI ロジック
   ========================= */
el('loginBtn')?.addEventListener('click', () => {
  const email = el('emailInput')?.value || '';
  const password = el('passwordInput')?.value || '';
  if (!email || !password) return alert('メールとパスワードを入力してください');
  auth.signInWithEmailAndPassword(email, password).catch(e=>alert('ログイン失敗: ' + e.message));
});

el('logoutBtn')?.addEventListener('click', () => auth.signOut());

auth.onAuthStateChanged(user => {
  if (user) {
    el('loginArea') && (el('loginArea').style.display = 'none');
    el('userArea') && (el('userArea').style.display = 'block');
    el('username') && (el('username').textContent = user.displayName || user.email || '');
    el('avatar') && (el('avatar').src = user.photoURL || '');
  } else {
    el('loginArea') && (el('loginArea').style.display = 'block');
    el('userArea') && (el('userArea').style.display = 'none');
    if (el('username')) el('username').textContent = '';
    if (el('avatar')) el('avatar').src = '';
  }
});

/* =========================
   コメント機能
   ========================= */
el('sendCommentBtn')?.addEventListener('click', () => {
  const input = el('commentInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return alert('コメントを入力してください');
  if (!auth.currentUser) return alert('ログインしてください');
  commentsRef.push({
    uid: auth.currentUser.uid,
    name: auth.currentUser.displayName || auth.currentUser.email || 'ユーザー',
    text,
    ts: now()
  }).catch(e=>console.error('comment push failed', e));
  input.value = '';
});

commentsRef.limitToLast(100).on('child_added', snap => {
  const d = snap.val();
  if (!d) return;
  const list = el('commentList');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'comment';
  row.innerHTML = `<strong>${escapeHtml(d.name)}</strong>: ${escapeHtml(d.text)}`;
  list.prepend(row);
});

/* =========================
   アンケート（Poll）機能
   ========================= */
// pollOptionsContainer 内に .pollOption の input を複数追加できる想定
function readPollOptionsFromDOM(){
  const container = el('pollOptionsContainer');
  if (!container) return [];
  return Array.from(container.querySelectorAll('.pollOption')).map(inp => inp.value.trim()).filter(v=>v);
}

el('addPollOptionBtn')?.addEventListener('click', () => {
  const container = el('pollOptionsContainer');
  if (!container) return;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'pollOption';
  inp.placeholder = '選択肢';
  container.appendChild(inp);
});

el('createPollBtn')?.addEventListener('click', () => {
  if (!auth.currentUser) return alert('ログインしてください');
  const question = el('pollQuestion')?.value?.trim();
  if (!question) return alert('質問を入力してください');
  const labels = readPollOptionsFromDOM();
  if (labels.length < 2) return alert('選択肢を2つ以上用意してください');
  const options = labels.map(label => ({ id: Math.random().toString(36).slice(2), label, count: 0 }));
  pollsRef.child('active').set({ question, options }).catch(e=>console.error('createPoll failed', e));
});

pollsRef.child('active').on('value', snap => {
  const poll = snap.val();
  const area = el('pollArea');
  if (!area) return;
  area.innerHTML = '';
  if (!poll) return;
  const h = document.createElement('h3'); h.textContent = poll.question || '';
  area.appendChild(h);
  if (!poll.options) return;
  // options may be array or object
  const opts = Array.isArray(poll.options) ? poll.options : Object.values(poll.options);
  opts.forEach(opt => {
    const btn = document.createElement('button');
    btn.textContent = `${opt.label} (${opt.count ?? 0})`;
    btn.addEventListener('click', async () => {
      // atomically increment count: read once, update
      const pRef = pollsRef.child('active/options');
      const snapshot = await pRef.once('value');
      const stored = snapshot.val() || {};
      // normalize stored to array or object: we will treat as object keyed by index or generated key
      if (Array.isArray(stored)) {
        // array -> update matching id
        for (let i=0;i<stored.length;i++){
          if (stored[i].id === opt.id) stored[i].count = (stored[i].count||0) + 1;
        }
        pRef.set(stored).catch(e=>console.error('poll vote failed', e));
      } else {
        // object
        for (const k in stored){
          if (stored[k].id === opt.id){
            stored[k].count = (stored[k].count||0) + 1;
          }
        }
        pRef.set(stored).catch(e=>console.error('poll vote failed', e));
      }
    });
    area.appendChild(btn);
  });
});

/* =========================
   プロフィール画像アップロード（Apps Script経由）
   HTML 要素: profileImageFile (input[type=file]), uploadProfileBtn (button), avatar (img)
   ========================= */
el('uploadProfileBtn')?.addEventListener('click', async () => {
  if (!auth.currentUser) return alert('ログインしてください');
  const fileInput = el('profileImageFile');
  if (!fileInput) return alert('profileImageFile 要素がありません');
  const file = fileInput.files && fileInput.files[0];
  if (!file) return alert('ファイルを選択してください');

  try {
    const form = new FormData();
    form.append('uid', auth.currentUser.uid);
    form.append('file', file, file.name);

    const res = await fetch(GAS_URL, { method: 'POST', body: form });
    if (!res.ok) throw new Error('アップロード失敗: ' + res.statusText);
    const data = await res.json();
    if (data && data.url) {
      await auth.currentUser.updateProfile({ photoURL: data.url });
      el('avatar') && (el('avatar').src = data.url);
      alert('プロフィール画像を更新しました');
    } else {
      console.error('GAS response', data);
      alert('アップロードに失敗しました');
    }
  } catch (e) {
    console.error('uploadProfile error', e);
    alert('アップロード中にエラーが発生しました');
  }
});

/* =========================
   将棋ゲーム機能（フル機能ではなくシンプルな対局フロー）
   - ゲーム作成 / 開始 / サブスクライブ
   - 将棋ボード表示（駒画像）、駒選択・移動（クリックで from→to）
   - 移動可能マスのハイライト（簡易ルール: 歩のみ）
   - ターン表示・勝敗判定（王を取れば勝利）
   NOTE: 本格的なルール（成り・打ち・合法手判定等）は含まれていません
   ========================= */

/* 駒画像対応 */
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
let currentGameIdLocal = null; // ローカルで現在見ているゲームID
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

/* ゲーム作成ボタン（簡易版） */
el('createGameBtn')?.addEventListener('click', async () => {
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
  } catch(e) { console.error('createGame failed', e); alert('ゲーム作成に失敗しました'); }
});

/* ゲーム一覧の自動表示（ロビー・実行中） */
function initGameListSubscribe(){
  // シンプルに全ゲームをlist化
  gamesRef.on('value', snap => {
    const gm = snap.val() || {};
    const listEl = el('gamesList');
    if (!listEl) return;
    listEl.innerHTML = '';
    Object.values(gm).forEach(g => {
      const row = document.createElement('div');
      row.className = 'game-row';
      row.textContent = `${g.type || 'game'} [${g.status || 'lobby'}] - ${g.id}`;
      row.addEventListener('click', ()=> openGameUI(g.id, g));
      listEl.appendChild(row);
    });
  });
}

/* ゲームUI を開く（購読開始） */
function openGameUI(gid, initialObj){
  if (!gid) return;
  try {
    if (currentGameIdLocal) gamesRef.child(currentGameIdLocal).off();
  } catch(e){}
  currentGameIdLocal = gid;
  gameLocalState = initialObj || null;
  const ga = el('gameArea');
  if (ga) ga.style.display = 'block';
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

/* ゲームヘッダー（主催者情報や状態、参加ボタン等） */
function renderGameHeader(game){
  const title = el('gameTitle');
  if (title) title.textContent = game.type === 'shogi' ? '将棋（対戦）' : 'ゲーム';
  const controls = el('gameControls');
  if (!controls) return;
  controls.innerHTML = '';

  const statusBadge = document.createElement('span');
  statusBadge.textContent = game.status || 'lobby';
  statusBadge.style.marginRight = '8px';
  statusBadge.style.fontWeight = '700';
  controls.appendChild(statusBadge);

  const hostInfo = document.createElement('span');
  hostInfo.textContent = game.hostUid ? `主催: ${game.hostUid}` : '主催: なし';
  hostInfo.style.marginRight = '12px';
  hostInfo.style.opacity = '0.85';
  controls.appendChild(hostInfo);

  if (auth?.currentUser) {
    if (game.status === 'lobby') {
      const joinBtn = document.createElement('button');
      joinBtn.textContent = '参加希望';
      joinBtn.onclick = ()=> requestJoinGame(game.id);
      controls.appendChild(joinBtn);
      if (auth.currentUser.uid === game.hostUid) {
        const pickBtn = document.createElement('button');
        pickBtn.textContent = '参加者から選出して開始';
        pickBtn.onclick = ()=> pickAndStartGame(game.id);
        controls.appendChild(pickBtn);
      }
    } else if (game.status === 'running') {
      if (auth.currentUser.uid === game.hostUid) {
        const endBtn = document.createElement('button');
        endBtn.textContent = '強制終了';
        endBtn.onclick = ()=> endGame(game.id, null);
        controls.appendChild(endBtn);
      }
    }
  } else {
    const info = document.createElement('span');
    info.textContent = '参加するにはログインしてください';
    info.style.marginLeft = '8px';
    info.style.color = '#666';
    controls.appendChild(info);
  }
}

/* 参加希望を出す */
async function requestJoinGame(gid){
  if (!auth.currentUser) return alert('ログインしてください');
  const u = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || 'ユーザー', accepted:false, ts: now() };
  await gamesRef.child(gid).child('players').child(u.uid).set(u).catch(e=>console.error('requestJoin failed', e));
  alert('参加希望を出しました。主催者が選出するまでお待ちください。');
}

/* 主催がランダムに参加者を選んでゲーム開始する簡易処理 */
async function pickAndStartGame(gid){
  try {
    const snap = await gamesRef.child(gid).child('players').once('value');
    const players = [];
    snap.forEach(ch => { const v = ch.val(); v?.uid && players.push(v); });
    const candidates = players.filter(p => p.uid !== auth.currentUser.uid);
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

/* 将棋の描画と操作 (完全版ではなくシンプルな実装) */
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

/* ハイライトクリア */
function clearHighlights(){
  document.querySelectorAll('.highlight').forEach(e => e.classList.remove('highlight'));
}

/* 簡易移動計算（ここは拡張すること） */
function calcMoves(piece, r, c, board){
  const moves = [];
  // 歩の単純な前進（成りや敵駒の処理は未実装）
  if (!piece) return moves;
  if (piece.toLowerCase() === 'p') {
    const dir = (piece === 'P') ? -1 : 1; // P: 先手(上向き)
    const nr = r + dir;
    if (nr >= 0 && nr < 9) {
      // 空きマスへ移動
      if (board[nr][c] === '.') moves.push({ r: nr, c });
      // 敵駒を取る（斜めは歩では通常取らないが簡易に敵チェック）
      // 実際の将棋ルールに合わせるなら斜め取りは無いのでここは無視
    }
  }
  // 他の駒のロジックはここに追加してください（g/r/b/n/l/s など）
  return moves;
}

/* 将棋ボード描画 */
function renderShogiBoard(gid, shogiState){
  const container = el('shogiContainer');
  if (!container) return;
  container.innerHTML = '';

  const board = shogiState?.board || initialShogiBoard();
  const grid = document.createElement('div');
  grid.className = 'grid';

  for (let r=0;r<9;r++){
    for (let c=0;c<9;c++){
      const sq = document.createElement('div');
      sq.className = 'grid-cell';
      sq.dataset.r = r;
      sq.dataset.c = c;

      const piece = board[r][c];
      if (piece && piece !== '.') {
        const img = document.createElement('img');
        img.alt = piece;
        const filename = pieceImages[piece] || 'pawn.png';
        img.src = `assets/koma/${filename}`;
        if (piece === piece.toLowerCase()) img.classList.add('koma-gote');

        // 駒クリックで選択、移動候補ハイライト表示
        img.addEventListener('click', (ev) => {
          ev.stopPropagation();
          // 自分のターンでなければ選べない
          if (!auth.currentUser) return alert('ログインしてください');
          const shogi = gameLocalState?.shogi || {};
          if (shogi.turn !== auth.currentUser.uid) {
            // 相手の番なら選択不可
            return;
          }
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

      // マスクリックで移動実行（選択中なら）
      sq.addEventListener('click', () => {
        if (!selectedPiece) return;
        // 移動先 = this r,c
        const from = { r: selectedPiece.r, c: selectedPiece.c };
        const to = { r: parseInt(sq.dataset.r,10), c: parseInt(sq.dataset.c,10) };

        // 簡易に、クリックした移動先が calcMoves に含まれているかチェック
        const boardNow = (gameLocalState && gameLocalState.shogi && gameLocalState.shogi.board) ? gameLocalState.shogi.board : initialShogiBoard();
        const legal = calcMoves(selectedPiece.piece, from.r, from.c, boardNow).some(m => m.r===to.r && m.c===to.c);
        if (!legal) {
          selectedPiece = null;
          clearHighlights();
          return;
        }

        // makeShogiMove を呼ぶ（Firebase transaction 内で更新）
        makeShogiMove(gid, auth.currentUser.uid, from, to);
        selectedPiece = null;
        clearHighlights();
      });

      grid.appendChild(sq);
    }
  }

  container.appendChild(grid);
}

/* 将棋の移動処理（Firebase トランザクションで安全に更新） */
function makeShogiMove(gid, uid, from, to){
  if (!gid || !gamesRef) return;
  const shogiRef = gamesRef.child(gid).child('shogi');
  shogiRef.transaction(current => {
    if (!current) return current;
    const board = current.board || initialShogiBoard();
    const piece = board[from.r][from.c];
    if (!piece || piece === '.') return current;

    // 簡易：ターンチェック（現在の turn が uid でなければ無効）
    if (current.turn && current.turn !== uid) {
      // not your turn
      return current;
    }

    // 簡易：移動の合法性は呼び出し元でも確認済みだが再確認（calcMoves）
    const legalMoves = calcMoves(piece, from.r, from.c, board);
    const isLegal = legalMoves.some(m => m.r === to.r && m.c === to.c);
    if (!isLegal) return current;

    const target = board[to.r][to.c];

    // 勝敗判定: 王を取ったらゲーム終了（ここでは警告と status 更新）
    if (target === 'k' || target === 'K') {
      // winner = uid
      // set status to finished and record winnerUid outside or here
      current.board[to.r][to.c] = piece;
      current.board[from.r][from.c] = '.';
      current.moves = current.moves || [];
      current.moves.push({ by: uid, from, to, ts: now() });
      current.turn = null;
      // 上位の gamesRef にも反映
      gamesRef.child(gid).update({ status: 'finished', finishedAt: now(), winnerUid: uid }).catch(e=>console.error('end game update failed', e));
      // ローカル通知
      if (uid === auth.currentUser?.uid) {
        alert('あなたの勝利');
      } else {
        alert('あなたの負け');
      }
      return current;
    }

    // 通常移動
    current.board[to.r][to.c] = piece;
    current.board[from.r][from.c] = '.';
    current.moves = current.moves || [];
    current.moves.push({ by: uid, from, to, ts: now() });

    // 次のターンを決める（activePlayers の他のIDを探す）
    const active = current.activePlayers ? Object.keys(current.activePlayers) : [];
    const other = active.find(id => id !== uid) || uid;
    current.turn = other;

    return current;
  }, (error, committed, snapshot) => {
    if (error) {
      console.error('transaction error', error);
    }
    // トランザクション後の処理はここで行える
  });
}

/* ゲーム終了（主催の強制終了など） */
async function endGame(gid, winnerUid){
  if (!gid) return;
  try {
    await gamesRef.child(gid).update({ status: 'finished', finishedAt: now(), winnerUid: winnerUid || null });
    // 2秒後にゲームデータ削除（任意）
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
  const ga = el('gameArea'); if (ga) ga.style.display = 'none';
}

/* 自動でロビーのゲームを購読して最初のゲームを開くなど（任意） */
function initGameAutoSubscribe(){
  try {
    gamesRef.orderByChild('status').equalTo('lobby').on('child_added', snap=>{
      const g = snap.val();
      if (!g) return;
      // 自動的に最初のロビーゲームを開かないが UI 上に表示するなど可能
    });
    gamesRef.orderByChild('status').equalTo('running').on('child_added', snap=>{
      const g = snap.val();
      if (!g) return;
    });
    gamesRef.on('child_changed', snap=>{
      const g = snap.val();
      if (!g) return;
      if (currentGameIdLocal === g.id) {
        gameLocalState = g; renderGameState(g); renderGameHeader(g);
      }
    });
    gamesRef.on('child_removed', snap=>{
      const removed = snap.val();
      if (!removed) return;
      if (currentGameIdLocal === removed.id) closeGameUI();
    });
  } catch(e){ console.error('initGameAutoSubscribe error', e); }
}

/* 初期化: ページ読み込み時に購読等開始 */
(function init(){
  initGameListSubscribe();
  initGameAutoSubscribe();
  // poll options container に少なくとも2つ入力欄を準備（もしHTML側で無ければここで作る）
  const poc = el('pollOptionsContainer');
  if (poc && poc.querySelectorAll('.pollOption').length === 0) {
    for (let i=0;i<2;i++){
      const inp = document.createElement('input'); inp.type='text'; inp.className='pollOption'; inp.placeholder = '選択肢';
      poc.appendChild(inp);
    }
  }
})();
