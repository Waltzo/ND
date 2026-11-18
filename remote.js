/* 눈담 리모컨: 스위치봇 허브에 등록한 기기를 조작합니다.
   스위치봇 API 는 웹 페이지에서 바로 부를 수 없어, 보호자가 만든 중계(worker/switchbot-relay.js)를 거칩니다.
   중계 주소와 암호, 칸 설정은 이 기기(localStorage)에만 저장합니다. 토큰과 비밀 키는 눈담이 알지 못합니다.
   자판(index.html)과는 window.Nundam 과 window.NundamRemote 로만 만납니다. */
(function(){
  "use strict";
  var N=window.Nundam;
  if(!N)return;
  var KEY="nundam-remote",SLOTS=8;
  var PLACE=["왼쪽 위","위","오른쪽 위","왼쪽","오른쪽","왼쪽 아래","아래","오른쪽 아래"];
  var $=function(id){return document.getElementById(id)};

  /* cfg.targets: 불러온 기기와 장면 [{key, kind:"ir"|"dev"|"scene", id, name, type}]
     cfg.buttons: 칸 8개 [{label, key, cmd, param} 또는 null]
     key 가 "plan:" 으로 시작하면 기기 없이 종류만 미리 정해 둔 칸입니다(아래 PLANS). */
  var cfg={url:"",pass:"",targets:[],buttons:[]};
  try{
    var saved=JSON.parse(localStorage.getItem(KEY));
    if(saved&&typeof saved==="object"){
      if(typeof saved.url==="string")cfg.url=saved.url;
      if(typeof saved.pass==="string")cfg.pass=saved.pass;
      if(Array.isArray(saved.targets))cfg.targets=saved.targets;
      if(Array.isArray(saved.buttons))cfg.buttons=saved.buttons;
    }
  }catch(err){}
  while(cfg.buttons.length<SLOTS)cfg.buttons.push(null);
  function save(){try{localStorage.setItem(KEY,JSON.stringify(cfg));}catch(err){}}
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
    var t=target(b.key),p;
    if(t.kind==="scene")p=call("POST","/v1.1/scenes/"+encodeURIComponent(t.id)+"/execute");
    else{
      var a=actionOf(b),val=String(b.param||"").trim(),body;
      if(b.cmd===CUSTOM)body={command:val,parameter:"default",commandType:"customize"};
      else if(b.cmd===RAW)body={command:val,parameter:"default",commandType:"command"};
      else body={command:b.cmd,parameter:a.need?val:"default",commandType:"command"};
      p=call("POST","/v1.1/devices/"+encodeURIComponent(t.id)+"/commands",body);
    }
    return p.then(function(){N.notice(b.label+" 보냈습니다",1500,true);return true;},
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

  /* ---------- 설정 화면: 칸 8개 ---------- */
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
    for(var i=0;i<SLOTS;i++)box.appendChild(slot(i));
  }
  function slot(i){
    var b=cfg.buttons[i]||{label:"",key:"",cmd:"",param:""};
    var wrap=el("div",{"class":"rb"});
    wrap.appendChild(el("div",{"class":"rb__top"},"칸 "+(i+1)+" · "+PLACE[i]));
    var name=el("input",{type:"text",maxlength:"12",placeholder:"칸에 보일 이름","aria-label":"칸 "+(i+1)+" 이름"});
    var dev=el("select",{"aria-label":"칸 "+(i+1)+" 기기"});
    var act=el("select",{"aria-label":"칸 "+(i+1)+" 동작"});
    var extra=el("input",{type:"text",maxlength:"40","aria-label":"칸 "+(i+1)+" 값",autocapitalize:"off",spellcheck:"false"});
    var state=el("div",{"class":"rb__top"});
    name.value=b.label||"";extra.value=b.param||"";
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
      if(!filled(nb))return !nb.label?"이름을 넣어 주세요":"값을 넣어 주세요";
      return target(nb.key)?"":"기기 연결 전입니다. 기기를 불러온 뒤 위에서 기기를 골라 주세요";
    }
    function showExtra(){
      var list=actionsFor(shape(dev.value)),a=null;
      list.forEach(function(x){if(x.v===act.value)a=x});
      extra.hidden=!(a&&a.need);
      extra.placeholder=a&&a.need?a.need:"";
      return a;
    }
    var auto=false;        /* 이름을 눈담이 채웠는지. 보호자가 직접 쓴 이름은 건드리지 않습니다 */
    function commit(autoName){
      var t=shape(dev.value),a=showExtra();
      /* 이름이 비었거나 눈담이 채운 것이면 고른 동작으로 채웁니다(바꿔 써도 됩니다) */
      if(autoName&&t&&a&&(auto||!name.value.trim())){
        name.value=(a.v===CUSTOM||a.v===RAW||a.v==="execute")?t.name.slice(0,12):a.t;auto=true;
      }
      cfg.buttons[i]=t?{label:name.value.trim(),key:t.key,cmd:act.value,param:extra.value.trim()}:null;
      save();
      state.textContent=hint(cfg.buttons[i]);
      N.render();
    }
    fillActs(b.cmd);
    showExtra();
    state.textContent=shape(b.key)?hint(b):"";
    dev.addEventListener("change",function(){if(!fillActs(act.value))extra.value="";commit(true);});
    act.addEventListener("change",function(){extra.value="";commit(true);});
    name.addEventListener("input",function(){auto=false;commit(false);});
    extra.addEventListener("input",function(){commit(false);});
    wrap.appendChild(name);wrap.appendChild(dev);wrap.appendChild(act);wrap.appendChild(extra);wrap.appendChild(state);
    return wrap;
  }

  var urlEl=$("rbUrl"),passEl=$("rbPass"),loadBtn=$("rbLoad");
  if(urlEl){urlEl.value=cfg.url;urlEl.addEventListener("input",function(){cfg.url=urlEl.value;save();});}
  if(passEl){passEl.value=cfg.pass;passEl.addEventListener("input",function(){cfg.pass=passEl.value;save();});}
  if(loadBtn)loadBtn.addEventListener("click",load);
  if(cfg.targets.length)note("저장해 둔 기기 "+cfg.targets.length+"개가 있습니다. 스위치봇 앱에서 바꾼 것이 있으면 다시 불러와 주세요.");
  build();

  window.NundamRemote={
    /* 자판에 보여 줄 칸 8개: 다 채운 칸은 {label, sub}, 아니면 null.
       기기 연결 전인 칸도 보여 주되, 확인하면 보내지 않고 알려 줍니다(send) */
    buttons:function(){
      return cfg.buttons.map(function(b){
        if(!filled(b))return null;
        var t=target(b.key);
        return {label:b.label,sub:t?t.name:"기기 연결 전"};
      });
    },
    send:send,load:load
  };
  N.render();
})();
