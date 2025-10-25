/* script.js - マイページをボタンで開くポップアップ表示に変更した完全版
   必須: firebaseConfig と GAS_URL を実環境の値に置き換えてください
*/

/* ===== 設定（ここを実環境に置き換える） ===== */
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

/* ===== Firebase 初期化 ===== */
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();
const commentsRef = db.ref('comments');
const pollRef = db.ref('activePoll');
const gamesRef = db.ref('games');
const presenceRef = db.ref('presence');

/* ===== ユーティリティ ===== */
function el(id){ return document.getElementById(id) || null; }
function now(){ return Date.now(); }
function escapeHtml(s){ if (s == null) return ''; return String(s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
function show(node){ if(!node) return; node.style.display = 'block'; node.setAttribute('aria-hidden','false'); }
function hide(node){ if(!node) return; node.style.display = 'none'; node.setAttribute('aria-hidden','true'); }
function safeAdd(id, ev, fn){ const e = el(id); if (e) e.addEventListener(ev, fn); }

/* ===== 初期化 ===== */
document.addEventListener('DOMContentLoaded', () => {
  initUiControls();
  initAuth();
  initPresence();
  initComments();
  initPollEditor();
  initPollListener();
  initMyPageModal();
  initProfileUpload();
  initGameSelect();
  initGameListSubscribe();
});

/* ===== UI: モーダル開閉とボタンバインド ===== */
function initUiControls(){
  safeAdd('openLoginBtn','click', ()=> show(el('loginModal')));
  safeAdd('closeLoginBtn','click', ()=> hide(el('loginModal')));
  safeAdd('openPollEditorBtn','click', ()=> show(el('pollEditorModal')));
  safeAdd('closePollEditorBtn','click', ()=> hide(el('pollEditorModal')));
  // マイページをボタンで開く（ユーザー操作）
  safeAdd('openMyPageBtn','click', ()=> {
    // 最新のユーザ情報を反映してから表示
    const user = auth.currentUser;
    if (user) {
      if (el('myAvatarLarge')) el('myAvatarLarge').src = user.photoURL || '';
      if (el('myName')) el('myName').textContent = user.displayName || user.email || '';
      // 過去のbioがDBにあれば取得して埋める
      db.ref('users').child(user.uid).child('profile').once('value').then(snap=>{
        const p = snap.val();
        if (p && el('myBio')) el('myBio').value = p.bio || '';
        show(el('myPageModal'));
      }).catch(()=> show(el('myPageModal')));
    } else {
      // ログインしていなければモーダルを開いてログインを促す
      alert('マイページを開くにはログインしてください');
      show(el('loginModal'));
    }
  });
  safeAdd('closeMyPageBtn','click', ()=> hide(el('myPageModal')));

  safeAdd('openGameSelectBtn','click', ()=> show(el('gameSelectModal')));
  safeAdd('closeGameSelectBtn','click', ()=> hide(el('gameSelectModal')));

  // backdrop クリックで閉じる (各モーダル)
  ['loginModal','pollEditorModal','myPageModal','gameSelectModal'].forEach(id=>{
    const m = el(id);
    if (m) m.addEventListener('click', e => { if (e.target === m) hide(m); });
  });

  // ESC で各モーダルを閉じる
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['loginModal','pollEditorModal','myPageModal','gameSelectModal'].forEach(id => hide(el(id)));
    }
  });
}

