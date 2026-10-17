(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const state = { token: localStorage.getItem("heagun_token"), player: null, authMode: "signin", boardMode: "offline", gameMode: "offline", score: 0, time: 30, combo: 0, target: -1, playing: false, paused: false, timer: null, spawn: null, endsAt: 0, remaining: 0, socket: null, onlineMatch: false, onlineTarget: -1 };
  const toast = (message) => { const el=$("#toast");el.textContent=message;el.classList.remove("hidden");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.add("hidden"),3200); };
  async function api(url, options={}) {
    const headers={ "Content-Type":"application/json", ...(options.headers||{}) };
    if(state.token) headers.Authorization=`Bearer ${state.token}`;
    const response=await fetch(url,{...options,headers});
    const data=await response.json().catch(()=>({error:"Respons server tidak valid."}));
    if(!response.ok) throw new Error(data.error||"Permintaan gagal.");
    return data;
  }
  function setPlayer(player) {
    state.player=player;
    $("#accountName").textContent=player?player.username:"Guest";
    $("#avatar").textContent=player?player.username.slice(0,1).toUpperCase():"G";
    $("#openAuth").textContent=player?"Akun":"Masuk";
    $("#logoutSide").classList.toggle("hidden",!player);
    $("#sidebarStatus").textContent=player?`Login sebagai ${player.username}`:"Siap bermain";
    if(player) connectSocket(); else if(state.socket){state.socket.disconnect();state.socket=null;}
  }
  async function restoreSession(){
    if(!state.token){setPlayer(null);return;}
    try{const d=await api("/api/me");setPlayer(d.player);}
    catch{state.token=null;localStorage.removeItem("heagun_token");setPlayer(null);}
  }
  function openAuth(mode="signin"){
    if(state.player){toast(`Kamu masuk sebagai ${state.player.username}.`);return;}
    setAuthMode(mode);$("#authError").textContent="";$("#authModal").classList.remove("hidden");
  }
  function closeModal(id){$("#"+id).classList.add("hidden");}
  function setAuthMode(mode){
    state.authMode=mode;
    $$(".auth-switch button").forEach(b=>b.classList.toggle("active",b.dataset.authMode===mode));
    $("#authTitle").textContent=mode==="signin"?"Masuk ke akunmu":"Buat akun baru";
    $("#authDesc").textContent=mode==="signin"?"Simpan skor dan ikut tanding online.":"Pilih nama unik untuk mulai bermain.";
    $("#authSubmit").textContent=mode==="signin"?"Masuk":"Buat akun";
    $("#password").autocomplete=mode==="signin"?"current-password":"new-password";
    $("#authError").textContent="";
  }
  $("#authForm").addEventListener("submit",async e=>{
    e.preventDefault();const submit=$("#authSubmit");submit.disabled=true;submit.textContent="Tunggu...";
    $("#authError").textContent="";
    try{
      const data=await api(state.authMode==="signup"?"/api/signup":"/api/signin",{method:"POST",body:JSON.stringify({username:$("#username").value.trim(),password:$("#password").value})});
      state.token=data.token;localStorage.setItem("heagun_token",data.token);setPlayer(data.player);closeModal("authModal");$("#password").value="";
      toast(state.authMode==="signup"?"Akun berhasil dibuat!":"Berhasil masuk. Selamat bermain!");
    }catch(err){$("#authError").textContent=err.message;}
    finally{submit.disabled=false;submit.textContent=state.authMode==="signin"?"Masuk":"Buat akun";}
  });
  $$(".auth-switch button").forEach(b=>b.addEventListener("click",()=>setAuthMode(b.dataset.authMode)));
  $("#togglePassword").addEventListener("click",()=>{$("#password").type=$("#password").type==="password"?"text":"password";});
  $("#openAuth").addEventListener("click",()=>openAuth());
  $("#logoutSide").addEventListener("click",()=>{state.token=null;localStorage.removeItem("heagun_token");setPlayer(null);toast("Kamu sudah keluar.");});
  $$('[data-close]').forEach(b=>b.addEventListener("click",()=>closeModal(b.dataset.close==="auth"?"authModal":"gameModal")));
  $("#closeGame").addEventListener("click",()=>{stopGame();closeModal("gameModal");});
  function goPage(page){
    $$(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${page}`));
    $$("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    if(page==="leaderboard")loadLeaderboard(state.boardMode);
    window.scrollTo({top:0,behavior:"smooth"});
  }
  $$("[data-page]").forEach(b=>b.addEventListener("click",e=>{e.preventDefault();goPage(b.dataset.page);}));
  async function loadLeaderboard(mode){
    state.boardMode=mode;
    $$(".tab").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));
    $("#leaderTitle").textContent=mode==="offline"?"Skor Offline":"Skor Online 1v1";
    const list=$("#leaderList");list.innerHTML='<div class="empty-state">Memuat leaderboard...</div>';
    try{
      const d=await api(`/api/leaderboard/${mode}`);
      if(!d.entries.length){list.innerHTML='<div class="empty-state">Belum ada skor. Jadilah pemain pertama!</div>';return;}
      list.innerHTML=d.entries.map((entry,i)=>`<div class="leader-row"><div class="rank ${i===0?'gold':i===1?'silver':i===2?'bronze':''}">${i+1}</div><div class="player-info"><div class="player-avatar">${escapeHtml(entry.username.slice(0,1).toUpperCase())}</div><div><div class="player-name">${escapeHtml(entry.username)}</div><div class="player-sub">${i===0?'Peringkat teratas':'Pemain Heagun'}</div></div></div><div class="player-score">${Number(entry.score).toLocaleString('id-ID')} <span style="font-size:10px;color:#8294b2">PTS</span></div></div>`).join("");
      if(state.player){const mine=d.entries.find(x=>x.username===state.player.username);if(mine&&mode==="offline")$("#heroHighScore").textContent=Number(mine.score).toLocaleString("id-ID");}
    }catch(err){list.innerHTML=`<div class="empty-state">${escapeHtml(err.message)}<br><br>Pastikan server dan database sudah aktif.</div>`;}
  }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  $$(".tab").forEach(b=>b.addEventListener("click",()=>loadLeaderboard(b.dataset.mode)));
  $("#refreshBoard").addEventListener("click",()=>loadLeaderboard(state.boardMode));

  const gameBoard=$("#gameBoard");
  for(let i=0;i<9;i++){
    const hole=document.createElement("button");hole.type="button";hole.className="game-hole empty";hole.setAttribute("aria-label",`Lubang ${i+1}`);
    hole.innerHTML='<div class="mini-target"><div class="mini-face" aria-hidden="true">♟</div><div class="mini-name">PRABOWO</div></div>';
    hole.addEventListener("pointerdown",e=>{
      e.preventDefault();if(!state.playing||state.paused)return;
      if(state.gameMode==="online"){
        if(i===state.onlineTarget&&state.socket){state.socket.emit("match:hit",{hole:i});state.onlineTarget=-1;}
        return;
      }
      if(i===state.target){state.score+=10;state.combo++;$("#gameScore").textContent=state.score;$("#gameCombo").textContent="x"+state.combo;$("#gameMessage").textContent=state.combo>2?"Combo bagus! +10":"Tepat! +10 poin";hideLocalTarget();scheduleTarget(180);}
      else{state.combo=0;$("#gameCombo").textContent="x0";$("#gameMessage").textContent="Lubangnya kosong. Coba lagi!";}
    },{passive:false});
    gameBoard.appendChild(hole);
  }
  const holes=$$(".game-hole");
  function hideLocalTarget(){if(state.target>=0)holes[state.target].classList.add("empty");state.target=-1;}
  function spawnTarget(){
    if(!state.playing||state.paused||state.gameMode!=="offline")return;
    hideLocalTarget();let next=Math.floor(Math.random()*9);if(next===state.lastTarget)next=(next+1+Math.floor(Math.random()*8))%9;
    state.lastTarget=next;state.target=next;holes[next].classList.remove("empty");
    scheduleTarget(Math.max(420,900-Math.floor(state.score/40)*35));
  }
  function scheduleTarget(ms){clearTimeout(state.spawn);if(state.playing&&!state.paused&&state.gameMode==="offline")state.spawn=setTimeout(spawnTarget,ms);}
  function resetBoard(){holes.forEach(h=>h.classList.add("empty"));state.target=-1;state.onlineTarget=-1;}
  function startLocalGame(){
    state.gameMode="offline";state.onlineMatch=false;state.score=0;state.time=30;state.combo=0;state.lastTarget=-1;state.playing=true;state.paused=false;state.remaining=30000;
    $("#gameModeLabel").textContent="MODE OFFLINE";$("#gameTitle").textContent="Pukul-Prabowo";$("#gameScore").textContent="0";$("#gameTime").textContent="30";$("#gameCombo").textContent="x0";$("#gameMessage").textContent="Ketuk karakter secepatnya!";$("#gameStart").textContent="Ulangi";$("#gamePause").disabled=false;$("#gamePause").textContent="Jeda";
    resetBoard();state.endsAt=Date.now()+30000;scheduleTarget(250);tickLocal(); 
  }
  function tickLocal(){
    clearTimeout(state.timer);if(!state.playing||state.paused)return;
    state.time=Math.max(0,Math.ceil((state.endsAt-Date.now())/1000));$("#gameTime").textContent=state.time;
    if(state.time<=0){finishLocalGame();return;}
    state.timer=setTimeout(tickLocal,100);
  }
  async function finishLocalGame(){
    state.playing=false;state.paused=false;clearTimeout(state.timer);clearTimeout(state.spawn);hideLocalTarget();$("#gamePause").disabled=true;$("#gameMessage").textContent=`Waktu habis! Skor akhir ${state.score}.`;
    $("#gameStart").textContent="Main lagi";
    if(state.player){try{await api("/api/results",{method:"POST",body:JSON.stringify({mode:"offline",score:state.score,duration:30})});toast("Skor offline tersimpan!");}catch(e){toast("Skor belum tersimpan: "+e.message);}}
    else toast("Login untuk menyimpan skor ke leaderboard.");
  }
  function stopGame(){state.playing=false;state.paused=false;clearTimeout(state.timer);clearTimeout(state.spawn);if(state.socket&&state.gameMode==="online")state.socket.emit("queue:leave");resetBoard();$("#gamePause").disabled=true;}
  function togglePause(){
    if(!state.playing)return;
    if(state.gameMode==="online"){toast("Pertandingan online tidak bisa dijeda.");return;}
    if(!state.paused){state.paused=true;state.remaining=Math.max(0,state.endsAt-Date.now());clearTimeout(state.timer);clearTimeout(state.spawn);$("#gamePause").textContent="Lanjut";$("#gameMessage").textContent="Game dijeda.";}
    else{state.paused=false;state.endsAt=Date.now()+state.remaining;$("#gamePause").textContent="Jeda";$("#gameMessage").textContent="Lanjut!";scheduleTarget(200);tickLocal();}
  }
  function openGame(mode){$("#gameModal").classList.remove("hidden");if(mode==="online"){startOnlineQueue();}else startLocalGame();}
  $("#playOffline").addEventListener("click",()=>openGame("offline"));$("#cardOffline").addEventListener("click",()=>openGame("offline"));$("#featureOffline").addEventListener("click",()=>openGame("offline"));
  $("#playOnline").addEventListener("click",()=>openGame("online"));$("#cardOnline").addEventListener("click",()=>openGame("online"));$("#featureOnline").addEventListener("click",()=>openGame("online"));
  $("#gameStart").addEventListener("click",()=>{if(state.gameMode==="online"){if(!state.playing)startOnlineQueue();return;}startLocalGame();});
  $("#gamePause").addEventListener("click",togglePause);

  function connectSocket(){
    if(state.socket||typeof io!=="function")return;
    state.socket=io();state.socket.on("connect",()=>state.socket.emit("auth",state.token));
    state.socket.on("auth:error",d=>toast(d.error));
    state.socket.on("queue:waiting",()=>{$("#gameMessage").textContent="Mencari lawan online… tunggu pemain lain.";});
    state.socket.on("queue:error",d=>{toast(d.error);$("#gameMessage").textContent=d.error;});
    state.socket.on("match:found",d=>{
      state.gameMode="online";state.onlineMatch=true;state.playing=true;state.paused=false;state.score=0;state.combo=0;state.time=60;state.onlineTarget=-1;
      $("#gameModeLabel").textContent="ONLINE 1V1";$("#gameTitle").textContent="Lawan: "+d.opponent;$("#gameScore").textContent="0";$("#gameTime").textContent="60";$("#gameCombo").textContent="x0";$("#gameMessage").textContent="Pertandingan dimulai! Ketuk target!";$("#gameStart").textContent="Sedang tanding";$("#gameStart").disabled=true;$("#gamePause").disabled=true;resetBoard();
    });
    state.socket.on("match:tick",d=>{
      if(!state.onlineMatch)return;state.time=d.remaining;state.score=d.score;$("#gameTime").textContent=d.remaining;$("#gameScore").textContent=d.score;$("#gameMessage").textContent=`Kamu ${d.score} — Lawan ${d.opponentScore}`;
      holes.forEach((h,i)=>h.classList.toggle("empty",i!==d.target));state.onlineTarget=d.target;
    });
    state.socket.on("match:state",d=>{if(!state.onlineMatch)return;state.score=d.score;$("#gameScore").textContent=d.score;$("#gameMessage").textContent=`Kamu ${d.score} — Lawan ${d.opponentScore}`;});
    state.socket.on("match:over",d=>{
      state.playing=false;state.onlineMatch=false;state.gameMode="online";state.onlineTarget=-1;resetBoard();$("#gameStart").disabled=false;$("#gameStart").textContent="Cari lawan lagi";$("#gamePause").disabled=true;
      $("#gameMessage").textContent=d.draw?"Seri! Skor kamu "+d.score+".":(d.winner===d.username?"Kamu menang! Skor "+d.score+" 🎉":"Kamu kalah kali ini. Skor "+d.score+".");
      toast("Pertandingan selesai. Hasil online disimpan.");loadLeaderboard("online");
    });
    state.socket.on("disconnect",()=>{if(state.onlineMatch){state.onlineMatch=false;state.playing=false;$("#gameMessage").textContent="Koneksi terputus. Tutup game lalu coba lagi.";$("#gameStart").disabled=false;}});
  }
  function startOnlineQueue(){
    if(!state.player){closeModal("gameModal");openAuth("signin");toast("Login dulu untuk tanding online.");return;}
    if(typeof io!=="function"){toast("Socket tidak tersedia. Pastikan server Node.js aktif.");return;}
    connectSocket();state.gameMode="online";state.playing=false;state.onlineMatch=false;state.onlineTarget=-1;resetBoard();
    $("#gameModeLabel").textContent="MENCARI LAWAN";$("#gameTitle").textContent="Tanding Online";$("#gameScore").textContent="0";$("#gameTime").textContent="60";$("#gameCombo").textContent="—";$("#gameMessage").textContent="Menghubungkan ke server…";$("#gameStart").textContent="Mencari lawan…";$("#gameStart").disabled=true;$("#gamePause").disabled=true;
    const wait=()=>{if(state.socket&&state.socket.connected)state.socket.emit("queue:join");else setTimeout(()=>{if(state.gameMode==="online"&&!state.onlineMatch){if(state.socket&&state.socket.connected)state.socket.emit("queue:join");else{$("#gameMessage").textContent="Belum tersambung ke server. Coba lagi.";$("#gameStart").disabled=false;$("#gameStart").textContent="Coba lagi";}}},1200);};
    wait();
  }
  restoreSession();
})();