/* 눈담 리모컨: 스위치봇 허브에 등록한 기기를 조작합니다.
   스위치봇 API 는 웹 페이지에서 바로 부를 수 없어, 보호자가 만든 중계(worker/switchbot-relay.js)를 거칩니다.
   중계 주소와 암호, 칸 설정은 이 기기(localStorage)에만 저장합니다. 토큰과 비밀 키는 눈담이 알지 못합니다.
   자판(index.html)과는 window.Nundam 과 window.NundamRemote 로만 만납니다. */
(function(){
  "use strict";
  var N=window.Nundam;
  if(!N)return;
  var KEY="nundam-remote",VER=3;
  /* 리모컨 화면의 자리는 정해져 있고, 보호자는 칸마다 기기와 동작만 정합니다.
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
     cfg.buttons 의 순서: 방향, 선택, 이전(PAD 순서), 그 뒤로 묶음의 칸들(GROUPS 와 slots 순서) */
  var PAD=[[2,"위"],[4,"왼쪽"],[5,"선택"],[6,"오른쪽"],[8,"아래"],[9,"이전"]];
  var GROUPS=[{id:"chvol",z:1,name:"채널 및 볼륨 설정",twice:2,slots:[[1,"볼륨 위로",1],[3,"채널 위로",1],[4,"음소거"],[6,"편성표"],[7,"볼륨 아래로",1],[9,"채널 아래로",1]]},
    {id:"ott",z:3,name:"OTT 설정",leave:true,slots:[[1,"넷플릭스"],[2,"디즈니 플러스"]]}];
  var SLOTS=PAD.length;
  GROUPS.forEach(function(g){g.first=SLOTS;SLOTS+=g.slots.length;});   /* first: 그 묶음 첫 칸의 번호 */
  function groupOf(i){
    for(var k=0;k<GROUPS.length;k++)if(i>=GROUPS[k].first&&i<GROUPS[k].first+GROUPS[k].slots.length)return GROUPS[k];
    return null;
  }
  /* 칸 i 의 정해진 이름 */
  function nameOf(i){var g=groupOf(i);return (g?g.slots[i-g.first]:PAD[i])[1]}
  var twice=false;         /* "2개씩"이 켜져 있는지. 묶음을 나가면 자판이 끕니다 */
  var TWICE_GAP=500;       /* 두 번 보낼 때 사이 간격(ms). 너무 붙으면 한 번으로 읽힐 수 있습니다 */
  var $=function(id){return document.getElementById(id)};

  /* cfg.targets: 불러온 기기와 장면 [{key, kind:"ir"|"dev"|"scene", id, name, type}]
     cfg.buttons: 칸 [{label, key, cmd, param} 또는 null]. 순서는 위 설명대로이고, label 은 그 자리의 정해진 이름입니다.
     key 가 "plan:" 으로 시작하면 기기 없이 종류만 미리 정해 둔 칸입니다(아래 PLANS). */
  var cfg={url:"",pass:"",targets:[],buttons:[]};
  try{
    var saved=JSON.parse(localStorage.getItem(KEY));
    if(saved&&typeof saved==="object"){
      if(typeof saved.url==="string")cfg.url=saved.url;
      if(typeof saved.pass==="string")cfg.pass=saved.pass;
      if(Array.isArray(saved.targets))cfg.targets=saved.targets;
      /* 예전 8칸 배치(v 없음)로 저장한 칸은 자리가 달라 버립니다.
         v2 는 채널 및 볼륨 묶음이 네 칸이던 때라, 칸을 지금 순서로 옮깁니다 */
      if(saved.v===VER&&Array.isArray(saved.buttons))cfg.buttons=saved.buttons.slice(0,SLOTS);
      else if(saved.v===2&&Array.isArray(saved.buttons)){
        [0,1,2,3,4,5,7,6,11,10,12,13].forEach(function(to,from){
          while(cfg.buttons.length<=to)cfg.buttons.push(null);
          cfg.buttons[to]=saved.buttons[from]||null;
        });
      }
    }
  }catch(err){}
  while(cfg.buttons.length<SLOTS)cfg.buttons.push(null);
  cfg.buttons.forEach(function(b,i){if(b&&typeof b==="object")b.label=nameOf(i)});   /* 칸 이름은 자리가 정합니다 */
  function save(){cfg.v=VER;try{localStorage.setItem(KEY,JSON.stringify(cfg));}catch(err){}}
  function target(key){
    for(var i=0;i<cfg.targets.length;i++)if(cfg.targets[i].key===key)return cfg.targets[i];
    return null;
  }

  /* ---------- 기기를 등록하기 전에 종류만 정해 두기 ---------- */
  /* type 은 스위치봇이 알려 주는 리모컨 종류(remoteType) 그대로입니다. 동작 목록을 여기서 고릅니다. */
  var PLANS=[["ir","TV","TV"],["ir","Set Top Box","셋톱박스"],["ir","Streamer","스트리밍 기기"],["ir","Air Conditioner","에어컨"],
    ["ir","Fan","선풍기"],["ir","Light","조명"],["ir","Speaker","스피커"],["ir","DVD","DVD"],["ir","Others","그 밖의 리모컨"],
    ["dev","","스위치봇 기기 (봇, 플러그 등)"],["scene","","장면"]
  ].map(function(p){return {key:"plan:"+p[0]+":"+p[1],kind:p[0],type:p[1],name:p[2],plan:true}});
  function planned(key){
    for(var i=0;i<PLANS.length;i++)if(PLANS[i].key===key)return PLANS[i];
    return null;
  }
  /* 칸이 가리키는 것: 불러온 기기, 없으면 미리 정해 둔 종류 */
  function shape(key){return target(key)||planned(key)}
  function irType(t){return String(t.type||"").replace(/^DIY\s*/i,"").toLowerCase()}
  /* 미리 정해 둔 종류에 맞는 불러온 기기들 */
  function matches(plan){
    return cfg.targets.filter(function(t){return t.kind===plan.kind&&(plan.kind!=="ir"||irType(t)===irType(plan))});
  }

  /* ---------- 기기 종류마다 고를 수 있는 동작 ---------- */
  /* 동작 이름은 스위치봇 API 문서(OpenWonderLabs/SwitchBotAPI)의 표 그대로입니다. 대소문자를 가립니다.
     need: 값을 따로 받아야 하는 동작에 보여 줄 안내 */
  var CUSTOM="*custom",RAW="*raw";
  function actionsFor(t){
    if(!t)return [];
    if(t.kind==="scene")return [{v:"execute",t:"장면 실행"}];
    if(t.kind==="dev")return [{v:"turnOn",t:"켜기"},{v:"turnOff",t:"끄기"},{v:"press",t:"누르기"},
      {v:RAW,t:"직접 입력",need:"스위치봇 문서에 있는 명령 이름"}];
    var ty=String(t.type||"").replace(/^DIY\s*/i,""),a=[];
    if(!/others/i.test(ty))a.push({v:"turnOn",t:"켜기"},{v:"turnOff",t:"끄기"});
    if(/TV|Streamer|Set Top Box/i.test(ty))a.push({v:"volumeAdd",t:"음량 +"},{v:"volumeSub",t:"음량 -"},{v:"channelAdd",t:"채널 +"},{v:"channelSub",t:"채널 -"},
      {v:"SetChannel",t:"채널 번호로",need:"채널 번호 (예: 11)"});
    if(/Speaker/i.test(ty))a.push({v:"volumeAdd",t:"음량 +"},{v:"volumeSub",t:"음량 -"});
    if(/DVD|Speaker/i.test(ty))a.push({v:"setMute",t:"음소거"},{v:"Play",t:"재생"},{v:"Pause",t:"일시 정지"},{v:"Stop",t:"정지"},
      {v:"Next",t:"다음"},{v:"Previous",t:"이전"},{v:"FastForward",t:"빨리 감기"},{v:"Rewind",t:"되감기"});
    if(/Fan/i.test(ty))a.push({v:"swing",t:"회전"},{v:"timer",t:"타이머"},{v:"lowSpeed",t:"바람 약"},{v:"middleSpeed",t:"바람 중"},{v:"highSpeed",t:"바람 강"});
    if(/Light/i.test(ty))a.push({v:"brightnessUp",t:"밝게"},{v:"brightnessDown",t:"어둡게"});
    if(/Air Conditioner/i.test(ty))a.push({v:"setAll",t:"온도와 모드 보내기",need:"온도,모드,바람,전원 (예: 26,2,1,on · 모드 2 냉방 5 난방 · 바람 1 자동)"});
    a.push({v:CUSTOM,t:"학습한 버튼",need:"스위치봇 앱에서 그 버튼에 붙인 이름 그대로"});
    return a;
  }
  function actionOf(b){
    var list=actionsFor(shape(b.key));
    for(var i=0;i<list.length;i++)if(list[i].v===b.cmd)return list[i];
    return null;
  }
  /* 칸 설정이 다 채워졌는지(기기는 아직 없어도 됩니다) */
  function filled(b){
    if(!b||!b.label||!shape(b.key))return false;
    var a=actionOf(b);
    return !!a&&(!a.need||!!String(b.param||"").trim());
  }
  /* 칸 설정이 보낼 수 있는 상태인지 */
  function ready(b){return filled(b)&&!!target(b.key)}

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
    var b=cfg.buttons[i];
    if(filled(b)&&!target(b.key)){N.notice(b.label+" 칸은 아직 기기를 연결하지 않았습니다. 설정에서 기기를 불러와 연결해 주세요",5000);return Promise.resolve(false);}
    if(!ready(b)){N.notice("이 칸은 아직 정해지지 않았습니다. 설정에서 정해 주세요",4000);return Promise.resolve(false);}
    var t=target(b.key),g=groupOf(i),two=twice&&!!g&&!!g.twice&&!!g.slots[i-g.first][2];
    function once(){
      if(t.kind==="scene")return call("POST","/v1.1/scenes/"+encodeURIComponent(t.id)+"/execute");
      var a=actionOf(b),val=String(b.param||"").trim(),body;
      if(b.cmd===CUSTOM)body={command:val,parameter:"default",commandType:"customize"};
      else if(b.cmd===RAW)body={command:val,parameter:"default",commandType:"command"};
      else body={command:b.cmd,parameter:a.need?val:"default",commandType:"command"};
      return call("POST","/v1.1/devices/"+encodeURIComponent(t.id)+"/commands",body);
    }
    var p=once();
    if(two)p=p.then(function(){return new Promise(function(done){setTimeout(done,TWICE_GAP)})}).then(once);
    return p.then(function(){N.notice(b.label+(two?" 두 번":"")+" 보냈습니다",1500,true);return true;},
      function(why){N.notice(b.label+" 보내지 못했습니다. "+why,6000);return false;});
  }

  /* ---------- 기기 불러오기 ---------- */
  function note(t){var el=$("rbNote");if(el)el.textContent=t}
  function load(){
    note("불러오는 중입니다");
    return call("GET","/v1.1/devices").then(function(d){
      return call("GET","/v1.1/scenes").then(function(sc){return [d,sc]},function(){return [d,[]]});
    }).then(function(r){
      var d=r[0],sc=Array.isArray(r[1])?r[1]:[],list=[];
      (d.infraredRemoteList||[]).forEach(function(x){list.push({key:"ir:"+x.deviceId,kind:"ir",id:x.deviceId,name:x.deviceName||"이름 없음",type:x.remoteType||""})});
      (d.deviceList||[]).forEach(function(x){list.push({key:"dev:"+x.deviceId,kind:"dev",id:x.deviceId,name:x.deviceName||"이름 없음",type:x.deviceType||""})});
      sc.forEach(function(x){list.push({key:"scene:"+x.sceneId,kind:"scene",id:x.sceneId,name:x.sceneName||"이름 없음",type:"장면"})});
      cfg.targets=list;
      /* 미리 정해 둔 칸: 종류가 맞는 기기가 하나뿐이면 바로 연결하고, 여럿이면 보호자가 고릅니다 */
      var linked=0,left=0;
      cfg.buttons.forEach(function(b){
        var p=b&&planned(b.key);
        if(!p)return;
        var m=p.kind==="ir"?matches(p):[];   /* 허브도 기기 목록에 들어 있어, 리모컨만 알아서 연결합니다 */
        if(m.length===1){b.key=m[0].key;linked++;}else left++;
      });
      save();build();N.render();
      var ir=list.filter(function(t){return t.kind==="ir"}).length,n2=list.filter(function(t){return t.kind==="scene"}).length;
      note(list.length?"리모컨 "+ir+"개, 기기 "+(list.length-ir-n2)+"개, 장면 "+n2+"개를 불러왔습니다."+
          (linked?" 미리 정해 둔 칸 "+linked+"개를 기기에 연결했습니다.":"")+
          (left?" 미리 정해 둔 칸 "+left+"개는 아래에서 기기를 골라 주세요.":(linked?"":" 아래에서 칸을 정해 주세요.")):
        "불러왔지만 등록된 기기가 없습니다. 스위치봇 앱에서 허브에 리모컨을 먼저 등록해 주세요. 칸은 종류만 골라 미리 정해 둘 수 있습니다.");
    },function(why){note("불러오지 못했습니다. "+why);});
  }

  /* ---------- 설정 화면: 방향, 선택, 이전과 묶음 둘. 칸 이름은 모두 정해져 있습니다 ---------- */
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
    function part(title,open){
      var d=el("details",{"class":"rbgroup"});
      if(open)d.setAttribute("open","");
      d.appendChild(el("summary",{},title));
      box.appendChild(d);
      return d;
    }
    var pad=part("방향, 선택, 이전 (칸 2 4 5 6 8 9)",true);
    PAD.forEach(function(p,k){pad.appendChild(slot(k,"칸 "+p[0]+" · "+p[1]))});
    GROUPS.forEach(function(g){
      var d=part(g.name+" 묶음 (칸 "+g.z+")",false);
      g.slots.forEach(function(p,k){d.appendChild(slot(g.first+k,"칸 "+p[0]+" · "+p[1]))});
    });
  }
  /* title: 이 칸을 부르는 말. 칸 이름은 정해져 있어 보호자는 기기와 동작(과 값)만 정합니다 */
  function slot(i,title){
    var b=cfg.buttons[i]||{label:nameOf(i),key:"",cmd:"",param:""};
    var wrap=el("div",{"class":"rb","data-i":i});
    wrap.appendChild(el("div",{"class":"rb__top"},title));
    var dev=el("select",{"aria-label":title+" 기기"});
    var act=el("select",{"aria-label":title+" 동작"});
    var extra=el("input",{type:"text",maxlength:"40","aria-label":title+" 값",autocapitalize:"off",spellcheck:"false"});
    var state=el("div",{"class":"rb__top"});
    extra.value=b.param||"";
    dev.appendChild(el("option",{value:""},"쓰지 않음"));
    var got=el("optgroup",{label:"불러온 기기"}),plan=el("optgroup",{label:"아직 없는 기기 (종류만 정해 두기)"});
    cfg.targets.forEach(function(t){
      got.appendChild(el("option",{value:t.key},t.name+" ("+(t.kind==="scene"?"장면":(t.type||(t.kind==="ir"?"리모컨":"기기")))+")"));
    });
    PLANS.forEach(function(p){plan.appendChild(el("option",{value:p.key},p.name))});
    if(cfg.targets.length)dev.appendChild(got);
    dev.appendChild(plan);
    dev.value=shape(b.key)?b.key:"";
    /* 기기를 바꿔도 같은 동작이 있으면 그대로 둡니다(종류만 정해 둔 칸에 기기를 연결할 때) */
    function fillActs(keep){
      var list=actionsFor(shape(dev.value)),had=false;
      act.textContent="";
      list.forEach(function(a){act.appendChild(el("option",{value:a.v},a.t));if(a.v===keep)had=true;});
      act.hidden=!list.length;
      if(had)act.value=keep;else if(list.length)act.selectedIndex=0;
      return had;
    }
    function hint(nb){
      if(!nb)return "";
      if(!filled(nb))return "값을 넣어 주세요";
      return target(nb.key)?"":"기기 연결 전입니다. 기기를 불러온 뒤 위에서 기기를 골라 주세요";
    }
    function showExtra(){
      var list=actionsFor(shape(dev.value)),a=null;
      list.forEach(function(x){if(x.v===act.value)a=x});
      extra.hidden=!(a&&a.need);
      extra.placeholder=a&&a.need?a.need:"";
      return a;
    }
    function commit(){
      var t=shape(dev.value);
      showExtra();
      cfg.buttons[i]=t?{label:nameOf(i),key:t.key,cmd:act.value,param:extra.value.trim()}:null;
      save();
      state.textContent=hint(cfg.buttons[i]);
      N.render();
    }
    fillActs(b.cmd);
    showExtra();
    state.textContent=shape(b.key)?hint(b):"";
    dev.addEventListener("change",function(){if(!fillActs(act.value))extra.value="";commit();});
    act.addEventListener("change",function(){extra.value="";commit();});
    extra.addEventListener("input",commit);
    wrap.appendChild(dev);wrap.appendChild(act);wrap.appendChild(extra);wrap.appendChild(state);
    return wrap;
  }

  var urlEl=$("rbUrl"),passEl=$("rbPass"),loadBtn=$("rbLoad");
  if(urlEl){urlEl.value=cfg.url;urlEl.addEventListener("input",function(){cfg.url=urlEl.value;save();});}
  if(passEl){passEl.value=cfg.pass;passEl.addEventListener("input",function(){cfg.pass=passEl.value;save();});}
  if(loadBtn)loadBtn.addEventListener("click",load);
  if(cfg.targets.length)note("저장해 둔 기기 "+cfg.targets.length+"개가 있습니다. 스위치봇 앱에서 바꾼 것이 있으면 다시 불러와 주세요.");
  build();

  /* 다 채운 칸이면 자판에 보여 줄 모습, 아니면 null */
  function tile(i){
    var b=cfg.buttons[i];
    if(!filled(b))return null;
    var t=target(b.key);
    return {label:b.label,sub:t?t.name:"기기 연결 전",i:i};
  }

  window.NundamRemote={
    /* 자판에 보여 줄 칸들 {자리: 칸}. group 이 없으면 리모컨 첫 화면, 있으면 그 묶음 안.
       보내는 칸은 {label, sub, i} (확인하면 리모컨 첫 화면으로 돌아갈 칸은 leave:true 도), 묶음 칸은 {label, sub, group}, "2개씩" 칸은 {label, sub, twice:지금 켜짐}.
       나가기(첫 화면 7, 묶음 안 5)는 자판이 놓습니다.
       아직 정하지 않았거나 기기 연결 전인 칸도 보여 주되, 확인하면 보내지 않고 알려 줍니다(send) */
    screen:function(group){
      var m={};
      function put(z,name,i){m[z]=tile(i)||{label:name,sub:"설정 전",i:i}}
      if(!group){
        PAD.forEach(function(p,k){put(p[0],p[1],k)});
        GROUPS.forEach(function(g){m[g.z]={label:g.name,sub:"묶음",group:g.id}});
        return m;
      }
      GROUPS.forEach(function(g){
        if(g.id!==group)return;
        g.slots.forEach(function(p,k){put(p[0],p[1],g.first+k);if(g.leave)m[p[0]].leave=true;});
        if(g.twice)m[g.twice]=twice?{label:"1개씩",sub:"한 번에 한 번 보내기로",twice:true}:{label:"2개씩",sub:"한 번에 두 번 보내기로",twice:false};
      });
      return m;
    },
    /* "2개씩" 켜고 끄기 */
    setTwice:function(on){twice=!!on},
    /* 다 채운 칸 수 */
    count:function(){var n=0;for(var i=0;i<SLOTS;i++)if(tile(i))n++;return n;},
    send:send,load:load
  };
  N.render();
})();