/* ===== Auth ===== */
function initAuth(){
  safeAdd('loginBtn','click', async () => {
    const email = el('emailInput')?.value || '';
    const password = el('passwordInput')?.value || '';
    if (!email || !password) return alert('メールとパスワードを入力してください');
    try {
      await auth.signInWithEmailAndPassword(email, password);
      hide(el('loginModal'));
    } catch (e) {
      console.error('login error', e);
      alert('ログインに失敗しました: ' + (e.message || e));
    }
  });

  safeAdd('logoutBtn','click', () => auth.signOut().catch(e=>console.error(e)));

  auth.onAuthStateChanged(user => {
    if (user) {
      if (el('loginArea')) el('loginArea').style.display = 'none';
      if (el('userArea')) el('userArea').style.display = 'flex';
      if (el('username')) el('username').textContent = user.displayName || user.email || user.uid;
      if (el('avatar')) el('avatar').src = user.photoURL || '';
      if (el('myAvatarLarge')) el('myAvatarLarge').src = user.photoURL || '';
      if (el('myName')) el('myName').textContent = user.displayName || user.email || '';
    } else {
      if (el('loginArea')) el('loginArea').style.display = 'flex';
      if (el('userArea')) el('userArea').style.display = 'none';
      if (el('username')) el('username').textContent = '';
      if (el('avatar')) el('avatar').src = '';
    }
  });
}

/* ===== Presence: 同時接続と来訪通知 ===== */
let myPresenceKey = null;
function initPresence(){
  const con = db.ref('.info/connected');
  con.on('value', snap => {
    if (snap.val() === true) {
      const p = presenceRef.push();
      myPresenceKey = p.key;
      const user = auth.currentUser;
      p.set({ ts: now(), uid: user ? user.uid : null, name: user ? (user.displayName || user.email) : null, ua: navigator.userAgent });
      p.onDisconnect().remove();
    }
  });

  presenceRef.on('value', snap => {
    const count = snap.numChildren();
    if (el('connCount')) el('connCount').textContent = '接続: ' + count;
  });

  let initial = true;
  setTimeout(()=> initial = false, 1000);
  presenceRef.on('child_added', snap => {
    if (initial) return;
    const v = snap.val();
    if (!v) return;
    const notice = el('visitNotice');
    if (!notice) return;
    const name = v.name || '誰か';
    notice.textContent = `${name} が配信を視聴しに来ました`;
    notice.style.background = '#c62828';
    show(notice);
    setTimeout(()=> hide(notice), 4000);
  });
}

/* ===== Comments ===== */
function initComments(){
  const sendBtn = el('sendCommentBtn');
  const input = el('commentInput');
  const list = el('commentList');
  if (!sendBtn || !input || !list) { console.warn('コメント要素不足'); return; }

  sendBtn.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) return alert('コメントを入力してください');
    const user = auth.currentUser;
    if (!user) return alert('ログインしてください');
    sendBtn.disabled = true;
    try {
      await commentsRef.push({ uid: user.uid, name: user.displayName || user.email || 'ユーザー', text, ts: now() });
      input.value = '';
    } catch (e) {
      console.error('comment push failed', e);
      alert('コメント送信に失敗しました');
    } finally {
      sendBtn.disabled = false;
    }
  });

  commentsRef.limitToLast(500).off('child_added');
  commentsRef.limitToLast(500).on('child_added', snap => {
    const d = snap.val();
    if (!d) return;
    const row = document.createElement('div'); row.className = 'comment';
    const time = d.ts ? new Date(d.ts).toLocaleString() : '';
    row.innerHTML = `<div class="comment-head"><strong>${escapeHtml(d.name)}</strong><span class="comment-time">${escapeHtml(time)}</span></div><div class="comment-body">${escapeHtml(d.text)}</div>`;
    const first = list.firstChild;
    if (first) list.insertBefore(row, first); else list.appendChild(row);
  });
}

