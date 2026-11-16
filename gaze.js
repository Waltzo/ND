/* 눈담 카메라 시선 입력.
   카메라 영상에서 얼굴을 읽어(MediaPipe Face Landmarker) gaze-core.js 로 계산하고,
   결과를 window.Nundam.setGaze / blink 로 자판에 넘깁니다.
   영상은 이 기기 안에서만 씁니다. 서버로 보내거나 저장하는 코드는 없습니다.
   밖으로 나가는 요청은 얼굴 인식 프로그램과 모델을 내려받는 것뿐입니다. */
(function(){
  "use strict";
  var C=window.GazeCore,N=window.Nundam;
  if(!C||!N)return;

  /* 주소는 공식 문서(developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)에서 확인.
     @latest, latest 는 어느 날 바뀔 수 있어 프로그램과 모델 모두 판을 고정합니다. */
  var LIB="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3";
  var MODEL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

  var stage=N.stage;
  var mode="off";            /* off, loading, posture, calib, quick, verify, run */
  var runId=0;               /* 켜고 끄기가 겹칠 때 늦게 끝난 준비 작업을 버리려고 셉니다 */
  var video=null,stream=null,vision=null,landmarker=null,libP=null;
  var lastVT=-1,lastInfer=0,minGap=0,errors=0;
  var lastFrameAt=0,lastLoopAt=0,modelP=null,frameC=0,eyesLostAt=null;
  /* 먼 얼굴: 얼굴 둘레만 잘라 키워서 읽습니다. crop 은 지금 따라가는 범위, 없으면 조각을 돌아가며 찾습니다. */
  var crop=null,cropCv=null,region=null,regions=null,regionIdx=0,miss=0;
  var tuneAt=0,resTried=false,zoomDead=false;
  /* 쉬기: 화면을 안 보고 있으면 입력을 멈추고 쉽니다. 다시 4초 동안 화면을 보면 보정부터 다시 합니다. */
  var SLEEP_AFTER=8000,WAKE_LOOK=4000;
  var awaySince=null,lookSince=null,lookLast=0;
  var flush=false,flushed=false;   /* 범위를 바꾼 다음 프레임은 빈 그림을 넣어 모델의 이전 추적을 지웁니다 */
  var light=null,lightAt=0,lightCv=null;
  var blinkIdx=null;
  var lastM=null;            /* 가장 최근 측정값(진단 표시용) */
  var gate=new C.HoldGate(1000);
  var lastSaid="",saidAt=0,pendMsg="",pendAt=0;
  var sim=false;             /* 카메라 없이 측정값을 직접 넣어 시험하는 중 */

  /* 보정 */
  var KEY="nundam-gaze";
  var ORDER=[5,1,2,3,6,9,8,7,4];   /* 가운데에서 시작해 한 바퀴 */
  var model=null,base=null,wantFull=true,tries=0;
  var col=new C.Collector(),calIdx=0,calSamples=[],calMs=[],calC=[],calLost=null;
  var tracker=null,mover=null,ear=new C.EarCloser();
  var resultT=0;
  /* 품질, 진단, 정확도 확인 */
  var fpsM=new C.FpsMeter(),inferMs=0,frames=0,lowRate=false;
  var lastOut=null,qualAt=0,qualMsg="",qualSince=0;
  var ver={idx:0,t0:0,zones:[],hits:0,redo:false},score=null;

  /* 보호자 설정(깜빡임, 호출음). 이 기기에 저장합니다. */
  var SETKEY="nundam-gaze-set";
  var opt={blinkMin:0.2,blinkMax:1.0,alarm:3,diag:false};
  try{
    var savedOpt=JSON.parse(localStorage.getItem(SETKEY));
    if(savedOpt)for(var ok in opt)if(typeof savedOpt[ok]===typeof opt[ok])opt[ok]=savedOpt[ok];
  }catch(err){}
  function saveOpt(){try{localStorage.setItem(SETKEY,JSON.stringify(opt));}catch(err){}}
  var alarmDet=new C.BlinkDetector({alarmMs:opt.alarm*1000});
  /* 길게 깜빡임은 2.5초까지. 호출음이 그보다 먼저 울리게 해 두었으면 그 직전까지 */
  function longMs(){return opt.alarm>0?Math.min(2500,opt.alarm*1000-200):2500}
  function applyOpt(){
    if(opt.blinkMax<opt.blinkMin+0.1)opt.blinkMax=opt.blinkMin+0.1;
    alarmDet.alarmMs=opt.alarm*1000;
    if(tracker){tracker.blink.minMs=opt.blinkMin*1000;tracker.blink.maxMs=opt.blinkMax*1000;tracker.longMs=longMs();}
  }

  /* ---------- 화면 ---------- */
  var ov=document.createElement("div");
  ov.className="gz";ov.hidden=true;
  ov.innerHTML=
    '<canvas class="gz__view" width="320" height="240" aria-hidden="true"></canvas>'+
    '<div class="gz__msg" aria-live="polite"></div>'+
    '<ul class="gz__list" aria-label="자세 확인 항목">'+
      '<li data-k="face">얼굴이 다 보임</li><li data-k="dist">거리</li><li data-k="angle">각도</li>'+
      '<li data-k="eyes">두 눈</li><li data-k="light">밝기</li></ul>'+
    '<div class="gz__bar"><i></i></div>'+
    '<div class="gz__sub"></div>'+
    '<button class="btn" type="button">마우스 방식으로 돌아가기</button>'+
    '<div class="gz__dot" hidden><b></b></div>'+
    '<div class="gz__cap" hidden></div>';
  stage.appendChild(ov);
  /* 쓰는 중에 뜨는 품질 안내, 진단 표시 */
  var chip=document.createElement("div");
  chip.className="gz-chip";chip.hidden=true;chip.setAttribute("role","status");
  stage.appendChild(chip);
  var diag=document.createElement("div");
  diag.className="gz-diag";diag.hidden=true;
  diag.innerHTML='<canvas width="240" height="180" aria-hidden="true"></canvas><pre></pre>';
  document.body.appendChild(diag);
  var diagCv=diag.firstChild,diagTx=diag.lastChild;
  var ui={
    view:ov.querySelector(".gz__view"),msg:ov.querySelector(".gz__msg"),list:ov.querySelector(".gz__list"),
    bar:ov.querySelector(".gz__bar"),sub:ov.querySelector(".gz__sub"),quit:ov.querySelector(".btn"),
    dot:ov.querySelector(".gz__dot"),cap:ov.querySelector(".gz__cap")
  };
  ui.quit.addEventListener("click",function(){stop();N.setInput("mouse");});
  var SCREEN={
    load:["msg","sub","quit"],
    posture:["view","msg","list","bar","sub","quit"],
    calib:["dot","cap"],
    result:["msg","sub"],
    sleep:["msg","bar","sub"]
  };
  function screen(name){
    ov.hidden=!name;
    if(!name)return;
    for(var k in ui)ui[k].hidden=SCREEN[name].indexOf(k)<0;
  }
  function cssVar(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim()||"#888"}

  /* 보호자 안내를 읽어 줍니다. 같은 말을 되풀이하거나 말이 서로 끊기지 않게 합니다. */
  function guide(msg,now){
    if(msg!==pendMsg){pendMsg=msg;pendAt=now;}
    if(msg===lastSaid||now-pendAt<700||now-saidAt<2500)return;
    lastSaid=msg;saidAt=now;N.speak(msg);
  }

  /* 카메라 영상을 거울처럼 뒤집어 그리고, 그 위에 얼굴 테두리(eyes면 눈 테두리와 홍채 점)를 얹습니다. */
  /* 얼굴을 따라가는 중이면 영상 전체가 아니라, 얼굴을 한가운데 두고 키운 그림(모델이 읽는 범위)을 보여 줍니다. */
  function drawView(cv,m,eyes){
    var vw=video&&video.videoWidth?video.videoWidth:640,vh=video&&video.videoWidth?video.videoHeight:480;
    var v=crop&&m?crop:{x:0,y:0,w:vw,h:vh};            /* 보여 줄 범위(원본 영상 픽셀) */
    var w=cv.width,h=Math.round(w*v.h/v.w),g=cv.getContext("2d"),k=w/v.w;
    if(cv.height!==h)cv.height=h;
    g.fillStyle=cssVar("--surface");g.fillRect(0,0,w,h);
    if(video&&video.videoWidth){
      var sx0=Math.max(0,v.x),sy0=Math.max(0,v.y),sx1=Math.min(vw,v.x+v.w),sy1=Math.min(vh,v.y+v.h);
      if(sx1>sx0&&sy1>sy0){
        g.save();g.translate(w,0);g.scale(-1,1);       /* 거울처럼 뒤집기 */
        g.drawImage(video,sx0,sy0,sx1-sx0,sy1-sy0,(sx0-v.x)*k,(sy0-v.y)*k,(sx1-sx0)*k,(sy1-sy0)*k);
        g.restore();
      }
    }
    if(!m)return;
    /* 측정값은 뒤집은 영상 픽셀 좌표입니다. 보여 주는 범위 안의 자리로 옮깁니다. */
    var ox=vw-v.x-v.w;
    function X(x){return (x-ox)*k}
    function Y(y){return (y-v.y)*k}
    g.lineWidth=2;g.strokeStyle=cssVar("--accent");
    if(!eyes){g.strokeRect(X(m.box.x0*vw),Y(m.box.y0*vh),(m.box.x1-m.box.x0)*vw*k,(m.box.y1-m.box.y0)*vh*k);return;}
    [m.R,m.L].forEach(function(e){
      g.beginPath();g.moveTo(X(e.a.x),Y(e.a.y));g.lineTo(X(e.up.x),Y(e.up.y));g.lineTo(X(e.b.x),Y(e.b.y));g.lineTo(X(e.low.x),Y(e.low.y));g.closePath();g.stroke();
    });
    g.fillStyle=cssVar("--signal");
    [m.R,m.L].forEach(function(e){g.beginPath();g.arc(X(e.iris.x),Y(e.iris.y),3,0,Math.PI*2);g.fill();});
  }
  function showDiag(m){
    diag.hidden=!(opt.diag&&mode!=="off"&&mode!=="loading");
    if(diag.hidden)return;
    drawView(diagCv,m,true);
    var z=mode==="run"&&lastOut&&lastOut.zone?lastOut.zone:"-",r=Math.round,zoom=null;
    try{zoom=stream?stream.getVideoTracks()[0].getSettings().zoom:null;}catch(err){}
    var cam=video&&video.videoWidth?"영상 "+video.videoWidth+"x"+video.videoHeight+(zoom?" · 줌 "+(+zoom).toFixed(1)+"배":"")+(crop?" · 얼굴 "+Math.round(crop.fw)+"px 를 "+Math.round(crop.fw*crop.scale)+"px 로":"")+"\n":"";
    diagTx.textContent=m?
      cam+"홍채 "+m.irisPx.toFixed(1)+"px · 얼굴 너비 "+r((m.box.x1-m.box.x0)*100)+"%\n"+
      "좌우 "+r(m.yaw)+"° 상하 "+r(m.pitch)+"° 기울임 "+r(m.roll)+"°\n"+
      "초당 "+r(fpsM.fps)+"회"+(lowRate?" (낮춤)":"")+" · 밝기 "+(light==null?"-":r(light))+"\n"+
      "보는 칸 "+z+(score==null?"":" · 정확도 "+score+" / 9")
      :"얼굴이 보이지 않습니다";
  }

  /* ---------- 카메라와 모델 ---------- */
  function openCamera(){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return Promise.reject({name:"NoApi"});
    return navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{facingMode:"user",width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30}}
    });
  }
  function attach(s){
    stream=s;
    if(!video){
      video=document.createElement("video");
      video.className="gz-video";video.muted=true;video.playsInline=true;
      video.setAttribute("playsinline","");video.setAttribute("aria-hidden","true");
      document.body.appendChild(video);
    }
    video.srcObject=s;
    var id=runId;
    s.getVideoTracks().forEach(function(tr){
      tr.addEventListener("ended",function(){if(id===runId&&mode!=="off")fail("카메라가 끊겼습니다.");});
    });
    return video.play();
  }
  function loadModel(){
    if(landmarker)return Promise.resolve();
    if(modelP)return modelP;           /* 켜고 끄기가 겹쳐도 모델은 하나만 만듭니다 */
    libP=libP||import(LIB+"/vision_bundle.mjs");
    modelP=libP.then(function(v){
      vision=v;
      return v.FilesetResolver.forVisionTasks(LIB+"/wasm");
    }).then(function(files){
      function make(delegate){
        return vision.FaceLandmarker.createFromOptions(files,{
          baseOptions:{modelAssetPath:MODEL,delegate:delegate},
          runningMode:"VIDEO",numFaces:1,
          outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true
        });
      }
      return make("GPU").catch(function(){return make("CPU")});
    }).then(function(lmk){landmarker=lmk;modelP=null;},function(err){
      libP=null;modelP=null;
      throw {name:"ModelLoad",cause:err};
    });
    return modelP;
  }
  function reason(err){
    var n=err&&err.name;
    if(n==="NotAllowedError"||n==="SecurityError")return "카메라 권한이 거부되었습니다. 브라우저 설정에서 카메라를 허용해 주세요.";
    if(n==="NotFoundError"||n==="OverconstrainedError")return "카메라를 찾지 못했습니다.";
    if(n==="NotReadableError"||n==="AbortError")return "다른 앱이 카메라를 쓰고 있어 열 수 없습니다.";
    if(n==="NoApi")return "이 브라우저에서는 카메라를 쓸 수 없습니다. https 주소로 열어 주세요.";
    if(n==="ModelLoad")return "얼굴 인식 모델을 내려받지 못했습니다. 인터넷 연결을 확인해 주세요.";
    return "카메라를 시작하지 못했습니다.";
  }
  function release(){
    if(stream){stream.getTracks().forEach(function(tr){tr.stop()});stream=null;}
    if(video)video.srcObject=null;
  }

  /* ---------- 켜기, 끄기 ---------- */
  function start(o){
    if(mode!=="off")return;
    var id=++runId;
    sim=!!(o&&o.sim);tries=0;ver.redone=false;alarmDet.reset();eyesLostAt=null;
    loadCal();
    mode="loading";N.lock(true);
    if(sim){light=null;enterPosture();return;}
    screen("load");
    ui.msg.textContent="카메라를 준비하고 있습니다";
    ui.sub.textContent="처음에는 얼굴 인식 모델을 내려받느라 시간이 걸립니다.";
    openCamera().then(function(s){
      if(id!==runId){s.getTracks().forEach(function(tr){tr.stop()});return;}
      return attach(s).then(loadModel);
    }).then(function(){
      if(id!==runId)return;
      lastVT=-1;lastInfer=0;errors=0;light=null;lastFrameAt=lastLoopAt=performance.now();
      fpsM=new C.FpsMeter();inferMs=0;frames=0;lowRate=false;minGap=0;
      crop=null;regions=null;regionIdx=0;miss=0;tuneAt=0;resTried=false;zoomDead=false;flush=false;
      enterPosture();
      requestAnimationFrame(loop);
    }).catch(function(err){
      if(id===runId)fail(reason(err));
    });
  }
  function stop(){
    runId++;mode="off";clearTimeout(resultT);alarmDet.reset();
    release();screen(null);chip.hidden=true;diag.hidden=true;
    N.setGaze(null);N.lock(false);
  }
  function fail(msg){
    stop();
    N.setInput("mouse",msg+" 마우스 방식으로 돌아갑니다.");
  }

  /* ---------- 프레임마다 ---------- */
  function readBlink(res){
    var bs=res.faceBlendshapes&&res.faceBlendshapes[0],cat=bs&&bs.categories;
    if(!cat)return null;
    if(!blinkIdx){
      blinkIdx={l:-1,r:-1};
      cat.forEach(function(c,i){if(c.categoryName==="eyeBlinkLeft")blinkIdx.l=i;else if(c.categoryName==="eyeBlinkRight")blinkIdx.r=i;});
    }
    if(blinkIdx.l<0||blinkIdx.r<0||!cat[blinkIdx.l]||!cat[blinkIdx.r])return null;
    return {l:cat[blinkIdx.l].score,r:cat[blinkIdx.r].score};
  }
  /* 이번 프레임에 모델에 넣을 것. 따라가는 범위가 있으면 그것, 없으면 찾는 차례의 조각(null 은 화면 전체) */
  function pickSource(){
    var vw=video.videoWidth,vh=video.videoHeight;
    cropCv=cropCv||document.createElement("canvas");
    flushed=flush;
    if(flush){
      flush=false;
      cropCv.width=64;cropCv.height=64;
      var bg=cropCv.getContext("2d");bg.fillStyle="#808080";bg.fillRect(0,0,64,64);
      return cropCv;
    }
    region=crop;
    if(!region){
      if(!regions||regions.vw!==vw||regions.vh!==vh){regions=C.searchRegions(vw,vh);regions.vw=vw;regions.vh=vh;regionIdx=0;}
      region=regions[regionIdx];regionIdx=(regionIdx+1)%regions.length;
    }
    if(!region)return video;
    /* 따라가는 얼굴은 한가운데에 두고 얼굴 너비가 400px 이 되게 키웁니다. 찾는 중인 조각은 폭 640쯤으로. */
    var r=region,k=r.scale||Math.min(4,Math.max(1,640/r.w));
    var w=Math.round(r.w*k),h=Math.round(r.h*k),g=cropCv.getContext("2d");
    if(cropCv.width!==w)cropCv.width=w;
    if(cropCv.height!==h)cropCv.height=h;
    /* 범위가 영상 밖으로 나간 부분은 회색으로 두고, 겹치는 부분만 옮겨 그립니다. */
    var sx0=Math.max(0,r.x),sy0=Math.max(0,r.y),sx1=Math.min(vw,r.x+r.w),sy1=Math.min(vh,r.y+r.h);
    g.fillStyle="#808080";g.fillRect(0,0,w,h);
    if(sx1>sx0&&sy1>sy0)g.drawImage(video,sx0,sy0,sx1-sx0,sy1-sy0,(sx0-r.x)*k,(sy0-r.y)*k,(sx1-sx0)*k,(sy1-sy0)*k);
    return cropCv;
  }
  function read(res){
    var vw=video.videoWidth,vh=video.videoHeight,r=region;
    if(flushed)return lastM;                           /* 추적을 지우는 프레임: 직전 값을 그대로 씁니다 */
    var lm=res&&res.faceLandmarks&&res.faceLandmarks[0],m=null;
    if(lm){
      /* 잘라 넣었으면 좌표를 원본 영상 기준으로 되돌립니다 */
      if(r)lm=lm.map(function(p){return {x:(r.x+p.x*r.w)/vw,y:(r.y+p.y*r.h)/vh,z:p.z}});
      var mx=res.facialTransformationMatrixes&&res.facialTransformationMatrixes[0];
      m=C.measure(lm,{vw:vw,vh:vh,matrix:mx?mx.data:null,blink:readBlink(res)});
      if(m&&!C.plausible(m,r,vw))m=null;
    }
    if(!m){
      if(crop&&++miss>5){crop=null;regionIdx=0;flush=true;}   /* 놓쳤으면 화면 전체부터 다시 찾기 */
      return null;
    }
    miss=0;
    var want=C.cropAround(m.box,vw,vh);
    if(!crop||C.cropStale(crop,want)){crop=want;flush=true;}
    return m;
  }
  /* 자세 점검 중에만: 홍채가 작게 찍히면 해상도를 올리고 카메라 줌을 당깁니다. 보정 뒤에는 건드리지 않습니다. */
  function tune(m,now){
    if(sim||!m||!stream||now-tuneAt<1200)return;
    var track=stream.getVideoTracks()[0],caps={},set={};
    try{caps=track.getCapabilities?track.getCapabilities():{};set=track.getSettings?track.getSettings():{};}catch(err){return;}
    var z=caps.zoom,hasZoom=!zoomDead&&z&&typeof z.max==="number"&&z.max>z.min;
    var canRes=!resTried&&caps.width&&caps.height&&caps.width.max>video.videoWidth*1.2;
    var act=C.tuneCamera({irisPx:m.irisPx,box:m.box,cut:m.cut,zoom:hasZoom?(set.zoom||z.min):1,
      zoomMin:hasZoom?z.min:1,zoomMax:hasZoom?z.max:1,canRes:!!canRes});
    if(!act)return;
    tuneAt=now;
    var id=runId;
    function done(){if(id===runId){crop=null;regionIdx=0;gate.since=null;flush=true;}}
    if(act.res){
      resTried=true;
      track.applyConstraints({width:{ideal:caps.width.max},height:{ideal:caps.height.max}}).then(done,function(){});
    }else{
      /* Center Stage 가 켜져 있으면 줌이 잠겨 있어 실패합니다. 그러면 더 시도하지 않습니다. */
      track.applyConstraints({advanced:[{zoom:act.zoom}]}).then(done,function(){zoomDead=true;});
    }
  }
  /* 눈 주변 밝기(0~255). 작은 캔버스에 눈 부분만 옮겨 평균을 냅니다. */
  function measureLight(m,now){
    if(!m||now-lightAt<500)return;
    lightAt=now;
    try{
      lightCv=lightCv||document.createElement("canvas");
      lightCv.width=24;lightCv.height=12;
      var vw=video.videoWidth,pad=m.R.w*0.6;
      var x0=Math.min(m.L.a.x,m.R.a.x)-pad,x1=Math.max(m.L.b.x,m.R.b.x)+pad;
      var y0=Math.min(m.L.c.y,m.R.c.y)-pad,y1=Math.max(m.L.c.y,m.R.c.y)+pad;
      var g=lightCv.getContext("2d",{willReadFrequently:true});
      g.drawImage(video,vw-x1,y0,x1-x0,y1-y0,0,0,24,12);     /* 뒤집기 전 좌표로 */
      var d=g.getImageData(0,0,24,12).data,s=0,i;
      for(i=0;i<d.length;i+=4)s+=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
      light=s/(d.length/4);
    }catch(err){light=null;}
  }
  function loop(){
    if(mode==="off"||mode==="loading")return;
    requestAnimationFrame(loop);
    var now=performance.now();
    /* 화면이 가려져 있다가 돌아온 것은 카메라가 멈춘 것이 아닙니다. */
    if(now-lastLoopAt>1000){lastFrameAt=now;if(video&&video.paused)video.play().catch(function(){});}
    lastLoopAt=now;
    /* 카메라 영상이 멈추면 마지막 칸에 붙어 있지 않게 입력을 멈추고, 오래가면 마우스 방식으로 돌아갑니다. */
    if(now-lastFrameAt>500)N.setGaze(null);
    if(now-lastFrameAt>6000){fail("카메라 영상이 멈췄습니다.");return;}
    if(!video||video.readyState<2||video.currentTime===lastVT)return;
    if(now-lastInfer<minGap)return;
    lastVT=video.currentTime;lastInfer=now;
    var res=null;
    try{res=landmarker.detectForVideo(pickSource(),now);errors=0;}
    catch(err){if(++errors>30){fail("얼굴 인식이 멈췄습니다.");}return;}
    lastFrameAt=now;
    /* 실제 속도를 재서, 느린 기기에서는 모델 실행을 초당 15회쯤으로 낮춥니다. */
    var took=performance.now()-now;
    inferMs=inferMs?inferMs*0.9+took*0.1:took;
    fpsM.update(now);
    if(!lowRate&&++frames>=60&&C.needsLowRate(inferMs,fpsM.fps)){lowRate=true;minGap=62;}
    var m=read(res);
    lastM=m;
    measureLight(m,now);
    onFrame(m,now);
  }
  /* 안전장치: 어느 화면에서든 눈을 오래 감고 있으면 호출음을 울립니다. */
  function watchEyes(m,now){
    if(!m){
      /* 얼굴을 놓친 동안은 눈을 알 수 없습니다. 길어지면 감고 있던 시간을 잇지 않습니다. */
      if(eyesLostAt===null)eyesLostAt=now;
      if(now-eyesLostAt>1000)alarmDet.reset();
      return;
    }
    eyesLostAt=null;
    var c0=model?model.c0||0:0,c=C.clamp((frameC-c0)/(1-c0),0,1);
    alarmDet.on=model?0.5:0.8;       /* 보정 전에는 사람마다의 기준을 모릅니다. 아래를 볼 때 점수가 높게 나와도 울리지 않게 */
    if(alarmDet.update(c,now).alarm){
      N.alarm();
      N.notice("눈을 오래 감고 있어 호출음을 울렸습니다.",5000);
    }
  }
  function onFrame(m,now){
    frameC=m?(m.closed==null?ear.update(m.open):m.closed):0;   /* 원래 감김 점수 */
    watchEyes(m,now);
    showDiag(m);
    /* 설정 창이 화면을 가리는 동안에는 점검과 보정을 멈추고, 닫으면 그 점부터 다시 합니다. */
    if(N.settingsOpen()&&(mode==="posture"||mode==="calib"||mode==="quick"||mode==="verify")){
      gate.since=null;col.start(now);calLost=null;ver.t0=now;ver.zones=[];
      return;
    }
    if(mode==="posture")stepPosture(m,now);
    else if(mode==="calib")stepCalib(m,now);
    else if(mode==="quick")stepQuick(m,now);
    else if(mode==="verify")stepVerify(m,now);
    else if(mode==="run")stepRun(m,now);
    else if(mode==="sleep")stepSleep(m,now);
  }

  /* ---------- 자세 점검 ---------- */
  function enterPosture(){
    mode="posture";N.lock(true);N.setGaze(null);chip.hidden=true;
    gate=new C.HoldGate(1000);lastSaid="";pendMsg="";
    screen("posture");
    ui.sub.textContent="모두 맞으면 저절로 다음으로 넘어갑니다.";
  }
  function stepPosture(m,now){
    tune(m,now);
    var p=C.postureCheck(m,light),prog=gate.update(p.ok,now);
    if(ui.msg.textContent!==p.msg)ui.msg.textContent=p.msg;
    Array.prototype.forEach.call(ui.list.children,function(li){li.classList.toggle("is-ok",!!p.items[li.dataset.k])});
    ui.bar.firstChild.style.setProperty("--p",prog);
    drawView(ui.view,m);
    guide(p.msg,now);
    if(prog>=1)afterPosture();
  }
  function afterPosture(){
    if(wantFull||!model)enterCalib();else enterQuick();
  }

  /* ---------- 보정 ---------- */
  function loadCal(){
    model=null;base=null;wantFull=true;
    try{
      var d=JSON.parse(localStorage.getItem(KEY));
      if(d&&d.v===2&&d.model&&d.model.wx&&d.base){model=d.model;base=d.base;wantFull=false;}
    }catch(err){}
  }
  function saveCal(){
    try{localStorage.setItem(KEY,JSON.stringify({v:2,model:model,base:base}));}catch(err){}
  }
  /* 한 점에서 너무 오래 걸리면 환자가 그 화면에 갇히지 않게 자세 점검부터 다시 합니다. */
  function pointStuck(now){
    if(now-col.t0<20000)return false;
    if(++tries>=3)fail("보정을 마치지 못했습니다.");
    else enterPosture();
    return true;
  }
  function target(z,text){
    var c=C.zoneCenter(z);
    ui.dot.style.left=c.x*100+"%";ui.dot.style.top=c.y*100+"%";
    ui.dot.style.setProperty("--p",0);
    ui.cap.textContent=text;
    col.start(performance.now());calLost=null;
  }
  /* 얼굴을 오래 놓치면 자세 점검으로 돌아갑니다. */
  function lostTooLong(m,now){
    if(m){calLost=null;return false;}
    if(calLost===null)calLost=now;
    return now-calLost>3000;
  }
  function enterCalib(){
    mode="calib";N.lock(true);
    calIdx=0;calSamples=[];calMs=[];calC=[];
    screen("calib");
    target(ORDER[0],"주황색 점을 보고 계세요 (1 / 9)");
    N.speak("주황색 점을 따라 보세요");
  }
  function stepCalib(m,now){
    if(lostTooLong(m,now)){enterPosture();return;}
    if(pointStuck(now))return;
    ui.dot.style.setProperty("--p",col.update(m,frameC,now));
    if(!col.done())return;
    var z=ORDER[calIdx],c=C.zoneCenter(z);
    col.buf.forEach(function(s){calSamples.push({f:s.f,x:c.x,y:c.y});calMs.push(s.m);});
    calC.push(C.median(col.buf.map(function(s){return s.c})));
    N.tick(880,0.08);
    if(++calIdx<ORDER.length)target(ORDER[calIdx],"주황색 점을 보고 계세요 ("+(calIdx+1)+" / 9)");
    else finishCalib();
  }
  /* 점마다 눈동자 위치가 달라야 보정이 됩니다. 거의 같으면 눈이 점을 따라가지 않은 것입니다. */
  function eyesMoved(){
    var hx=[],hy=[],i,n=calMs.length/ORDER.length;
    for(i=0;i<ORDER.length;i++){
      var part=calMs.slice(i*n,(i+1)*n);
      hx.push(C.median(part.map(function(m){return m.hx})));
      hy.push(C.median(part.map(function(m){return m.hy+m.ly})));
    }
    function range(a){return Math.max.apply(null,a)-Math.min.apply(null,a)}
    return range(hx)>=0.02&&range(hy)>=0.01;
  }
  function finishCalib(){
    var fit=eyesMoved()?C.ridgeFit(calSamples,null,stage.clientWidth/Math.max(1,stage.clientHeight)):null;
    if(!fit){
      if(++tries>=3){fail("보정을 마치지 못했습니다.");return;}
      mode="result";screen("result");
      ui.msg.textContent="눈동자 움직임을 읽지 못했습니다";
      ui.sub.textContent="자세를 확인하고 다시 보정합니다.";
      N.speak("눈동자 움직임을 읽지 못했습니다. 다시 보정합니다");
      resultT=setTimeout(function(){if(mode==="result"){wantFull=true;enterPosture();}},3000);
      return;
    }
    /* 눈을 뜨고 있어도 나오는 감김 점수. 아래 줄을 볼 때 가장 큽니다. */
    fit.c0=C.clamp(Math.max.apply(null,calC),0,0.6);
    model=fit;base=C.baselineOf(calMs);wantFull=false;tries=0;
    saveCal();
    afterCalib();
  }
  function afterCalib(){enterVerify(true);}

  /* ---------- 정확도 확인: 9칸을 다시 보고 맞힌 칸을 셉니다 ---------- */
  function enterVerify(afterCal){
    mode="verify";N.lock(true);N.setGaze(null);chip.hidden=true;
    tracker=new C.Tracker({model:model,blink:{alarmMs:0}});
    ver={idx:0,t0:0,zones:[],hits:0,redo:!!afterCal&&!ver.redone,redone:ver.redone};
    screen("calib");
    target(ORDER[0],"정확도를 확인합니다. 점을 보고 계세요 (1 / 9)");
    ver.t0=performance.now();
    N.speak("정확도를 확인합니다. 점을 따라 보세요");
  }
  function stepVerify(m,now){
    if(lostTooLong(m,now)){enterPosture();return;}
    var out=tracker.step(m,now),el=now-ver.t0;
    lastOut=out;
    if(el>800)ver.zones.push(out.zone);          /* 눈을 옮길 시간은 빼고 */
    ui.dot.style.setProperty("--p",Math.min(1,el/1800));
    if(el<1800)return;
    if(C.majority(ver.zones)===ORDER[ver.idx])ver.hits++;
    ver.zones=[];ver.t0=now;
    if(++ver.idx<ORDER.length){
      target(ORDER[ver.idx],"정확도를 확인합니다. 점을 보고 계세요 ("+(ver.idx+1)+" / 9)");
      return;
    }
    score=ver.hits;
    mode="result";screen("result");
    ui.msg.textContent="맞힌 칸 "+score+" / 9";
    /* 환자는 누를 수 없으므로, 많이 틀리면 한 번은 저절로 다시 보정합니다. */
    var again=ver.redo&&score<5;
    ui.sub.textContent=again?"잘 맞지 않아 다시 보정합니다.":
      (score>=7?"잘 맞습니다. 곧 자판으로 넘어갑니다.":"잘 맞지 않으면 보호자 설정에서 다시 보정을 눌러 주세요.");
    N.speak("아홉 칸 중 "+score+"칸을 맞혔습니다");
    resultT=setTimeout(function(){
      if(mode!=="result")return;
      if(again){ver.redone=true;wantFull=true;enterPosture();}
      else enterRun();
    },4000);
  }
  function verifyNow(){
    if(!model||mode==="off"||mode==="loading")return;
    clearTimeout(resultT);
    N.closeSettings();ver.redone=true;enterVerify(false);
  }

  /* 빠른 재보정: 가운데 한 점만 보고 치우침을 고칩니다. */
  function enterQuick(){
    mode="quick";N.lock(true);
    screen("calib");
    target(5,"가운데 점을 보고 계세요");
    N.speak("가운데 점을 보세요");
  }
  function stepQuick(m,now){
    if(lostTooLong(m,now)){enterPosture();return;}
    if(pointStuck(now))return;
    ui.dot.style.setProperty("--p",col.update(m,frameC,now));
    if(!col.done())return;
    tries=0;N.tick(880,0.08);
    if(!C.biasFix(model,col.buf.map(function(s){return s.f}))){enterCalib();return;}
    base=C.baselineOf(col.buf.map(function(s){return s.m}));
    saveCal();
    enterRun();
  }
  function recalibrate(){
    if(mode==="off"||mode==="loading")return;
    clearTimeout(resultT);
    wantFull=true;tries=0;ver.redone=false;N.closeSettings();enterPosture();
  }

  /* ---------- 쓰는 중 ---------- */
  function enterRun(){
    mode="run";awaySince=null;
    tracker=new C.Tracker({model:model,blink:{minMs:opt.blinkMin*1000,maxMs:opt.blinkMax*1000,alarmMs:0},longMs:longMs()});
    mover=new C.MoveDetector(base);
    screen(null);N.lock(false);
  }
  /* ---------- 쉬기 ---------- */
  function enterSleep(){
    mode="sleep";N.lock(true);N.setGaze(null);chip.hidden=true;
    lookSince=null;lookLast=0;
    screen("sleep");
    ui.msg.textContent="쉬는 중입니다";
    ui.sub.textContent="화면을 4초 동안 보고 있으면 시선을 다시 맞추고 시작합니다.";
    ui.bar.firstChild.style.setProperty("--p",0);
  }
  function stepSleep(m,now){
    tracker.away=0.15;                                 /* 화면 안을 볼 때만 보는 것으로 칩니다 */
    var out=tracker.step(m,now);
    lastOut=out;
    if(out.pt&&!out.closed){if(lookSince===null)lookSince=now;lookLast=now;}
    else if(now-lookLast>600)lookSince=null;            /* 깜빡임 같은 짧은 끊김은 넘어갑니다 */
    var p=lookSince===null?0:Math.min(1,(now-lookSince)/WAKE_LOOK);
    ui.bar.firstChild.style.setProperty("--p",p);
    if(p>=1){
      N.speak("시선을 다시 맞춥니다");
      wantFull=false;enterPosture();                    /* 자세 점검 뒤 가운데 한 점 */
    }
  }

  function stepRun(m,now){
    /* 조이스틱은 화면 밖을 봐도 그쪽 가장자리에 붙은 것으로 칩니다. */
    tracker.away=N.nav()==="joy"?1.5:0.3;
    var out=tracker.step(m,now);
    lastOut=out;
    N.setGaze(out.pt,out.zone);
    /* 화면을 보고 있지 않은 채로(얼굴을 놓침, 화면 밖을 봄, 눈을 오래 감음) 시간이 지나면 쉽니다. */
    if(out.pt)awaySince=null;
    else{
      if(awaySince===null)awaySince=now;
      if(now-awaySince>=SLEEP_AFTER){enterSleep();return;}
    }
    if(out.blink)N.blink();
    if(out.long)N.longBlink();
    /* 태블릿이 옮겨진 것 같으면 입력을 잠그고 자세부터 다시 봅니다. */
    if(mover.update(m,now)){
      N.notice("태블릿이 옮겨진 것 같습니다. 자세를 다시 확인합니다.",4000);
      enterPosture();
      return;
    }
    checkQuality(m,now);
  }
  /* 카메라 품질이 나쁘면 자판 위쪽에 안내를 띄웁니다. 환자가 말하는 중일 수 있어 소리로는 읽지 않습니다. */
  function checkQuality(m,now){
    if(!m||now-qualAt<1000)return;
    qualAt=now;
    var q=C.quality({irisPx:m.irisPx,fps:sim?0:fpsM.fps,light:light});
    var msg=q.level==="bad"?"카메라가 흐려 칸을 가리기 어렵습니다. "+(q.msg||"조금 더 가까이 놓아 주세요"):q.msg;
    if(msg!==qualMsg){qualMsg=msg;qualSince=now;}
    var show=!!msg&&now-qualSince>=2000;       /* 잠깐 나빠진 것은 넘어갑니다 */
    if(chip.hidden===show){chip.hidden=!show;}
    if(show&&chip.textContent!==msg)chip.textContent=msg;
  }

  /* 시험용: 카메라 대신 측정값을 직접 넣습니다(start({sim:true}) 로 켰을 때만). */
  function feed(m){
    if(!sim||mode==="off")return;
    lastM=m;onFrame(m,performance.now());
  }
  var recalBtn=document.getElementById("recalBtn"),verifyBtn=document.getElementById("verifyBtn"),diagChk=document.getElementById("diagChk");
  if(recalBtn)recalBtn.addEventListener("click",recalibrate);
  if(verifyBtn)verifyBtn.addEventListener("click",verifyNow);
  if(diagChk){
    diagChk.checked=opt.diag;
    diagChk.addEventListener("change",function(){opt.diag=diagChk.checked;saveOpt();if(!opt.diag)diag.hidden=true;});
  }

  /* 설정 창의 조절 막대 */
  function slider(id,key,fmt){
    var el=document.getElementById(id),out=document.getElementById(id+"Out");
    if(!el)return;
    function show(){el.value=opt[key];if(out)out.textContent=fmt(opt[key]);}
    el.addEventListener("input",function(){opt[key]=parseFloat(el.value);applyOpt();saveOpt();sliders.forEach(function(f){f()});});
    sliders.push(show);show();
  }
  var sliders=[];
  slider("blinkMin","blinkMin",function(v){return v.toFixed(2)+"초"});
  slider("blinkMax","blinkMax",function(v){return v.toFixed(1)+"초"});
  slider("eyeAlarm","alarm",function(v){return v?v+"초":"끔"});
  applyOpt();

  window.NundamGaze={
    start:start,stop:stop,recalibrate:recalibrate,verify:verifyNow,feed:feed,
    mode:function(){return mode},
    /* 진단과 시험용: 지금 상태를 그대로 보여 줍니다 */
    debug:function(){return {mode:mode,m:lastM,crop:crop,video:video?[video.videoWidth,video.videoHeight]:null,out:lastOut,light:light,model:model,base:base,fps:fpsM.fps,inferMs:inferMs,lowRate:lowRate,score:score}}
  };
})();
