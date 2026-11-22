/* 눈담 리모컨: 스위치봇 허브에 등록한 리모컨 하나를 조작합니다.
   스위치봇 API 는 웹 페이지에서 바로 부를 수 없어, 보호자가 만든 중계(worker/switchbot-relay.js)를 거칩니다.
   중계 주소와 암호, 고른 기기는 이 기기(localStorage)에만 저장합니다. 토큰과 비밀 키는 눈담이 알지 못합니다.
   자판(index.html)과는 window.Nundam 과 window.NundamRemote 로만 만납니다. */
(function(){
  "use strict";
  var N=window.Nundam;
  if(!N)return;
  var KEY="nundam-remote",VER=4;
  /* 3*3 모드의 리모컨 화면. 자리는 정해져 있습니다.
       1 채널 및 볼륨 묶음   2 위     3 OTT 묶음
       4 왼쪽                5 선택   6 오른쪽
       7 나가기              8 아래   9 이전
     7 나가기는 눈담의 처음 화면으로 돌아가고(자판이 놓습니다), 9 이전은 리모컨의 뒤로 버튼입니다.
     묶음 안의 자리도 정해져 있습니다. 가운데 5 는 나가기(리모컨 첫 화면으로)이고 자판이 놓습니다.
       채널 및 볼륨: 1 볼륨 위로    2 2개씩(켜고 끄기)  3 채널 위로
                     4 음소거       5 나가기            6 편성표
                     7 볼륨 아래로                      9 채널 아래로
       OTT:          1 넷플릭스   2 디즈니 플러스
     twice 는 "2개씩" 칸의 자리입니다. 켜 두면 볼륨과 채널 위아래(slots 의 셋째 값이 있는 칸)를 확인할 때마다 두 번 보냅니다.
     음소거와 편성표는 두 번 보내면 도로 꺼지므로 늘 한 번만 보냅니다.
     leave 가 있는 묶음은 칸을 확인하면 바로 리모컨 첫 화면으로 돌아갑니다(OTT 를 켠 뒤 방향으로 고르도록).
     그 밖의 화면은 나가기를 확인해야만 한 단계 위로 나갑니다.
     칸 번호: 방향, 선택, 이전(PAD 순서), 그 뒤로 묶음의 칸들(GROUPS 와 slots 순서), 끝에 EXTRA */
  var PAD=[[2,"위"],[4,"왼쪽"],[5,"선택"],[6,"오른쪽"],[8,"아래"],[9,"이전"]];
  var GROUPS=[{id:"chvol",z:1,name:"채널 및 볼륨 설정",twice:2,slots:[[1,"볼륨 위로",1],[3,"채널 위로",1],[4,"음소거"],[6,"편성표"],[7,"볼륨 아래로",1],[9,"채널 아래로",1]]},
    {id:"ott",z:3,name:"OTT 설정",leave:true,slots:[[1,"넷플릭스"],[2,"디즈니 플러스"]]}];
  /* 3*3 화면에는 자리가 없고 모스픽 모드의 리모컨 화면에서만 쓰는 칸. 나가기는 리모컨의 나가기 버튼입니다. */
  var EXTRA=["나가기"];
  var NAMES=PAD.map(function(p){return p[1]});
  GROUPS.forEach(function(g){g.first=NAMES.length;g.slots.forEach(function(p){NAMES.push(p[1])});});   /* first: 그 묶음 첫 칸의 번호 */
  NAMES=NAMES.concat(EXTRA);
  var SLOTS=NAMES.length;
  function groupOf(i){
    for(var k=0;k<GROUPS.length;k++)if(i>=GROUPS[k].first&&i<GROUPS[k].first+GROUPS[k].slots.length)return GROUPS[k];
    return null;
  }
  /* 칸 i 의 정해진 이름 */
  function nameOf(i){return NAMES[i]}
  /* 칸마다 보내는 것도 정해져 있습니다. 볼륨과 채널은 스위치봇의 기본 명령(대소문자를 가립니다),
     나머지는 스위치봇 앱에서 그 리모컨에 추가해 학습시킨 버튼이고 값은 그 버튼의 이름입니다.
     앱의 버튼 이름이 여기 적힌 것과 글자 하나까지 같아야 합니다. */
  var SEND={"볼륨 위로":{cmd:"volumeAdd"},"볼륨 아래로":{cmd:"volumeSub"},"채널 위로":{cmd:"channelAdd"},"채널 아래로":{cmd:"channelSub"},
    "위":{btn:"up"},"왼쪽":{btn:"left"},"선택":{btn:"ok"},"오른쪽":{btn:"right"},"아래":{btn:"down"},"이전":{btn:"back"},
    "음소거":{btn:"음소거"},"편성표":{btn:"편성표"},"나가기":{btn:"나가기"},"넷플릭스":{btn:"넷플릭스"},"디즈니 플러스":{btn:"디즈니"}};
  var twice=false;         /* "2개씩"이 켜져 있는지. 묶음을 나가면 자판이 끕니다 */
  var TWICE_GAP=500;       /* 두 번 보낼 때 사이 간격(ms). 너무 붙으면 한 번으로 읽힐 수 있습니다 */
  var $=function(id){return document.getElementById(id)};

  /* cfg.targets: 불러온 리모컨 [{key, id, name, type}]
     cfg.dev: 모든 칸이 보내는 리모컨의 key. 아직 고르지 않았으면 "" */
  var cfg={url:"",pass:"",targets:[],dev:""};
  try{
    var saved=JSON.parse(localStorage.getItem(KEY));
    if(saved&&typeof saved==="object"){
      if(typeof saved.url==="string")cfg.url=saved.url;
      if(typeof saved.pass==="string")cfg.pass=saved.pass;
      if(Array.isArray(saved.targets))cfg.targets=saved.targets.filter(function(t){return t&&/^ir:/.test(t.key)});
      if(typeof saved.dev==="string")cfg.dev=saved.dev;
      /* 칸마다 기기와 동작을 정하던 때(v3 까지)의 설정: 칸들이 가리키던 리모컨 가운데 첫 번째를 고릅니다 */
      else if(Array.isArray(saved.buttons))saved.buttons.some(function(b){
        if(b&&typeof b.key==="string"&&/^ir:/.test(b.key)){cfg.dev=b.key;return true;}
        return false;
      });
    }
  }catch(err){}
  function save(){cfg.v=VER;try{localStorage.setItem(KEY,JSON.stringify(cfg));}catch(err){}}
  function target(key){
    for(var i=0;i<cfg.targets.length;i++)if(cfg.targets[i].key===key)return cfg.targets[i];
    return null;
  }
  /* 지금 고른 리모컨. 없으면 null */
  function dev(){return target(cfg.dev)}
  /* 볼륨과 채널의 기본 명령이 있는 리모컨 종류 */
  function hasBasic(t){return /TV|Streamer|Set Top Box/i.test(String(t.type||""))}

  /* ---------- 중계로 보내기 ---------- */
  var CODES={151:"기기 종류가 맞지 않습니다",152:"기기를 찾지 못했습니다. 기기를 다시 불러와 주세요",160:"이 기기가 지원하지 않는 동작입니다",
    161:"기기가 꺼져 있거나 연결이 끊겼습니다",171:"스위치봇 허브가 꺼져 있거나 연결이 끊겼습니다",190:"스위치봇에서 처리하지 못했습니다"};
  function base(){
    var u=cfg.url.trim().replace(/\/+$/,"");
    return /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u)?u:"";
  }
  /* 성공하면 응답의 body, 실패하면 보호자에게 보여 줄 말로 거절 */
  function call(method,path,body){
    var u=base();
    if(!u)return Promise.reject("중계 주소를 https:// 로 시작하게 넣어 주세요");
    if(!cfg.pass)return Promise.reject("암호를 넣어 주세요");
    var init={method:method,headers:{"X-Nundam-Pass":cfg.pass},cache:"no-store"};
    if(body){init.headers["Content-Type"]="application/json";init.body=JSON.stringify(body);}
    return fetch(u+path,init).then(function(r){
      return r.json().catch(function(){return {}}).then(function(j){
        if(j&&j.statusCode===100)return j.body||{};
        var m=j&&typeof j.message==="string"?j.message:"";
        if(/[가-힣]/.test(m))throw m;                          /* 중계가 알려 준 이유 */
        if(r.status===401||/unauthor/i.test(m))throw "스위치봇 토큰이 맞지 않거나 하루 사용량을 넘었습니다";
        throw CODES[j&&j.statusCode]||"스위치봇이 받아 주지 않았습니다"+(m?" ("+m+")":"");
      });
    },function(){throw "중계 주소에 닿지 못했습니다. 주소와 인터넷 연결을 확인해 주세요";});
  }
  function send(i){
    var t=dev(),name=nameOf(i),s=SEND[name];
    if(!t||!s){N.notice("리모컨 기기를 아직 고르지 않았습니다. 설정 > 리모컨에서 기기를 불러와 골라 주세요",5000);return Promise.resolve(false);}
    var g=groupOf(i),two=twice&&!!g&&!!g.twice&&!!g.slots[i-g.first][2];
    var body=s.cmd?{command:s.cmd,parameter:"default",commandType:"command"}:{command:s.btn,parameter:"default",commandType:"customize"};
    function once(){return call("POST","/v1.1/devices/"+encodeURIComponent(t.id)+"/commands",body);}
    var p=once();
    if(two)p=p.then(function(){return new Promise(function(done){setTimeout(done,TWICE_GAP)})}).then(once);
    return p.then(function(){N.notice(name+(two?" 두 번":"")+" 보냈습니다",1500,true);return true;},
      function(why){N.notice(name+" 보내지 못했습니다. "+why,6000);return false;});
  }

  /* ---------- 기기 불러오기 ---------- */
  function note(t){var el=$("rbNote");if(el)el.textContent=t}
  function load(){
    note("불러오는 중입니다");
    return call("GET","/v1.1/devices").then(function(d){
      var list=[];
      (d.infraredRemoteList||[]).forEach(function(x){list.push({key:"ir:"+x.deviceId,id:x.deviceId,name:x.deviceName||"이름 없음",type:x.remoteType||""})});
      cfg.targets=list;
      /* 고른 것이 없으면, 볼륨과 채널 명령이 있는 리모컨이 하나뿐일 때 그것을 고릅니다 */
      var picked=false;
      if(!dev()){
        var tv=list.filter(hasBasic);
        cfg.dev=tv.length===1?tv[0].key:"";
        picked=!!cfg.dev;
      }
      save();build();N.render();
      note(!list.length?"불러왔지만 등록된 리모컨이 없습니다. 스위치봇 앱에서 허브에 리모컨을 먼저 등록해 주세요.":
        "리모컨 "+list.length+"개를 불러왔습니다."+(picked?" "+dev().name+" 을(를) 골랐습니다.":(dev()?"":" 아래에서 쓸 리모컨을 골라 주세요.")));
    },function(why){note("불러오지 못했습니다. "+why);});
  }

  /* ---------- 설정 화면: 리모컨 하나 고르기, 칸마다 보내는 것 ---------- */
  function el(tag,attrs,text){
    var e=document.createElement(tag),k;
    for(k in attrs)e.setAttribute(k,attrs[k]);
    if(text!=null)e.textContent=text;
    return e;
  }
  function build(){
    var box=$("rbSlots");
    if(!box)return;
    box.textContent="";
    var wrap=el("div",{"class":"rb"});
    wrap.appendChild(el("div",{"class":"rb__top"},"리모컨 기기 (모든 칸이 이 기기로 보냅니다)"));
    var sel=el("select",{id:"rbDev","aria-label":"리모컨 기기"}),state=el("div",{"class":"rb__top"});
    sel.appendChild(el("option",{value:""},cfg.targets.length?"고르지 않음":"먼저 기기를 불러와 주세요"));
    cfg.targets.forEach(function(t){sel.appendChild(el("option",{value:t.key},t.name+" ("+(t.type||"리모컨")+")"))});
    sel.value=dev()?cfg.dev:"";
    function hint(){
      var t=dev();
      state.textContent=!t?"":(hasBasic(t)?"":"이 리모컨 종류에는 볼륨과 채널의 기본 명령이 없을 수 있습니다. TV, 셋톱박스, 스트리밍 기기 종류로 등록한 리모컨을 골라 주세요.");
    }
    sel.addEventListener("change",function(){cfg.dev=sel.value;save();hint();N.render();});
    hint();
    wrap.appendChild(sel);wrap.appendChild(state);
    box.appendChild(wrap);
    /* 칸마다 무엇을 보내는지. 학습한 버튼은 스위치봇 앱에서 이 이름으로 만들어 두어야 합니다 */
    var list=el("details",{"class":"rbgroup"});
    list.appendChild(el("summary",{},"칸마다 보내는 것 (스위치봇 앱의 버튼 이름)"));
    NAMES.forEach(function(n){
      var s=SEND[n];
      list.appendChild(el("div",{"class":"rb__top"},n+" · "+(s.cmd?"기본 명령 "+s.cmd:"학습한 버튼 \""+s.btn+"\"")));
    });
    box.appendChild(list);
  }

  var urlEl=$("rbUrl"),passEl=$("rbPass"),loadBtn=$("rbLoad");
  if(urlEl){urlEl.value=cfg.url;urlEl.addEventListener("input",function(){cfg.url=urlEl.value;save();});}
  if(passEl){passEl.value=cfg.pass;passEl.addEventListener("input",function(){cfg.pass=passEl.value;save();});}
  if(loadBtn)loadBtn.addEventListener("click",load);
  if(cfg.targets.length)note("저장해 둔 리모컨 "+cfg.targets.length+"개가 있습니다. 스위치봇 앱에서 바꾼 것이 있으면 다시 불러와 주세요.");
  build();

  /* 자판에 보여 줄 칸의 모습. 기기를 고르기 전에도 보여 주되, 확인하면 보내지 않고 알려 줍니다(send) */
  function tile(i){
    var t=dev();
    return {label:nameOf(i),sub:t?t.name:"기기 연결 전",i:i};
  }

  window.NundamRemote={
    /* 3*3 모드의 리모컨 화면에 보여 줄 칸들 {자리: 칸}. group 이 없으면 첫 화면, 있으면 그 묶음 안.
       보내는 칸은 {label, sub, i} (확인하면 리모컨 첫 화면으로 돌아갈 칸은 leave:true 도), 묶음 칸은 {label, sub, group},
       "2개씩" 칸은 {label, sub, twice:지금 켜짐}. 나가기는 자판이 놓습니다. */
    screen:function(group){
      var m={};
      if(!group){
        PAD.forEach(function(p,k){m[p[0]]=tile(k)});
        GROUPS.forEach(function(g){m[g.z]={label:g.name,sub:"묶음",group:g.id}});
        return m;
      }
      GROUPS.forEach(function(g){
        if(g.id!==group)return;
        g.slots.forEach(function(p,k){m[p[0]]=tile(g.first+k);if(g.leave)m[p[0]].leave=true;});
        if(g.twice)m[g.twice]=twice?{label:"1개씩",sub:"한 번에 한 번 보내기로",twice:true}:{label:"2개씩",sub:"한 번에 두 번 보내기로",twice:false};
      });
      return m;
    },
    /* "2개씩" 켜고 끄기 */
    setTwice:function(on){twice=!!on},
    /* 모든 칸 [{i, label, ready}]. label 은 그 칸의 정해진 이름, ready 는 보낼 수 있는 상태인지(리모컨을 골랐는지).
       모스픽 모드의 리모컨 화면이 칸 이름으로 찾아 send(i) 로 보냅니다 */
    all:function(){
      var ok=!!dev();
      return NAMES.map(function(n,i){return {i:i,label:n,ready:ok}});
    },
    /* 보낼 수 있는 칸 수(리모컨을 고르기 전에는 0) */
    count:function(){return dev()?SLOTS:0},
    send:send,load:load
  };
  N.render();
})();