/* ===== Poll: 作成用モーダルと配信リスナー ===== */
let pollLocalTimer = null;
function initPollEditor(){
  const optionsContainer = el('pollOptionsContainer');
  const addBtn = el('addPollOptionBtn');
  const createBtn = el('createPollBtn');
  const closeBtn = el('closePollEditorBtn');
  if (!optionsContainer) return;

  function ensureTwo(){ if (optionsContainer.querySelectorAll('.pollOption').length < 2) { for (let i=0;i<2;i++){ const inp = document.createElement('input'); inp.className='pollOption input'; inp.placeholder='選択肢'; optionsContainer.appendChild(inp); } } }
  ensureTwo();

  addBtn && addBtn.addEventListener('click', ()=> { const inp = document.createElement('input'); inp.className='pollOption input'; inp.placeholder='選択肢'; optionsContainer.appendChild(inp); inp.focus(); });

  createBtn && createBtn.addEventListener('click', async () => {
    if (!auth.currentUser) return alert('ログインしてください');
    const q = el('pollQuestion')?.value?.trim();
    if (!q) return alert('質問を入力してください');
    const labels = Array.from(optionsContainer.querySelectorAll('.pollOption')).map(i=>i.value.trim()).filter(v=>v);
    if (labels.length < 2) return alert('選択肢を2つ以上用意してください');
    const options = labels.map(label => ({ id: Math.random().toString(36).slice(2), label, count: 0 }));
    const startAt = now();
    const endAt = startAt + 30_000;
    const pollObj = { question: q, options, active: true, startAt, endAt, createdBy: auth.currentUser.uid };
    try {
      await pollRef.set(pollObj);
      el('pollQuestion').value = '';
      optionsContainer.innerHTML = '';
      ensureTwo();
      hide(el('pollEditorModal'));
    } catch (e) {
      console.error('create poll failed', e);
      alert('アンケート作成に失敗しました');
    }
  });

  closeBtn && closeBtn.addEventListener('click', ()=> hide(el('pollEditorModal')));
}

function initPollListener(){
  const popup = el('pollPopup');
  const popupQuestion = el('pollPopupQuestion');
  const popupOptions = el('pollPopupOptions');
  const popupTimer = el('pollTimer');
  const popupResult = el('pollResult');
  const commentPanel = el('commentPanel');

  if (pollLocalTimer) { clearInterval(pollLocalTimer); pollLocalTimer = null; }

  pollRef.off('value');
  pollRef.on('value', snap => {
    const poll = snap.val();
    if (!poll || !poll.active) {
      hide(popup);
      popupTimer.textContent = '';
      popupOptions.innerHTML = '';
      popupResult.innerHTML = ''; popupResult.style.display = 'none';
      if (commentPanel) commentPanel.classList.remove('slid');
      return;
    }

    if (commentPanel) commentPanel.classList.add('slid');

    popupOptions.innerHTML = '';
    popupResult.innerHTML = '';
    popupQuestion.textContent = poll.question || 'アンケート';
    const nowMs = now();
    const endAt = poll.endAt || (poll.startAt + 30_000);
    const remaining = Math.max(0, endAt - nowMs);
    const opts = Array.isArray(poll.options) ? poll.options : (poll.options ? Object.values(poll.options) : []);

    opts.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'poll-option';
      btn.textContent = opt.label + ' (' + (opt.count || 0) + ')';
      btn.disabled = (remaining <= 0);
      btn.addEventListener('click', async () => {
        try {
          await pollRef.child('options').transaction(current => {
            if (!current) return current;
            if (Array.isArray(current)) {
              for (let i=0;i<current.length;i++) {
                if (current[i].id === opt.id) { current[i].count = (current[i].count||0) + 1; break; }
              }
              return current;
            } else {
              for (const k in current) {
                if (current[k].id === opt.id) { current[k].count = (current[k].count||0) + 1; break; }
              }
              return current;
            }
          });
        } catch (e) { console.error('vote transaction failed', e); }
      });
      popupOptions.appendChild(btn);
    });

    show(popup);
    popupResult.style.display = 'none';

    if (pollLocalTimer) { clearInterval(pollLocalTimer); pollLocalTimer = null; }
    pollLocalTimer = setInterval(() => {
      const now2 = now();
      const rem = Math.max(0, endAt - now2);
      popupTimer.textContent = '残り ' + Math.ceil(rem/1000) + ' 秒';
      if (rem <= 0) {
        clearInterval(pollLocalTimer); pollLocalTimer = null;
        pollRef.once('value').then(s => {
          const final = s.val();
          if (!final) return;
          const finalOpts = Array.isArray(final.options) ? final.options : (final.options ? Object.values(final.options) : []);
          const total = finalOpts.reduce((acc,o)=>acc + (o.count||0), 0);
          popupOptions.innerHTML = '';
          popupTimer.textContent = '集計中...';
          popupResult.style.display = 'block';
          popupResult.innerHTML = '';
          const resultsWrap = document.createElement('div'); resultsWrap.className = 'poll-results';
          finalOpts.forEach(o => {
            const row = document.createElement('div');
            const label = document.createElement('div'); label.textContent = `${o.label} — ${o.count || 0}票`;
            const percent = total === 0 ? 0 : Math.round((o.count||0) / total * 100);
            const barWrap = document.createElement('div'); barWrap.className = 'result-bar';
            const fill = document.createElement('div'); fill.className = 'result-fill';
            fill.style.width = percent + '%';
            barWrap.appendChild(fill);
            const pct = document.createElement('div'); pct.textContent = percent + '%'; pct.style.marginTop = '4px';
            row.appendChild(label); row.appendChild(barWrap); row.appendChild(pct);
            resultsWrap.appendChild(row);
          });
          popupResult.appendChild(resultsWrap);
          popupTimer.textContent = '終了';
          setTimeout(async () => {
            try { await pollRef.update({ active: false }); } catch (e) { console.error('disable poll failed', e); }
            hide(popup);
            popupOptions.innerHTML = '';
            popupResult.innerHTML = '';
            popupTimer.textContent = '';
            if (commentPanel) commentPanel.classList.remove('slid');
          }, 20_000);
        }).catch(e=>console.error('read final poll failed', e));
      } else {
        // update counts in buttons periodically
        pollRef.once('value').then(s => {
          const up = s.val();
          if (!up || !up.options) return;
          const uopts = Array.isArray(up.options) ? up.options : Object.values(up.options);
          const buttons = popupOptions.querySelectorAll('button.poll-option');
          for (let i=0;i<buttons.length;i++){
            const b = buttons[i];
            const o = uopts[i];
            if (o) b.textContent = o.label + ' (' + (o.count||0) + ')';
          }
        }).catch(()=>{});
      }
    }, 700);
  });
}

