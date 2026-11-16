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
     @latest 는 어느 날 바뀔 수 있어 판을 고정합니다. */
  var LIB="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3";
  var MODEL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

  var stage=N.stage;
  var mode="off";            /* off, loading, posture, calib, quick, verify, run */
  var runId=0;               /* 켜고 끄기가 겹칠 때 늦게 끝난 준비 작업을 버리려고 셉니다 */
  var video=null,stream=null,vision=null,landmarker=null,libP=null;
  var lastVT=-1,lastInfer=0,minGap=0,errors=0;
  var light=null,lightAt=0,lightCv=null;
  var blinkIdx=null;
  var lastM=null;            /* 가장 최근 측정값(진단 표시용) */
  var gate=new C.HoldGate(1000);
  var lastSaid="",saidAt=0,pendMsg="",pendAt=0;

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
    result:["msg","sub"]
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

  /* 카메라 영상을 거울처럼 뒤집어 그립니다. */
  function drawView(cv,m){
    if(!video||!video.videoWidth)return;
    var w=cv.width,h=Math.round(w*video.videoHeight/video.videoWidth);
    if(cv.height!==h)cv.height=h;
    var g=cv.getContext("2d");
    g.save();g.scale(-1,1);g.drawImage(video,-w,0,w,h);g.restore();
    if(!m)return null;
    g.lineWidth=2;g.strokeStyle=cssVar("--accent");
    g.strokeRect(m.box.x0*w,m.box.y0*h,(m.box.x1-m.box.x0)*w,(m.box.y1-m.box.y0)*h);
    return g;
  }

  /* ---------- 카메라와 모델 ---------- */
  function openCamera(){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return Promise.reject({name:"NoApi"});
    return navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{facingMode:"user",width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}}
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
    libP=libP||import(LIB+"/vision_bundle.mjs");
    return libP.then(function(v){
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
    }).then(function(lmk){landmarker=lmk;},function(err){
      libP=null;
      throw {name:"ModelLoad",cause:err};
    });
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
  function start(){
    if(mode!=="off")return;
    var id=++runId;
    mode="loading";N.lock(true);
    screen("load");
    ui.msg.textContent="카메라를 준비하고 있습니다";
    ui.sub.textContent="처음에는 얼굴 인식 모델을 내려받느라 시간이 걸립니다.";
    openCamera().then(function(s){
      if(id!==runId){s.getTracks().forEach(function(tr){tr.stop()});return;}
      return attach(s).then(loadModel);
    }).then(function(){
      if(id!==runId)return;
      lastVT=-1;lastInfer=0;errors=0;light=null;
      enterPosture();
      requestAnimationFrame(loop);
    }).catch(function(err){
      if(id===runId)fail(reason(err));
    });
  }
  function stop(){
    runId++;mode="off";
    release();screen(null);
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
  function read(res){
    var lm=res&&res.faceLandmarks&&res.faceLandmarks[0];
    if(!lm)return null;
    var mx=res.facialTransformationMatrixes&&res.facialTransformationMatrixes[0];
    return C.measure(lm,{vw:video.videoWidth,vh:video.videoHeight,matrix:mx?mx.data:null,blink:readBlink(res)});
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
    if(!video||video.readyState<2||video.currentTime===lastVT)return;
    if(now-lastInfer<minGap)return;
    lastVT=video.currentTime;lastInfer=now;
    var res=null;
    try{res=landmarker.detectForVideo(video,now);errors=0;}
    catch(err){if(++errors>30){fail("얼굴 인식이 멈췄습니다.");}return;}
    var m=read(res);
    lastM=m;
    measureLight(m,now);
    onFrame(m,now);
  }
  function onFrame(m,now){
    if(mode==="posture")stepPosture(m,now);
    else if(mode==="run")stepRun(m,now);
  }

  /* ---------- 자세 점검 ---------- */
  function enterPosture(){
    mode="posture";N.lock(true);N.setGaze(null);
    gate=new C.HoldGate(1000);lastSaid="";pendMsg="";
    screen("posture");
    ui.sub.textContent="모두 맞으면 저절로 다음으로 넘어갑니다.";
  }
  function stepPosture(m,now){
    var p=C.postureCheck(m,light),prog=gate.update(p.ok,now);
    if(ui.msg.textContent!==p.msg)ui.msg.textContent=p.msg;
    Array.prototype.forEach.call(ui.list.children,function(li){li.classList.toggle("is-ok",!!p.items[li.dataset.k])});
    ui.bar.firstChild.style.setProperty("--p",prog);
    drawView(ui.view,m);
    guide(p.msg,now);
    if(prog>=1)afterPosture();
  }
  function afterPosture(){
    mode="run";screen(null);N.lock(false);
  }

  /* ---------- 쓰는 중 ---------- */
  function stepRun(m,now){
    N.setGaze(null);
  }

  window.NundamGaze={
    start:start,stop:stop,
    mode:function(){return mode},
    /* 진단과 시험용: 지금 상태를 그대로 보여 줍니다 */
    debug:function(){return {mode:mode,m:lastM,light:light}}
  };
})();