/* ===== MyPage モーダル (ボタンで開く) ===== */
function initMyPageModal(){
  // 保存ボタン動作
  safeAdd('saveMyPageBtn','click', async () => {
    if (!auth.currentUser) return alert('ログインしてください');
    const bio = el('myBio')?.value || '';
    try {
      await db.ref('users').child(auth.currentUser.uid).child('profile').update({ bio, updatedAt: now() });
      alert('保存しました');
      hide(el('myPageModal'));
    } catch (e) {
      console.error('save profile failed', e);
      alert('保存に失敗しました');
    }
  });
  // モーダルは initUiControls で open/close のボタンがバインドされています
}

/* ===== Profile Upload (GAS) ===== */
function initProfileUpload(){
  const uploadBtn = el('uploadProfileBtn');
  const fileInput = el('profileImageFile');
  if (!uploadBtn || !fileInput) return;
  uploadBtn.addEventListener('click', async () => {
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
        if (el('myAvatarLarge')) el('myAvatarLarge').src = data.url;
        alert('プロフィール画像を更新しました');
      } else {
        console.error('GAS returned invalid', data);
        alert('アップロードに失敗しました');
      }
    } catch (e) {
      console.error('uploadProfile error', e);
      alert('アップロード中にエラーが発生しました');
    }
  });
}

/* ===== Games (将棋作成ポップアップ) ===== */
const pieceImages = { 'p':'pawn.png','P':'pawn.png','l':'lance.png','L':'lance.png','n':'knight.png','N':'knight.png','s':'silver.png','S':'silver.png','g':'gold.png','G':'gold.png','k':'king.png','K':'king.png','r':'rook.png','R':'rook.png','b':'bishop.png','B':'bishop.png' };
let selectedPiece = null;
let currentGameIdLocal = null;
let gameLocalState = null;

function initGameSelect(){
  safeAdd('createShogiBtn','click', async () => {
    if (!auth.currentUser) return alert('ログインしてください');
    try {
      const gid = gamesRef.push().key;
      const gameObj = {
        id: gid,
        type: 'shogi',
        hostUid: auth.currentUser.uid,
        status: 'lobby',
        createdAt: now(),
        players: { [auth.currentUser.uid]: { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email, accepted: true, role: 'host', ts: now() } },
        shogi: { board: initialShogiBoard(), turn: auth.currentUser.uid, moves: [] },
        activePlayers: { [auth.currentUser.uid]: true }
      };
      await gamesRef.child(gid).set(gameObj);
      hide(el('gameSelectModal'));
      openGameUI(gid, gameObj);
      if (el('commentPanel')) el('commentPanel').classList.add('slid');
    } catch (e) {
      console.error('create shogi failed', e);
      alert('ゲーム作成に失敗しました');
    }
  });
}

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

function initGameListSubscribe(){
  const listEl = el('gamesList');
  if (!listEl) return;
  gamesRef.off('value');
  gamesRef.on('value', snap => {
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
    } catch (e) { console.error('render games list failed', e); }
  });

  gamesRef.on('child_changed', snap => {
    const g = snap.val();
    if (!g) return;
    if (g.status === 'finished' && el('commentPanel')) {
      setTimeout(()=> el('commentPanel').classList.remove('slid'), 500);
    }
  });
}

function openGameUI(gid, initialObj){
  if (!gid) return;
  try { if (currentGameIdLocal) gamesRef.child(currentGameIdLocal).off('value'); } catch(e){}
  currentGameIdLocal = gid;
  gameLocalState = initialObj || null;
  const ga = el('gameArea'); if (ga) ga.style.display = 'block';
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

  if (auth.currentUser) {
    if (game.status === 'lobby') {
      const joinBtn = document.createElement('button'); joinBtn.textContent = '参加希望'; joinBtn.onclick = ()=> requestJoinGame(game.id); controls.appendChild(joinBtn);
      if (auth.currentUser.uid === game.hostUid) {
        const pickBtn = document.createElement('button'); pickBtn.textContent = '選出して開始'; pickBtn.onclick = ()=> pickAndStartGame(game.id); controls.appendChild(pickBtn);
      }
    } else if (game.status === 'running') {
      if (auth.currentUser.uid === game.hostUid) {
        const endBtn = document.createElement('button'); endBtn.textContent = '終了'; endBtn.onclick = ()=> endGame(game.id); controls.appendChild(endBtn);
      }
    }
  } else {
    const info = document.createElement('span'); info.textContent = '参加にはログイン'; info.style.color='#666'; controls.appendChild(info);
  }
}

async function requestJoinGame(gid){
  if (!auth.currentUser) return alert('ログインしてください');
  const u = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || 'ユーザー', accepted:false, ts: now() };
  try { await gamesRef.child(gid).child('players').child(u.uid).set(u); alert('参加希望を送信しました'); } catch(e){ console.error(e); alert('参加申請に失敗'); }
}

async function pickAndStartGame(gid){
  try {
    const snap = await gamesRef.child(gid).child('players').once('value');
    const players = []; snap.forEach(ch => { const v = ch.val(); v?.uid && players.push(v); });
    const candidates = players.filter(p => p.uid !== auth.currentUser.uid);
    if (candidates.length === 0) return alert('参加希望者がいません');
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const updates = {};
    updates[`players/${auth.currentUser.uid}`] = { uid: auth.currentUser.uid, name: auth.currentUser.displayName || auth.currentUser.email || '主催者', accepted:true, role:'host', ts: now() };
    updates[`players/${pick.uid}`] = { uid: pick.uid, name: pick.name, accepted:true, role:'player', ts: now() };
    updates['status'] = 'running';
    updates['startedAt'] = now();
    updates['activePlayers'] = { [auth.currentUser.uid]: true, [pick.uid]: true };
    await gamesRef.child(gid).update(updates);
    await gamesRef.child(gid).child('shogi').set({ board: initialShogiBoard(), turn: auth.currentUser.uid, moves: [] });
    if (el('commentPanel')) el('commentPanel').classList.add('slid');
  } catch (e) { console.error('pickAndStartGame error', e); alert('開始処理でエラー'); }
}

function renderGameState(game){
  if (!game) return;
  if (game.type === 'shogi') {
    const shogi = game.shogi || {};
    renderShogiBoard(game.id, shogi);
    const info = el('gameInfo');
    if (info) info.textContent = (shogi.turn === auth.currentUser?.uid) ? 'あなたの番です' : '相手の番です';
  }
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
      const sq = document.createElement('div'); sq.className = 'grid-cell'; sq.dataset.r = r; sq.dataset.c = c;
      const piece = board[r][c];
      if (piece && piece !== '.') {
        const img = document.createElement('img');
        img.alt = piece;
        img.src = `assets/koma/${pieceImages[piece] || 'pawn.png'}`;
        if (piece === piece.toLowerCase()) img.classList.add('koma-gote');
        img.addEventListener('click', ev => {
          ev.stopPropagation();
          if (!auth.currentUser) return alert('ログインしてください');
          const shogi = gameLocalState?.shogi || {};
          if (shogi.turn !== auth.currentUser.uid) return;
          clearHighlights();
          selectedPiece = { r, c, piece };
          const moves = calcMoves(piece, r, c, board);
          moves.forEach(m => {
            const t = grid.querySelector(`.grid-cell[data-r="${m.r}"][data-c="${m.c}"]`);
            if (t) t.classList.add('highlight');
          });
        });
        sq.appendChild(img);
      }
      sq.addEventListener('click', () => {
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
function clearHighlights(){ document.querySelectorAll('.highlight').forEach(e => e.classList.remove('highlight')); }
function calcMoves(piece, r, c, board){
  const moves = [];
  if (!piece) return moves;
  if (piece.toLowerCase() === 'p') {
    const dir = (piece === 'P') ? -1 : 1;
    const nr = r + dir;
    if (nr >=0 && nr <9 && board[nr][c] === '.') moves.push({ r: nr, c });
  }
  return moves;
}
function makeShogiMove(gid, uid, from, to){
  if (!gid) return;
  const shogiRef = gamesRef.child(gid).child('shogi');
  shogiRef.transaction(current => {
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
      gamesRef.child(gid).update({ status:'finished', finishedAt: now(), winnerUid: uid }).catch(e=>console.error('end update failed', e));
      setTimeout(()=> { if (el('commentPanel')) el('commentPanel').classList.remove('slid'); }, 2000);
      return current;
    }
    board[to.r][to.c] = piece; board[from.r][from.c] = '.';
    current.board = board; current.moves = current.moves || []; current.moves.push({ by: uid, from, to, ts: now() });
    const active = current.activePlayers ? Object.keys(current.activePlayers) : [];
    const other = active.find(id => id !== uid) || uid;
    current.turn = other;
    return current;
  }, (err)=> { if (err) console.error('makeShogiMove transaction error', err); });
}
async function endGame(gid){
  if (!gid) return;
  try {
    await gamesRef.child(gid).update({ status: 'finished', finishedAt: now() });
    setTimeout(()=> { gamesRef.child(gid).remove().catch(()=>{}); if (el('commentPanel')) el('commentPanel').classList.remove('slid'); }, 2000);
  } catch (e) { console.error('endGame failed', e); }
}

/* ===== 完了 ===== */
